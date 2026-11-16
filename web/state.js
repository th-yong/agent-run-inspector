// Screen state kept in the address bar: ?s ?tab ?sel ?open ?gsel ?gopen ?hide ?theme ?view=mini.
// view=mini is the menu bar popover of the Mac app: run list and graph only.
// Defaults are left out of the address so a plain reload of "/" stays "/".
const THEMES = new Set(['dark', 'light']);
const FIELDS = ['s', 'sel', 'open', 'gsel', 'gopen'];

export function parseState(search) {
  const q = new URLSearchParams(search);
  const state = { tab: q.get('tab') === 'timeline' ? 'timeline' : 'graph', theme: THEMES.has(q.get('theme')) ? q.get('theme') : null, hide: q.get('hide') === '1' };
  for (const k of FIELDS) state[k] = q.get(k) || null;
  const mini = q.get('view') === 'mini';
  return { s: state.s, tab: mini ? 'graph' : state.tab, sel: state.sel, open: state.open, gsel: state.gsel, gopen: state.gopen, hide: state.hide, theme: state.theme, mini };
}

/** Returns "" or "?a=b&...". */
export function toSearch(state) {
  const q = new URLSearchParams();
  if (state.s) q.set('s', state.s);
  if (state.tab === 'timeline') q.set('tab', 'timeline');
  for (const k of ['sel', 'open', 'gsel', 'gopen']) if (state[k]) q.set(k, state[k]);
  if (state.hide) q.set('hide', '1');
  if (THEMES.has(state.theme)) q.set('theme', state.theme);
  if (state.mini) q.set('view', 'mini');
  const text = q.toString();
  return text ? `?${text}` : '';
}
