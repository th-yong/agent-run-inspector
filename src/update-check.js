// Once a day, ask the npm registry for the latest version number. Sends nothing but the request itself;
// any failure (offline, not on npm yet, timeout) is silent. Off with --no-update-check, ARI_NO_UPDATE_CHECK,
// NO_UPDATE_NOTIFIER or in CI.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from './config.js';

const URL_LATEST = 'https://registry.npmjs.org/agent-run-inspector/latest';
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `latest` is a higher plain x.y.z than `current` (pre-releases are ignored). */
export function isNewer(latest, current) {
  const re = /^(\d+)\.(\d+)\.(\d+)$/;
  const a = re.exec(latest ?? '');
  const b = re.exec(current ?? '');
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (+a[i] !== +b[i]) return +a[i] > +b[i];
  return false;
}

export const updateCheckOff = (env) => Boolean(env.CI || env.ARI_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER);

/** The newer version on npm, or null. */
export async function checkForUpdate({ version, env = process.env, now = Date.now(), fetchImpl = fetch }) {
  if (updateCheckOff(env)) return null;
  const file = join(dirname(configPath(env)), 'update-check.json');
  let cache = {};
  try { cache = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  let latest = typeof cache.latest === 'string' ? cache.latest : null;
  if (!(now - cache.checkedAt < DAY_MS)) {
    try {
      const res = await fetchImpl(URL_LATEST, { signal: AbortSignal.timeout(2000) });
      if (res.ok) latest = (await res.json())?.version ?? latest;
    } catch { /* offline: try again tomorrow */ }
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ checkedAt: now, latest }));
    } catch { /* read-only home: check again next start */ }
  }
  return isNewer(latest, version) ? latest : null;
}
