// Once a day, ask GitHub for the latest release of this project (its version number only). Sends nothing but
// the request itself; any failure (offline, rate limit, timeout) is silent. Off with --no-update-check, ARI_NO_UPDATE_CHECK,
// NO_UPDATE_NOTIFIER or in CI.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from './config.js';

export const URL_LATEST = 'https://api.github.com/repos/th-yong/agent-run-inspector/releases/latest';
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

/** "v0.7.0" -> "0.7.0" (a release tag to a version), or null. */
export const versionOfTag = (tag) => (typeof tag === 'string' ? tag.replace(/^v/, '') : null);

/** The newer released version, or null. */
export async function checkForUpdate({ version, env = process.env, now = Date.now(), fetchImpl = fetch }) {
  if (updateCheckOff(env)) return null;
  const file = join(dirname(configPath(env)), 'update-check.json');
  let cache = {};
  try { cache = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  let latest = typeof cache.latest === 'string' ? cache.latest : null;
  if (!(now - cache.checkedAt < DAY_MS)) {
    try {
      const res = await fetchImpl(URL_LATEST, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(3000) });
      if (res.ok) latest = versionOfTag((await res.json())?.tag_name) ?? latest;
    } catch { /* offline: try again tomorrow */ }
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ checkedAt: now, latest }));
    } catch { /* read-only home: check again next start */ }
  }
  return isNewer(latest, version) ? latest : null;
}
