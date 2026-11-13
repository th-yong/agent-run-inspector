// One agent card of the graph tab. Pure helpers (cardInfo, callRows, ...) are exported for tests;
// the DOM builders touch `document` only when called.
import { S } from './strings.js';
import { fmtDuration, fmtUsd } from './format.js';
import { hasIcon } from './icons.js';
import { iconEl, providerOf, providerSlugs } from './session-list.js';

const known = (n) => typeof n === 'number' && Number.isFinite(n);
const MIN_BAR = 8; // percent, so a very short call still shows a sliver

/** Span status -> card state. */
export function statusKey(status) {
  if (status === 'running') return 'running';
  if (status === 'ok') return 'done';
  if (status === 'error') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'unknown';
}

/** Fields the card header and footer show. `calls` are the agent's own llm/tool spans. */
export function cardInfo(agent, calls, now) {
  const llms = calls.filter((c) => c.kind === 'llm');
  const real = llms.find((c) => c.model && !c.model.startsWith('<'));
  const model = agent.model ?? real?.model ?? null;
  const priced = llms.filter((c) => known(c.cost?.usd));
  const end = known(agent.end) ? agent.end : agent.status === 'running' ? now : null;
  return {
    name: agent.name,
    model: model && model !== agent.name ? model : null,
    modelForIcon: model ?? agent.name,
    status: statusKey(agent.status),
    task: agent.task ?? '',
    usd: priced.length ? priced.reduce((s, c) => s + c.cost.usd, 0) : null,
    durationMs: known(agent.start) && end != null ? Math.max(0, end - agent.start) : null,
    callCount: calls.length,
    external: Boolean(agent.external),
    watcher: agent.role === 'watcher',
  };
}

/** "$ cmd" for shell calls, "server · tool" for MCP, else the tool name. */
export function toolLabel(call) {
  if (call.command) return `$ ${call.command}`;
  return String(call.name ?? '').replace(/^mcp__(.+?)__/, '$1 · ');
}

export function callIcon(call) {
  if (call.kind === 'llm') {
    const slug = providerSlugs([call.model ?? call.name])[0];
    return call.status === 'error' ? { type: 'err' } : slug ? { type: 'brand', slug } : { type: 'other' };
  }
  if (call.status === 'error') return { type: 'err' };
  if (call.toolBrand && hasIcon(call.toolBrand)) return { type: 'brand', slug: call.toolBrand };
  return { type: 'cat', key: call.toolCategory ?? 'other' };
}

/** The last `shown` calls as display rows. Bars scale to the agent's longest finished call. */
export function callRows(calls, shown) {
  const maxMs = Math.max(1, ...calls.filter((c) => known(c.end)).map((c) => c.end - c.start));
  return calls.slice(Math.max(0, calls.length - shown)).map((c) => {
    const running = !known(c.end) && c.status === 'running';
    const ms = known(c.end) ? Math.max(0, c.end - c.start) : null;
    return {
      id: c.id,
      kind: c.kind,
      label: c.kind === 'llm' ? S.graph.modelResponse : toolLabel(c),
      icon: callIcon(c),
      error: c.status === 'error',
      running,
      ms,
      pct: running ? 100 : ms == null ? 0 : Math.max(MIN_BAR, Math.min(100, (ms / maxMs) * 100)),
    };
  });
}

// ---------------- DOM ----------------
const SVG = 'http://www.w3.org/2000/svg';
const CAT = {
  llm: '<path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5 6.4 9.6 1.5 8l4.9-1.6z"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/>',
  web: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>',
  db: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  git: '<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.6c0 2.4-3 2.2-6.2 3.6"/>',
  shell: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2 1.5-2 1.5M8.5 10h3"/>',
  file: '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>',
  edit: '<path d="M10.8 2.2l3 3-8 8H2.8v-3z"/>',
  agent: '<circle cx="8" cy="5" r="2.6"/><path d="M3 14c.6-2.8 2.6-4.2 5-4.2s4.4 1.4 5 4.2"/>',
  mcp: '<path d="M6 2v4M10 2v4M4 6h8v3a4 4 0 01-8 0zM8 13v1.5"/>',
  err: '<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.8v3M8 11.6v.2"/>',
  other: '<circle cx="8" cy="8" r="5.5"/>',
};

function symbol(key, cls = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `ico ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = CAT[key] ?? CAT.other; // fixed strings above, never run data
  return svg;
}

export function iconNode(icon) {
  if (icon.type === 'brand') return iconEl(icon.slug);
  if (icon.type === 'err') return symbol('err', 'k-err');
  if (icon.type === 'other') return symbol('other', 'k-other');
  return symbol(icon.key);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Provider logo in its small tile; an empty circle for an unknown provider. */
export function providerTile(model) {
  const box = el('span', `prov ${providerOf(model)}`);
  const slug = providerSlugs([model])[0];
  if (slug) box.append(iconEl(slug));
  else {
    const c = symbol('other', 'k-other');
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', S.graph.unknownProvider);
    box.append(c);
  }
  return box;
}

const BADGE = { running: S.status.running, done: `✓ ${S.status.ok}`, failed: `▲ ${S.status.error}`, cancelled: S.status.cancelled, unknown: S.status.unknown };

/** Builds one card element; fill it with updateCard(). */
export function createCard() {
  const root = el('div', 'g-card');
  root.tabIndex = 0;
  root.setAttribute('role', 'button');
  const head = el('div', 'g-h');
  const tile = el('span', 'prov-slot');
  const name = el('span', 'g-name');
  const model = el('span', 'g-model');
  const badge = el('span', 'g-badge');
  head.append(tile, name, model, badge);
  const task = el('div', 'g-task');
  const calls = el('div', 'g-calls');
  const more = el('div', 'g-more');
  const foot = el('div', 'g-f');
  const cost = el('span', 'g-cost num');
  const count = el('span', 'g-count');
  foot.append(cost, count);
  const body = el('div', 'g-body');
  body.append(task, calls, foot);
  const mini = el('div', 'g-mini num');
  root.append(head, body, mini);
  return { root, head, tile, name, model, badge, task, calls, more, cost, count, body, mini, sig: '' };
}

/**
 * Fills a card. `d` = { info, rows, moreCalls, showTask, folded, selected, box:{x,y,w,h}, indent? }.
 * Skips DOM work when nothing visible changed, so a running bar is not restarted by an unrelated update.
 */
export function updateCard(c, d) {
  const { info, rows, moreCalls, showTask, folded, selected, box } = d;
  const root = c.root;
  root.style.left = `${box.x}px`;
  root.style.top = `${box.y}px`;
  root.style.width = `${box.w}px`;
  root.style.height = `${box.h}px`;
  root.dataset.status = info.status;
  root.classList.toggle('watch', info.watcher);
  root.classList.toggle('external', info.external);
  root.classList.toggle('folded', folded);
  root.classList.toggle('sel', selected);
  root.setAttribute('aria-pressed', String(selected));
  root.setAttribute('aria-label', `${info.name}, ${BADGE[info.status]}`);
  root.title = info.external ? S.graph.externalTip : S.graph.cardTip;

  const usd = info.usd == null ? '—' : fmtUsd(info.usd);
  const dur = info.durationMs == null ? '—' : fmtDuration(info.durationMs);
  const sig = JSON.stringify([info, rows, moreCalls, showTask, folded, usd, dur]);
  if (sig === c.sig) return;
  c.sig = sig;

  c.tile.replaceChildren(providerTile(info.modelForIcon));
  c.name.textContent = info.name;
  c.name.title = info.name;
  c.model.textContent = info.model ?? '';
  c.model.hidden = !info.model;
  c.badge.className = `g-badge ${info.status}`;
  c.badge.replaceChildren(...(info.status === 'running' ? [el('i', 'spin'), S.status.running] : [BADGE[info.status]]));

  c.task.textContent = info.watcher && !info.task ? S.graph.watcher : info.task;
  c.task.hidden = !showTask || (!info.task && !info.watcher);

  const rowEls = rows.map((r) => {
    const row = el('div', `g-row${r.error ? ' err' : ''}${r.kind === 'llm' ? ' llm' : ''}${r.running ? ' running' : ''}`);
    const ic = el('span', 'g-ic');
    ic.append(iconNode(r.icon));
    const label = el('span', 'g-rn', r.label);
    label.title = r.label;
    const bar = el('span', 'g-bar');
    const fill = el('i');
    fill.style.width = `${r.pct}%`;
    bar.append(fill);
    row.append(ic, label, bar, el('span', 'g-rt num', r.running ? '…' : r.ms == null ? '—' : fmtDuration(r.ms)));
    return row;
  });
  c.more.textContent = moreCalls > 0 ? S.graph.earlier(moreCalls) : '';
  c.calls.replaceChildren(...(moreCalls > 0 ? [c.more] : []), ...rowEls);
  c.calls.hidden = info.external;

  c.cost.textContent = info.external ? S.graph.external : `${usd} · ${dur}`;
  c.count.textContent = info.external ? '' : S.graph.calls(info.callCount);
  c.mini.textContent = folded ? `${usd} · ${dur} · ${S.graph.calls(info.callCount)}` : '';
}
