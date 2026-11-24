// Agent roles. `watcher` is never in the records, so it only comes from the config's name patterns
// (watcherNamePatterns, default empty = off). Root agent -> orchestrator (bot when it is an Orca bot's
// session, `bot` set by the parse), everything else -> worker.

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Patterns are case-insensitive, `*` matches any run of characters, and the whole name must match. */
export function compileWatcherPatterns(patterns) {
  return (Array.isArray(patterns) ? patterns : [])
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => new RegExp(`^${p.trim().split('*').map(escapeRe).join('.*')}$`, 'i'));
}

/** Sets `role` on every agent span (in place) and returns the same array. */
export function applyRoles(spans, watcherNamePatterns = []) {
  const res = compileWatcherPatterns(watcherNamePatterns);
  for (const s of spans) {
    if (s.kind !== 'agent') continue;
    const names = [s.name, s.agentType].filter((n) => typeof n === 'string' && n);
    if (res.some((re) => names.some((n) => re.test(n)))) s.role = 'watcher';
    else s.role = (s.depth ?? 0) === 0 && !s.external ? (s.bot ? 'bot' : 'orchestrator') : 'worker';
  }
  return spans;
}
