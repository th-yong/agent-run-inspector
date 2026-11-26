#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { resolve } from 'node:path';
import { HELP, MSG } from '../src/strings.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { loadPrices } from '../src/cost.js';
import { realDir, resolveRoots } from '../src/roots.js';
import { startApp } from '../src/app.js';
import { OPEN_MODES, openAddress } from '../src/open.js';
import { checkForUpdate } from '../src/update-check.js';
import {
  COOKIE_MAX_AGE, DEFAULT_PORT, ServiceError, appDir, buildApp, installLoginItem, installService, loadService, logFile, serviceUrl, stableNode, uninstallService,
} from '../src/service.js';
import { pinToDock, unpinFromDock } from '../src/dock.js';

const pkgUrl = new URL('../package.json', import.meta.url);
const { version } = JSON.parse(readFileSync(pkgUrl, 'utf8'));

const OPTIONS = {
  port: { type: 'string' },
  open: { type: 'string' },
  'no-open': { type: 'boolean' },
  'no-update-check': { type: 'boolean' },
  'no-dock': { type: 'boolean' },
  service: { type: 'boolean' }, // set by the LaunchAgent (ari service install), not meant to be typed
  root: { type: 'string', multiple: true },
  'codex-root': { type: 'string', multiple: true },
  source: { type: 'string' },
  since: { type: 'string' },
  redact: { type: 'string' },
  prices: { type: 'string' },
  session: { type: 'string' },
  codex: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

class UsageError extends Error {}

// parseArgs has no optional values, so a bare --redact becomes --redact=basic and a bare --open becomes --open=auto.
function parseCli(argv) {
  const fixed = argv.map((a) => (a === '--redact' ? '--redact=basic' : a === '--open' ? '--open=auto' : a));
  let parsed;
  try {
    parsed = parseArgs({ args: fixed, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError(MSG.unknownOption(e.message.split('\n')[0]));
  }
  const v = parsed.values;
  if (v.port !== undefined && !(/^\d+$/.test(v.port) && Number(v.port) <= 65535)) {
    throw new UsageError(MSG.badValue('--port', '0-65535'));
  }
  if (v.source !== undefined && !['claude', 'codex', 'all'].includes(v.source)) {
    throw new UsageError(MSG.badValue('--source', 'claude, codex or all'));
  }
  if (v.since !== undefined && !/^[1-9]\d*[hd]$/.test(v.since)) {
    throw new UsageError(MSG.badValue('--since', 'e.g. 24h, 7d'));
  }
  if (v.redact !== undefined && !['basic', 'strict'].includes(v.redact)) {
    throw new UsageError(MSG.badValue('--redact', 'only --redact or --redact=strict'));
  }
  if (v.open !== undefined && !OPEN_MODES.includes(v.open)) {
    throw new UsageError(MSG.badValue('--open', 'auto, orca, browser or none'));
  }
  if (v.open !== undefined && v['no-open']) throw new UsageError(MSG.conflictOpen);
  return parsed;
}

function loadConfigOrFail(env) {
  try {
    return loadConfig(env);
  } catch (e) {
    if (e.code !== 'ECONFIG') throw e;
    throw new UsageError(MSG.badConfig(e.file));
  }
}

function rootsCommand(positionals, values, env) {
  const [, action, dir, ...extra] = positionals;
  const cfg = loadConfigOrFail(env);
  const key = values.codex ? 'codexRoots' : 'claudeRoots';
  if (action === 'list' && !dir) {
    const r = resolveRoots({ env, config: cfg });
    const lines = [
      ...r.claude.map((x) => MSG.rootLine('claude', x.path, x.origin)),
      ...r.codex.map((x) => MSG.rootLine('codex', x.path, x.origin)),
    ];
    console.log(lines.length ? lines.join('\n') : MSG.rootsNone);
    return 0;
  }
  if ((action !== 'add' && action !== 'remove') || extra.length) throw new UsageError(MSG.rootsUsage);
  if (!dir) throw new UsageError(MSG.rootsNeedDir);
  const abs = resolve(dir);
  if (action === 'add') {
    const real = realDir(abs);
    if (!real) throw new UsageError(MSG.notADirectory(abs));
    if (cfg[key].some((p) => p === real || realDir(p) === real)) {
      console.log(MSG.rootExists(real));
      return 0;
    }
    cfg[key].push(real);
    saveConfig(cfg, env);
    console.log(MSG.rootAdded(real));
    return 0;
  }
  const real = realDir(abs);
  const keep = cfg[key].filter((p) => p !== abs && p !== real && (!real || realDir(p) !== real));
  if (keep.length === cfg[key].length) {
    console.log(MSG.rootNotFound(abs));
    return 1;
  }
  cfg[key] = keep;
  saveConfig(cfg, env);
  console.log(MSG.rootRemoved(abs));
  return 0;
}

async function serviceCommand(positionals, values, env) {
  const [, action, ...extra] = positionals;
  if ((action !== 'install' && action !== 'uninstall') || extra.length) throw new UsageError(MSG.serviceUsage);
  const run = promisify(execFile);
  try {
    if (action === 'uninstall') {
      if (process.platform === 'darwin' && (await unpinFromDock(appDir(env), run).catch(() => false))) console.log(MSG.dockRemoved);
      console.log((await uninstallService({ env, run })) ? MSG.serviceRemoved : MSG.serviceNone);
      return 0;
    }
    const port = values.port === undefined ? loadService(env)?.port ?? DEFAULT_PORT : Number(values.port);
    if (port === 0) throw new UsageError(MSG.badValue('--port', '1-65535 for a service'));
    const s = await installService({ env, port, node: stableNode(env), cli: fileURLToPath(import.meta.url), run });
    console.log(MSG.serviceInstalled(`http://127.0.0.1:${s.port}/`, logFile(env)));
    const app = await buildApp({ env, run, version }).catch(() => null); // the service is fine without the app
    console.log(app ? MSG.appBuilt(app) : MSG.appFailed);
    if (app) await installLoginItem({ env, app, run }); // at login: menu bar item only, window on demand
    if (app && !values['no-dock'] && (await pinToDock(app, run).catch(() => false))) console.log(MSG.dockAdded);
    if (!values['no-open']) {
      console.log(MSG.star); // a person ran it; the app's own updates pass --no-open
      if (app) await run('open', [app]).catch(() => {});
      else await openAddress(serviceUrl(s), { mode: values.open ?? 'browser', env }).catch(() => {});
    }
    return 0;
  } catch (e) {
    if (e instanceof ServiceError) throw new UsageError(e.message);
    if (e.code === 'ENOENT' || e.stderr !== undefined) throw new UsageError(MSG.serviceFailed(String(e.stderr || e.message).trim()));
    throw e;
  }
}

async function openCommand(values, env) {
  const s = loadService(env);
  if (!s) throw new UsageError(MSG.serviceNone);
  await openAddress(serviceUrl(s), { mode: values['no-open'] ? 'none' : values.open ?? 'auto', env });
  return 0;
}

async function main(argv, env) {
  const { values, positionals } = parseCli(argv);
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(version);
    return 0;
  }
  if (positionals[0] === 'roots') return rootsCommand(positionals, values, env);
  if (positionals[0] === 'service') return serviceCommand(positionals, values, env);
  if (positionals[0] === 'open' && positionals.length === 1) return openCommand(values, env);
  if (positionals.length) throw new UsageError(MSG.unknownCommand(positionals[0]));
  // Service mode: fixed port and token from the token file, a lasting cookie, no address printed (the log is not secret).
  const svc = values.service ? loadService(env) : null;
  if (values.service && !svc) throw new UsageError(MSG.serviceNone);
  const cfg = loadConfigOrFail(env);
  try {
    loadPrices({ file: values.prices, config: cfg.prices }); // fail early on a bad price file
  } catch (e) {
    if (e.code !== 'EPRICES') throw e;
    throw new UsageError(MSG.badPrices(e.message));
  }
  const roots = resolveRoots({
    env,
    config: cfg,
    flags: { root: values.root, codexRoot: values['codex-root'] },
  });
  for (const p of roots.missing) console.error(`Warning: folder not found: ${p}`);
  if (!roots.claude.length && !roots.codex.length) {
    console.error(MSG.noRoots);
    return 1;
  }
  const meta = { version, latest: null }; // /api/meta: the web header shows the version and a newer one
  let app;
  try {
    app = await startApp({
      meta,
      config: cfg,
      roots,
      port: svc ? svc.port : values.port === undefined ? 0 : Number(values.port),
      ...(svc ? { token: svc.token, cookieMaxAge: COOKIE_MAX_AGE } : {}),
      source: values.source,
      since: values.since,
      redact: values.redact,
      prices: values.prices,
      session: values.session,
    });
  } catch (e) {
    if (e.code === 'EADDRINUSE') throw new UsageError(MSG.portInUse(svc?.port ?? values.port));
    if (e.code === 'EACCES') throw new UsageError(MSG.portDenied(svc?.port ?? values.port));
    throw e;
  }
  return new Promise((done) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      app.close().then(() => done(0), () => done(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // Print only after the handlers exist: a signal that arrives before then would kill the process with the default action.
    if (svc) console.log(MSG.serviceStarted(`http://127.0.0.1:${svc.port}/`));
    else {
      console.log(app.url);
      openAddress(app.url, { mode: values['no-open'] ? 'none' : values.open ?? 'auto', env }).catch(() => {});
    }
    if (!values['no-update-check']) {
      const check = () => checkForUpdate({ version, env }).then((v) => {
        meta.latest = v;
        if (v && !stopping) console.error(MSG.updateAvailable(version, v));
      }, () => {});
      check();
      setInterval(check, 60 * 60 * 1000).unref(); // a long run (the service, the app) hears of a release within the hour
    }
  });
}

try {
  process.exitCode = await main(process.argv.slice(2), process.env);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(e.message);
  console.error('Run "ari --help" for usage.');
  process.exitCode = 2;
}
