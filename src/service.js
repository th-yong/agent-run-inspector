// Service mode (macOS): a LaunchAgent keeps the server running on a fixed port from login.
// The token lives in a 0600 file the server reads itself; it never goes into the plist
// (world-readable), the process arguments (visible in ps) or the log.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { configPath } from './config.js';
import { newToken } from './server/auth.js';

export const LABEL = 'io.github.th-yong.agent-run-inspector';
export const DEFAULT_PORT = 7317;
export const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // seconds
const PASS_ENV = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME'];

const home = (env) => env.HOME || homedir();
export const serviceFile = (env) => join(dirname(configPath(env)), 'service.json');
export const plistFile = (env) => join(home(env), 'Library', 'LaunchAgents', `${LABEL}.plist`);
export const logFile = (env) => join(home(env), 'Library', 'Logs', 'agent-run-inspector.log');

/** { port, token } or null when no service was installed. */
export function loadService(env) {
  try {
    const s = JSON.parse(readFileSync(serviceFile(env), 'utf8'));
    return Number.isInteger(s.port) && typeof s.token === 'string' && s.token ? { port: s.port, token: s.token } : null;
  } catch {
    return null;
  }
}

/** Keeps an existing token (so installed apps stay signed in) and sets the port. */
export function saveService(env, port) {
  const s = { port, token: loadService(env)?.token ?? newToken() };
  const file = serviceFile(env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
  chmodSync(file, 0o600); // writeFileSync keeps the mode of an existing file
  return s;
}

/**
 * The `node` on PATH when it is this same binary (e.g. /opt/homebrew/bin/node), else `execPath`:
 * a versioned path like .../Cellar/node/25.1.0/bin/node breaks on the next Node upgrade.
 */
export function stableNode(env, execPath = process.execPath) {
  const real = (p) => { try { return realpathSync(p); } catch { return null; } };
  for (const d of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const p = join(d, 'node');
    if (real(p) && real(p) === real(execPath)) return p;
  }
  return execPath;
}

export const serviceUrl = (s) => `http://127.0.0.1:${s.port}/?t=${s.token}`;

const xml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildPlist({ node, cli, env }) {
  const vars = PASS_ENV.filter((k) => env[k]).map((k) => `    <key>${k}</key><string>${xml(env[k])}</string>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(cli)}</string>
    <string>--service</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>Crashed</key><true/></dict>
  <key>StandardOutPath</key><string>${xml(logFile(env))}</string>
  <key>StandardErrorPath</key><string>${xml(logFile(env))}</string>
${vars.length ? `  <key>EnvironmentVariables</key>\n  <dict>\n${vars.join('\n')}\n  </dict>\n` : ''}</dict>
</plist>
`;
}

export class ServiceError extends Error {}

/**
 * Writes the token file and the LaunchAgent, then (re)starts it. Running it again restarts the
 * service on the current code, e.g. after an upgrade.
 * @param {{ env: object, port: number, node: string, cli: string, platform?: string, uid?: number,
 *   run: (file: string, args: string[]) => Promise<unknown> }} o
 */
export async function installService({ env, port, node, cli, platform = process.platform, uid = process.getuid?.(), run }) {
  if (platform !== 'darwin') throw new ServiceError('service: only macOS is supported for now');
  if (/[\\/]_npx[\\/]/.test(cli)) throw new ServiceError('service: install the package first (npm i -g agent-run-inspector); the npx cache is pruned');
  const s = saveService(env, port);
  mkdirSync(dirname(plistFile(env)), { recursive: true });
  mkdirSync(dirname(logFile(env)), { recursive: true });
  writeFileSync(plistFile(env), buildPlist({ node, cli, env }));
  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {}); // not loaded yet is fine
  await run('launchctl', ['bootstrap', `gui/${uid}`, plistFile(env)]);
  return s;
}

/** Stops the LaunchAgent and removes it and the token file. Returns false if nothing was installed. */
export async function uninstallService({ env, platform = process.platform, uid = process.getuid?.(), run }) {
  if (platform !== 'darwin') throw new ServiceError('service: only macOS is supported for now');
  const had = existsSync(plistFile(env)) || existsSync(serviceFile(env));
  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  rmSync(plistFile(env), { force: true });
  rmSync(serviceFile(env), { force: true });
  return had;
}
