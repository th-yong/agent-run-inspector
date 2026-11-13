// Screen state kept in the address bar: ?s ?tab ?sel ?open ?gsel ?gopen ?theme.
// Defaults are left out of the address so a plain reload of "/" stays "/".
const THEMES = new Set(['dark', 'light']);
const FIELDS = ['s', 'sel', 'open', 'gsel', 'gopen'];

export function parseState(search) {
  const q = new URLSearchParams(search);
  const state = { tab: q.get('tab') === 'timeline' ? 'timeline' : 'graph', theme: THEMES.has(q.get('theme')) ? q.get('theme') : null };
  for (const k of FIELDS) state[k] = q.get(k) || null;
  return { s: state.s, tab: state.tab, sel: state.sel, open: state.open, gsel: state.gsel, gopen: state.gopen, theme: state.theme };
}

/** Returns "" or "?a=b&...". */
export function toSearch(state) {
  const q = new URLSearchParams();
  if (state.s) q.set('s', state.s);
  if (state.tab === 'timeline') q.set('tab', 'timeline');
  for (const k of ['sel', 'open', 'gsel', 'gopen']) if (state[k]) q.set(k, state[k]);
  if (THEMES.has(state.theme)) q.set('theme', state.theme);
  const text = q.toString();
  return text ? `?${text}` : '';
}
