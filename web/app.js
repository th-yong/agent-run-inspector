import { S } from './strings.js';
import { parseState, toSearch } from './state.js';
import { fetchSession, fetchRoots, watchList, watchSession, mergeSpan, upsertSession, ApiError } from './api.js';
import { mount, emptyBlock } from './session-list.js';
import { createRunHeader } from './run-header.js';
import { createTimeline } from './timeline.js';
import { createGraph } from './graph.js';
import { createAgentPanel } from './agent-panel.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let state = parseState(location.search);
let sessions = null; // null = not loaded yet
let listError = false;
let rootsTried = false;
let roots = null; // folders searched, fetched only when the list is empty
let run = { id: null, status: 'idle', data: null, spans: new Map() };

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

// ---- run screen: head (title, totals strip, tabs) + the view for the chosen tab ----
let head = null; // { id, header } - rebuilt per session so numbers do not roll in from another run
let view = null;
let timeline = null; // rebuilt per session, like the head
let graph = null; // { id, graph } - one per session, like the head
let stopStream = null;

function ensureHead() {
  if (head?.id === state.s) return head.header;
  head?.header.destroy();
  timeline?.destroy();
  timeline = null;
  const header = createRunHeader({
    onBack: () => select(null),
    onTab: (tab) => { state = { ...state, tab }; writeUrl(false); renderMain(); },
    onShowAll: () => { state = { ...state, gsel: null, gopen: null, sel: null, open: null }; writeUrl(false); renderMain(); },
    onHide: (hide) => { state = { ...state, hide }; writeUrl(false); renderMain(); },
  });
  head = { id: state.s, header };
  view = el('div', 'view');
  graph?.graph.destroy();
  graph?.panel.destroy();
  graph = null;
  return header;
}

function renderMain() {
  const main = $('main');
  document.body.dataset.view = state.s ? 'run' : listEmpty() ? 'empty' : 'list';
  if (!state.s) {
    head?.header.destroy();
    timeline?.destroy();
    head = null;
    graph?.graph.destroy();
    graph?.panel.destroy();
    graph = null;
    if (listEmpty()) {
      loadRoots();
      return void main.replaceChildren(emptyBlock(roots));
    }
    return void main.replaceChildren(el('div', 'placeholder', S.run.choose));
  }
  const header = ensureHead();
  const full = run.id === state.s ? run.data?.summary : null; // the detail summary has the title; the list one may not
  const fromList = sessions?.find((s) => s.id === state.s);
  const summary = full ? { ...full, ...(fromList ? { status: fromList.status, end: fromList.end } : {}) } : fromList;
  const spans = run.id === state.s ? [...run.spans.values()] : [];
  const scopeId = state.tab === 'timeline' ? state.sel : state.gsel;
  header.update({ summary, totals: run.id === state.s ? run.data?.totals : null, spans, scopeId, tab: state.tab, hide: state.hide });
  const ready = run.status === 'ready' && run.id === state.s;
  if (ready && state.tab === 'graph') {
    if (graph?.id !== state.s) {
      graph?.graph.destroy();
      graph?.panel.destroy();
      graph = {
        id: state.s,
        graph: createGraph({ onSelect: selectAgent }),
        panel: createAgentPanel({ onOpen: openCall, onClose: closeAgent }),
      };
    }
    if (view.firstChild !== graph.graph.el || view.lastChild !== graph.panel.el) view.replaceChildren(graph.graph.el, graph.panel.el);
    if (main.firstChild !== header.el) main.replaceChildren(header.el, header.tabs, view);
    const agent = state.gsel ? spans.find((s) => s.id === state.gsel && s.kind === 'agent' && !s.external) : null;
    view.classList.toggle('with-panel', Boolean(agent));
    graph.panel.update({ agent, spans, totals: agent ? run.data?.totals?.byAgent?.[agent.id] : null, sessionId: state.s, openId: state.gopen });
    graph.graph.update({ spans, selectedId: state.gsel, hide: state.hide, detailOpen: Boolean(agent) });
    return;
  }
  const note = run.status === 'loading' ? S.run.loading : run.status === 'missing' ? S.run.notFound : run.status === 'error' ? S.run.loadFailed : S.views[state.tab];
  if (state.tab === 'timeline' && run.status === 'ready' && run.id === state.s) {
    timeline ??= createTimeline({ onSelect: (id) => { state = { ...state, sel: id }; writeUrl(false); renderMain(); } });
    timeline.update({ spans, totals: run.data?.totals, sel: state.sel, status: run.status });
    if (view.firstChild !== timeline.el) view.replaceChildren(timeline.el);
  } else {
    timeline?.destroy();
    view.replaceChildren(el('div', 'placeholder', note));
  }
  if (main.firstChild !== header.el) main.replaceChildren(header.el, header.tabs, view);
}

function selectAgent(id) {
  state = { ...state, gsel: state.gsel === id ? null : id, gopen: null };
  writeUrl(false);
  renderMain();
}

function openCall(id) {
  state = { ...state, gopen: id };
  writeUrl(false);
  renderMain();
}

function closeAgent() {
  state = { ...state, gsel: null, gopen: null };
  writeUrl(false);
  renderMain();
}

function stopRun() {
  stopStream?.();
  stopStream = null;
}

async function fetchRun(id, { first }) {
  try {
    const data = await fetchSession(id);
    if (state.s !== id) return;
    run = { id, status: 'ready', data, spans: new Map(data.spans.map((s) => [s.id, s])) };
    if (first && !stopStream) startStream(id);
  } catch (e) {
    if (state.s !== id) return;
    if (first) run = { id, status: e instanceof ApiError && e.status === 404 ? 'missing' : 'error', data: null, spans: new Map() };
  }
  renderMain();
}

function startStream(id) {
  let opened = false;
  stopStream = watchSession(id, {
    onSpan: (span) => { if (run.id === id && run.status === 'ready' && mergeSpan(run.spans, span)) renderMain(); },
    onTotals: (totals) => { if (run.id === id && run.status === 'ready') { run.data = { ...run.data, totals }; renderMain(); } },
    // The first connect right after the load needs no second load; later connects and resync reload everything.
    onReset: () => { if (opened) fetchRun(id, { first: false }); opened = true; },
  });
}

async function loadRun() {
  const id = state.s;
  if (!id) { stopRun(); run = { id: null, status: 'idle', data: null, spans: new Map() }; return; }
  if (run.id === id && (run.status === 'ready' || run.status === 'loading')) return;
  stopRun();
  run = { id, status: 'loading', data: null, spans: new Map() };
  renderMain();
  await fetchRun(id, { first: true });
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
