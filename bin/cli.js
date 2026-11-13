#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { HELP, MSG } from '../src/strings.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { loadPrices } from '../src/cost.js';
import { realDir, resolveRoots } from '../src/roots.js';
import { startApp } from '../src/app.js';
import { OPEN_MODES, openAddress } from '../src/open.js';

const pkgUrl = new URL('../package.json', import.meta.url);
const { version } = JSON.parse(readFileSync(pkgUrl, 'utf8'));

const OPTIONS = {
  port: { type: 'string' },
  open: { type: 'string' },
  'no-open': { type: 'boolean' },
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
  if (positionals.length) throw new UsageError(MSG.unknownCommand(positionals[0]));
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
  let app;
  try {
    app = await startApp({
      config: cfg,
      roots,
      port: values.port === undefined ? 0 : Number(values.port),
      source: values.source,
      since: values.since,
      redact: values.redact,
      prices: values.prices,
      session: values.session,
    });
  } catch (e) {
    if (e.code === 'EADDRINUSE') throw new UsageError(MSG.portInUse(values.port));
    if (e.code === 'EACCES') throw new UsageError(MSG.portDenied(values.port));
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
    console.log(app.url);
    openAddress(app.url, { mode: values['no-open'] ? 'none' : values.open ?? 'auto', env }).catch(() => {});
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
