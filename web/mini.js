// view=mini: the Mac app's menu bar panel. Running sessions only, each with what it is doing now and
// its agents (GET /api/live, polled). A click opens the run in the app window.
import { S } from './strings.js';
import { fmtDuration, fmtTokens, fmtUsd } from './format.js';
import { iconEl, providerSlugs } from './session-list.js';

const POLL_MS = 4000;
const CHIPS = 6; // agent chips per session; the rest are counted
const WAITING = new Set(['AskUserQuestion', 'ExitPlanMode', 'request_user_input']); // tools that wait for the user

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What the session is doing now: the newest tool call of a running agent, or thinking, or nothing. */
export function nowOf(agents) {
  let best = null;
  for (const a of agents) if (a.status === 'running' && a.now && (!best || a.nowStart > best.nowStart)) best = a;
  if (best) return { agent: best, tool: best.now, since: best.nowStart, waiting: WAITING.has(best.now) };
  const busy = agents.find((a) => a.status === 'running');
  return busy ? { agent: busy, tool: null, since: null, waiting: false } : null;
}

/** Running agents first, then the latest finished ones; `more` is how many did not fit. */
export function pickAgents(agents, max = CHIPS) {
  const done = agents.filter((a) => a.status !== 'running');
  const order = [...agents.filter((a) => a.status === 'running'), ...done.reverse()];
  return { shown: order.slice(0, max), done: done.length, more: Math.max(0, order.length - max) };
}

/** 3s -> "now", 40s -> "40s ago", 5 min -> "5m ago", 2 h -> "2h ago" */
export function fmtAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s < 5) return S.mini.justNow;
  if (s < 60) return S.mini.ago(`${s}s`);
  if (s < 3600) return S.mini.ago(`${Math.round(s / 60)}m`);
  return S.mini.ago(`${Math.round(s / 3600)}h`);
}

const agentName = (a) => (a.depth === 0 ? S.graph.orchestrator : a.name);
const dot = (status) => el('span', status === 'running' ? 'dot pulse' : status === 'error' ? 'dot err' : 'dot off');

function nowLine(s, now) {
  const n = nowOf(s.agents ?? []);
  const line = el('div', `mini-now${n?.waiting ? ' waiting' : ''}`);
  if (!n) return line;
  const who = (s.agents?.length ?? 0) > 1 ? `${agentName(n.agent)} · ` : '';
  line.append(n.waiting ? el('span', 'mini-ico', '⏸') : dot('running'), el('span', 'mini-tool', `${who}${n.waiting ? S.mini.waiting : n.tool ?? S.mini.thinking}`));
  if (n.since) {
    const t = el('span', 'mini-since num', fmtDuration(now - n.since));
    t.dataset.since = String(n.since);
    line.append(t);
  }
  return line;
}

/** One running session: provider, title, last activity, totals, what it does now and its agents. */
export function miniCard(s, now = Date.now()) {
  const card = el('button', 'mini-card');
  card.type = 'button';
  card.dataset.id = s.id;
  const head = el('div', 'mini-head');
  const slug = providerSlugs(s.models)[0];
  head.append(slug ? iconEl(slug) : el('span', `badge ${s.source === 'codex' ? 'cx' : 'cc'}`, S.sourceBadge[s.source] ?? '?'));
  head.append(el('span', 'mini-title', s.title || S.list.untitled), el('span', 'mini-ago num', fmtAgo(now - s.lastWrite)));
  const t = s.totals ?? {};
  const tokens = (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0);
  const meta = el('div', 'mini-meta');
  for (const part of [s.project, s.start ? fmtDuration(now - s.start) : null, t.usd != null ? fmtUsd(t.usd) : null, tokens ? S.mini.tokens(fmtTokens(tokens)) : null]) {
    if (part) meta.append(el('span', 'num', part));
  }
  if (s.errorCount) meta.append(el('span', 'mini-err num', S.mini.errors(s.errorCount)));
  card.append(head, meta, nowLine(s, now));
  const agents = s.agents ?? [];
  if (agents.length > 1) {
    const pick = pickAgents(agents);
    const chips = el('div', 'mini-chips');
    for (const a of pick.shown) {
      const c = el('span', `mini-chip st-${a.status}`);
      c.append(dot(a.status), el('span', '', agentName(a)));
      chips.append(c);
    }
    if (pick.more) chips.append(el('span', 'mini-chip more', `+${pick.more}`));
    chips.append(el('span', 'mini-progress num', S.mini.progress(pick.done, agents.length)));
    card.append(chips);
  }
  return card;
}

/** Running sessions by group, groups in their saved order, then the ungrouped ones (`group` null). */
export function bySection(sessions, groups) {
  const out = [];
  const left = new Set(sessions.map((s) => s.id));
  for (const g of groups) {
    const list = sessions.filter((s) => left.has(s.id) && g.sessions.includes(s.id));
    for (const s of list) left.delete(s.id);
    if (list.length) out.push({ group: g, sessions: list });
  }
  const rest = sessions.filter((s) => left.has(s.id));
  if (rest.length) out.push({ group: null, sessions: rest });
  return out;
}

function sections(sessions, groups, now) {
  const parts = bySection(sessions, groups);
  if (parts.length === 1 && !parts[0].group) return parts[0].sessions.map((s) => miniCard(s, now)); // no groups in use
  return parts.flatMap(({ group, sessions: list }) => [el('div', 'mini-sec', group?.name ?? S.groups.other), ...list.map((s) => miniCard(s, now))]);
}

function header(sessions) {
  const h = el('div', 'mini-top');
  const usd = sessions.reduce((sum, s) => sum + (s.totals?.usd ?? 0), 0);
  h.append(el('span', 'mini-count', S.mini.running(sessions.length)));
  if (usd) h.append(el('span', 'mini-sum num', fmtUsd(usd)));
  return h;
}

export function startMini(body) {
  body.classList.add('mini');
  const box = el('div', 'mini-list');
  body.replaceChildren(box);
  const bridge = window.webkit?.messageHandlers?.ari; // inside the Mac app
  const openRun = (id) => (bridge ? bridge.postMessage({ open: id }) : window.open(id ? `/?s=${encodeURIComponent(id)}` : '/', '_blank'));
  box.addEventListener('click', (e) => {
    const target = e.target.closest('.mini-card, .mini-openapp');
    if (target) openRun(target.dataset.id ?? '');
  });
  const fit = () => bridge?.postMessage({ height: Math.ceil(box.getBoundingClientRect().height) }); // the app fits the panel to it
  const footer = () => {
    const b = el('button', 'mini-openapp', S.mini.openApp);
    b.type = 'button';
    return b;
  };
  async function tick() {
    try {
      const res = await fetch('/api/live', { headers: { accept: 'application/json' } });
      if (res.status === 401) {
        box.replaceChildren(el('p', 'mini-empty', S.auth.restarted));
        return fit();
      }
      if (!res.ok) throw new Error(String(res.status));
      const { sessions } = await res.json();
      const groups = await fetch('/api/groups').then((r) => (r.ok ? r.json() : { groups: [] }), () => ({ groups: [] }));
      const now = Date.now();
      box.replaceChildren(header(sessions), ...(sessions.length ? sections(sessions, groups.groups ?? [], now) : [el('p', 'mini-empty', S.mini.none)]), footer());
    } catch {
      box.replaceChildren(el('p', 'mini-empty', S.mini.offline), footer());
    }
    fit();
    setTimeout(tick, POLL_MS);
  }
  // the time spent in the current call counts up between polls
  setInterval(() => {
    for (const t of box.querySelectorAll('[data-since]')) t.textContent = fmtDuration(Date.now() - Number(t.dataset.since));
  }, 1000);
  tick();
}
