// Session list column: filters, search, running-first grouping, empty states. Pure helpers are exported for tests;
// the DOM part only touches `document` when mount() is called.
import { S } from './strings.js';
import { fmtDuration, fmtTokens } from './format.js';
import { hasIcon, getIcon } from './icons.js';

export const PERIODS = ['today', '7d', '30d', 'all'];
export const SOURCES = ['all', 'claude-code', 'codex'];
const DAY = 24 * 60 * 60 * 1000;
const PROVIDER_SLUG = { anthropic: 'claude', openai: 'openai', google: 'googlegemini' };

const touched = (s) => s.lastWrite || s.end || s.start || 0;

/** Model name -> provider, same rules as the server (src/model/provider.js). */
export function providerOf(model) {
  if (typeof model !== 'string') return 'other';
  let name = model.trim().toLowerCase();
  const slash = name.lastIndexOf('/');
  if (slash !== -1) name = name.slice(slash + 1);
  if (!name) return 'other';
  if (name.startsWith('claude-') || name.includes('-claude') || /^(opus|sonnet|haiku|fable)/.test(name)) return 'anthropic';
  if (/^(gpt-|o1|o3|o4|codex)/.test(name)) return 'openai';
  if (name.includes('gemini')) return 'google';
  return 'other';
}

/** Distinct provider logos (simple-icons slugs) for a session's models, in first-seen order; unknown providers are left out. */
export function providerSlugs(models) {
  const out = [];
  for (const m of Array.isArray(models) ? models : []) {
    const slug = PROVIDER_SLUG[providerOf(m)];
    if (slug && hasIcon(slug) && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** Earliest time (ms) a session may have been touched to stay in the period; 0 for "all". */
export function periodStart(period, now) {
  if (period === '7d') return now - 7 * DAY;
  if (period === '30d') return now - 30 * DAY;
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return 0;
}

/** Sessions that are running always stay, whatever the period. */
export function filterSessions(sessions, { source = 'all', period = 'all', query = '' } = {}, now = Date.now()) {
  const since = periodStart(period, now);
  const q = String(query).trim().toLowerCase();
  return sessions.filter((s) => {
    if (source !== 'all' && s.source !== source) return false;
    if (s.status !== 'running' && since && touched(s) < since) return false;
    if (q && !`${s.title ?? ''}\n${s.project ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Running sessions first (pinned), then the rest; each newest first. */
export function groupSessions(sessions) {
  const byNew = (a, b) => touched(b) - touched(a);
  return {
    running: sessions.filter((s) => s.status === 'running').sort(byNew),
    recent: sessions.filter((s) => s.status !== 'running').sort(byNew),
  };
}

/** The next wider period, or null when already "all". */
export function widerPeriod(period) {
  const i = PERIODS.indexOf(period);
  return i >= 0 && i < PERIODS.length - 1 ? PERIODS[i + 1] : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/** Local start time: "11:05" today, "Mar 3 11:05" otherwise. */
export function fmtStart(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  const n = new Date(now);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

// ---- DOM ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG = 'http://www.w3.org/2000/svg';
export function iconEl(slug) {
  const icon = getIcon(slug);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'pi');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--il', icon.light);
  svg.style.setProperty('--id', icon.dark);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', icon.path);
  svg.append(path);
  return svg;
}

export function sessionRow(s, { selected = false, now = Date.now() } = {}) {
  const row = el('button', 'sess');
  row.type = 'button';
  row.dataset.id = s.id;
  if (selected) row.setAttribute('aria-current', 'true');
  const t = el('div', 't');
  const badge = el('span', `badge ${s.source === 'codex' ? 'cx' : 'cc'}`, S.sourceBadge[s.source] ?? '?');
  badge.title = S.sourceTip(S.source[s.source] ?? s.source);
  t.append(badge, el('span', 'name', s.title || S.list.untitled));
  if (s.status === 'running') {
    const dot = el('span', 'dot pulse');
    dot.title = S.status.running;
    t.append(dot);
  }
  const m = el('div', 'm');
  const slugs = providerSlugs(s.models);
  if (slugs.length) {
    const box = el('span', 'provs');
    box.title = S.list.providers;
    for (const slug of slugs) box.append(iconEl(slug));
    m.append(box);
  }
  if (s.project) m.append(el('span', 'proj', s.project));
  m.append(el('span', 'num', fmtStart(s.start, now)));
  if (s.start && s.end) m.append(el('span', 'num', fmtDuration(s.end - s.start)));
  m.append(el('span', '', S.list.agents(s.agentCount ?? 0)));
  const tokens = (s.totals?.input ?? 0) + (s.totals?.output ?? 0) + (s.totals?.cacheRead ?? 0);
  m.append(el('span', 'num', `${fmtTokens(tokens)} tok`));
  if (s.status === 'running' || s.status === 'error') {
    m.append(el('span', s.status === 'error' ? 'st-err' : 'st-run', s.status === 'error' ? `▲ ${S.status.error}` : S.status.running));
  }
  if (s.origin && s.origin !== 'default') {
    const o = el('span', 'origin', s.origin);
    o.title = S.list.originTip(s.origin);
    m.append(o);
  }
  row.append(t, m);
  return row;
}

/** Empty state shown in the main area when no log folder yields a session. `roots` = [{source, path, origin}] or null. */
export function emptyBlock(roots) {
  const box = el('div', 'empty');
  box.append(el('h2', '', S.empty.title), el('p', '', S.empty.body));
  const ul = el('ul');
  if (roots === null) ul.append(el('li', '', S.empty.rootsUnknown));
  else if (!roots.length) ul.append(el('li', '', S.empty.noRoots));
  else {
    for (const r of roots) {
      const li = el('li');
      li.append(el('span', 'path', r.path), el('span', 'faint', `${S.source[r.source] ?? r.source} · ${r.origin ?? 'default'}`));
      ul.append(li);
    }
  }
  box.append(ul, el('p', '', S.empty.hint));
  const code = el('code', '', S.empty.command);
  box.append(code);
  return box;
}

/**
 * Builds the list column once (search box and chips stay put so typing is never interrupted) and returns
 * { update({ sessions, error }), filter() }. `onSelect(id)` is called when a row is chosen.
 */
export function mount(box, { onSelect, getSelected, onFilter }) {
  const filter = { source: 'all', period: 'all', query: '' };
  let data = { sessions: null, error: false };

  const head = el('div', 'list-head');
  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = S.list.searchPlaceholder;
  search.setAttribute('aria-label', S.list.searchPlaceholder);
  const srcSeg = el('div', 'seg');
  srcSeg.setAttribute('role', 'group');
  srcSeg.setAttribute('aria-label', S.list.sourceLabel);
  const chips = el('div', 'row-flex');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', S.list.periodLabel);
  const srcBtns = SOURCES.map((v) => {
    const b = el('button', '', S.list.sources[v]);
    b.type = 'button';
    b.dataset.v = v;
    srcSeg.append(b);
    return b;
  });
  const perBtns = PERIODS.map((v) => {
    const b = el('button', 'chip', S.list.periods[v]);
    b.type = 'button';
    b.dataset.v = v;
    chips.append(b);
    return b;
  });
  const filters = el('div', 'row-flex wrap');
  filters.append(srcSeg);
  head.append(search, filters, chips);
  const body = el('div', 'list-body');
  box.replaceChildren(head, body);

  function note(text, ...extra) {
    const n = el('div', 'note', text);
    n.append(...extra);
    return n;
  }

  function paint() {
    for (const b of srcBtns) b.setAttribute('aria-pressed', String(b.dataset.v === filter.source));
    for (const b of perBtns) b.setAttribute('aria-pressed', String(b.dataset.v === filter.period));
    const { sessions, error } = data;
    if (!sessions) return void body.replaceChildren(note(error ? S.list.loadFailed : S.list.loading));
    if (!sessions.length) return void body.replaceChildren(note(S.list.none));
    const now = Date.now();
    const shown = filterSessions(sessions, filter, now);
    if (!shown.length) {
      const wider = widerPeriod(filter.period);
      const btn = el('button', 'link', wider ? S.list.widen : S.list.clear);
      btn.type = 'button';
      btn.dataset.act = wider ? 'widen' : 'clear';
      return void body.replaceChildren(note(wider ? S.list.noneInRange : S.list.noneMatch, btn));
    }
    const { running, recent } = groupSessions(shown);
    const selected = getSelected();
    const parts = [];
    for (const [label, list] of [[S.list.running, running], [S.list.recent, recent]]) {
      if (!list.length) continue;
      parts.push(el('div', 'group-label', label));
      for (const s of list) parts.push(sessionRow(s, { selected: s.id === selected, now }));
    }
    body.replaceChildren(...parts);
  }

  function change(next) {
    Object.assign(filter, next);
    paint();
    onFilter?.({ ...filter });
  }

  search.addEventListener('input', () => change({ query: search.value }));
  srcSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) change({ source: b.dataset.v });
  });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) change({ period: b.dataset.v });
  });
  body.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'widen') {
      change({ period: widerPeriod(filter.period) ?? 'all' });
      return;
    }
    if (act?.dataset.act === 'clear') {
      search.value = '';
      change({ source: 'all', period: 'all', query: '' });
      return;
    }
    const row = e.target.closest('.sess');
    if (row) onSelect(row.dataset.id);
  });

  paint();
  return {
    update(next) { data = next; paint(); },
    filter: () => ({ ...filter }),
  };
}
