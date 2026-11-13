import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function configPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'agent-run-inspector', 'config.json');
}

const LISTS = ['claudeRoots', 'codexRoots', 'watcherNamePatterns'];

// Missing file -> defaults. Unreadable or invalid JSON -> throws an Error with code 'ECONFIG'.
export function loadConfig(env = process.env) {
  const file = configPath(env);
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return normalize({});
    throw Object.assign(new Error(file), { code: 'ECONFIG', file });
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    throw Object.assign(new Error(file), { code: 'ECONFIG', file });
  }
}

function normalize(obj) {
  const o = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const cfg = { ...o };
  for (const k of LISTS) cfg[k] = Array.isArray(o[k]) ? o[k].filter((x) => typeof x === 'string') : [];
  cfg.prices = o.prices && typeof o.prices === 'object' && !Array.isArray(o.prices) ? o.prices : {};
  return cfg;
}

export function saveConfig(cfg, env = process.env) {
  const file = configPath(env);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, file);
}
