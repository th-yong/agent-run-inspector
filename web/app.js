import { S } from './strings.js';
import { parseState, toSearch } from './state.js';
import { fetchSession, watchList, upsertSession, ApiError } from './api.js';
import { fmtDuration, fmtTokens } from './format.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let state = parseState(location.search);
let sessions = null; // null = not loaded yet
let listError = false;
let run = { id: null, status: 'idle', data: null };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- address <-> state ----
function writeUrl(push) {
  const next = location.pathname + toSearch(state);
  if (next === location.pathname + location.search) return;
  history[push ? 'pushState' : 'replaceState'](null, '', next);
}

// ---- theme ----
const effectiveTheme = () => state.theme ?? (dark.matches ? 'dark' : 'light');

function applyTheme() {
  if (state.theme) root.dataset.theme = state.theme;
  else delete root.dataset.theme; // follow the system
  const btn = $('themeBtn');
  const label = effectiveTheme() === 'dark' ? S.theme.toLight : S.theme.toDark;
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

// ---- connection indicator ----
function setLive(kind) {
  const text = { connected: S.live.connected, reconnecting: S.live.reconnecting, connecting: S.live.connecting }[kind] ?? S.live.reconnecting;
  $('liveText').textContent = text;
  $('liveDot').className = kind === 'connected' ? 'dot' : kind === 'connecting' ? 'dot off' : 'dot pulse';
}

// ---- list ----
const sortKey = (s) => (s.status === 'running' ? 1e15 : 0) + (s.lastWrite || s.end || s.start || 0);

function sessionRow(s) {
  const row = el('button', 'sess');
  row.type = 'button';
  row.dataset.id = s.id;
  if (s.id === state.s) row.setAttribute('aria-current', 'true');
  const t = el('div', 't');
  const badge = el('span', `badge ${s.source === 'codex' ? 'cx' : 'cc'}`, S.sourceBadge[s.source] ?? '?');
  badge.title = S.sourceTip(S.source[s.source] ?? s.source);
  t.append(badge, el('span', 'name', s.title || S.list.untitled));
  const m = el('div', 'm');
  m.append(el('span', '', s.project ?? ''));
  if (s.start && s.end) m.append(el('span', 'num', fmtDuration(s.end - s.start)));
  m.append(el('span', '', S.list.agents(s.agentCount ?? 0)));
  const tokens = (s.totals?.input ?? 0) + (s.totals?.output ?? 0) + (s.totals?.cacheRead ?? 0);
  m.append(el('span', 'num', `${fmtTokens(tokens)} tok`));
  if (s.status === 'running' || s.status === 'error') {
    m.append(el('span', s.status === 'error' ? 'st-err' : 'st-run', S.status[s.status]));
  }
  row.append(t, m);
  return row;
}

function renderList() {
  const box = $('list');
  box.replaceChildren(el('div', 'list-head', S.list.heading));
  if (listError && !sessions) return void box.append(el('div', 'note', S.list.loadFailed));
  if (!sessions) return void box.append(el('div', 'note', S.list.loading));
  if (!sessions.length) return void box.append(el('div', 'note', S.list.none));
  for (const s of [...sessions].sort((a, b) => sortKey(b) - sortKey(a))) box.append(sessionRow(s));
}

// ---- run screen (header and tabs arrive in later tasks) ----
function renderMain() {
  const main = $('main');
  document.body.dataset.view = state.s ? 'run' : 'list';
  if (!state.s) return void main.replaceChildren(el('div', 'placeholder', S.run.choose));
  const full = run.id === state.s ? run.data?.summary : null; // the detail summary has the title; the list one may not
  const summary = full ?? sessions?.find((s) => s.id === state.s);
  const head = el('div', 'run-head');
  const back = el('button', 'back', S.run.back);
  back.type = 'button';
  back.id = 'backBtn';
  head.append(back, el('div', 'run-title', summary?.title || (summary ? S.list.untitled : '')));
  if (summary) head.append(el('div', 'run-meta', summary.project ?? ''));
  const note = run.status === 'loading' ? S.run.loading : run.status === 'missing' ? S.run.notFound : run.status === 'error' ? S.run.loadFailed : null;
  main.replaceChildren(head, ...(note ? [el('div', 'placeholder', note)] : []));
}

async function loadRun() {
  const id = state.s;
  if (!id) { run = { id: null, status: 'idle', data: null }; return; }
  if (run.id === id && run.status === 'ready') return;
  run = { id, status: 'loading', data: null };
  renderMain();
  try {
    const data = await fetchSession(id);
    if (state.s !== id) return;
    run = { id, status: 'ready', data };
  } catch (e) {
    if (state.s !== id) return;
    run = { id, status: e instanceof ApiError && e.status === 404 ? 'missing' : 'error', data: null };
  }
  renderMain();
}

function render() {
  applyTheme();
  renderList();
  renderMain();
  loadRun();
}

function select(id) {
  state = { ...state, s: id, sel: null, open: null, gsel: null, gopen: null };
  writeUrl(true);
  render();
}

// ---- boot ----
$('appName').textContent = S.appName;
setLive('connecting');

$('list').addEventListener('click', (e) => {
  const row = e.target.closest('.sess');
  if (row) select(row.dataset.id);
});
$('main').addEventListener('click', (e) => {
  if (e.target.closest('#backBtn')) select(null);
});
$('themeBtn').addEventListener('click', () => {
  state = { ...state, theme: effectiveTheme() === 'dark' ? 'light' : 'dark' };
  writeUrl(false);
  applyTheme();
});
dark.addEventListener('change', applyTheme);
window.addEventListener('popstate', () => {
  state = parseState(location.search);
  render();
});

watchList({
  onList: (list) => { sessions = list; listError = false; renderList(); renderMain(); },
  onSession: (summary) => { sessions = upsertSession(sessions ?? [], summary); renderList(); },
  onStatus: (s) => {
    if (s === 'list-error') { listError = true; renderList(); } else setLive(s);
  },
});
render();
