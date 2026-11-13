import { S } from './strings.js';
import { parseState, toSearch } from './state.js';
import { fetchSession, fetchRoots, watchList, upsertSession, ApiError } from './api.js';
import { mount, emptyBlock } from './session-list.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let state = parseState(location.search);
let sessions = null; // null = not loaded yet
let listError = false;
let rootsTried = false;
let roots = null; // folders searched, fetched only when the list is empty
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
const list = mount($('list'), {
  onSelect: (id) => select(id),
  getSelected: () => state.s,
});

function renderList() {
  list.update({ sessions, error: listError });
}

const listEmpty = () => sessions !== null && sessions.length === 0;

async function loadRoots() {
  if (rootsTried) return;
  rootsTried = true;
  try { roots = await fetchRoots(); } catch { roots = null; }
  if (listEmpty()) renderMain();
}

// ---- run screen (header and tabs arrive in later tasks) ----
function renderMain() {
  const main = $('main');
  document.body.dataset.view = state.s ? 'run' : listEmpty() ? 'empty' : 'list';
  if (!state.s && listEmpty()) {
    loadRoots();
    return void main.replaceChildren(emptyBlock(roots));
  }
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
  onList: (all) => { sessions = all; listError = false; renderList(); renderMain(); },
  onSession: (summary) => { sessions = upsertSession(sessions ?? [], summary); renderList(); },
  onStatus: (s) => {
    if (s === 'list-error') { listError = true; renderList(); } else setLive(s);
  },
});
render();
