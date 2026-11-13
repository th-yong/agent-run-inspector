// Opens the inspector address: an Orca browser tab inside Orca, else the default browser.
// Everything runs through execFile with an args array (never a shell string) and never throws.
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

export const OPEN_MODES = ['auto', 'orca', 'browser', 'none'];
const TIMEOUT_MS = 5000;
const defaultExec = promisify(execFile);

export function inOrca(env) {
  return env.TERM_PROGRAM === 'Orca' || Boolean(env.ORCA_WORKTREE_ID);
}

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds `orca` on PATH, then in $ORCA_CLI_BIN_DIR. Returns the full path or null. */
export function findOrca(env, platform = process.platform, canRun = isExecutable) {
  const name = platform === 'win32' ? 'orca.cmd' : 'orca';
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (env.ORCA_CLI_BIN_DIR) dirs.push(env.ORCA_CLI_BIN_DIR);
  for (const d of dirs) {
    const f = join(d, name);
    if (canRun(f)) return f;
  }
  return null;
}

function browserCommand(url, platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

async function openInOrca(url, { env, platform, run, canRun }) {
  const orca = findOrca(env, platform, canRun);
  if (!orca) return false;
  try {
    const { stdout } = await run(orca, ['tab', 'create', '--url', url, '--json'], { timeout: TIMEOUT_MS, env });
    return JSON.parse(String(stdout)).ok === true;
  } catch {
    return false;
  }
}

async function openInBrowser(url, { platform, run, env }) {
  const [file, args] = browserCommand(url, platform);
  try {
    await run(file, args, { timeout: TIMEOUT_MS, env });
    return true;
  } catch {
    return false;
  }
}

/**
 * mode: auto (Orca when detected, else browser) | orca | browser | none.
 * Resolves to 'orca', 'browser' or null (nothing opened). Orca failures fall back to the browser.
 */
export async function openAddress(url, { mode = 'auto', env = process.env, platform = process.platform, run = defaultExec, canRun } = {}) {
  if (mode === 'none') return null;
  const ctx = { env, platform, run, canRun };
  const tryOrca = mode === 'orca' || (mode === 'auto' && inOrca(env));
  if (tryOrca && (await openInOrca(url, ctx))) return 'orca';
  return (await openInBrowser(url, ctx)) ? 'browser' : null;
}
