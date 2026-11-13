import { readFileSync } from 'node:fs';

const BRAND_MAP = JSON.parse(readFileSync(new URL('../../brand-map.json', import.meta.url), 'utf8'));

const SHELL_TOOLS = new Set(['bash', 'exec', 'exec_command', 'shell']);
const WRAPPERS = new Set(['sudo', 'env', 'time']);

const BY_NAME = new Map();
const BY_CMD = new Map();
for (const t of BRAND_MAP.tools) {
  for (const n of t.names) BY_NAME.set(n.toLowerCase(), t.slug);
  for (const c of t.cmds) BY_CMD.set(c.toLowerCase(), t.slug);
}

export function isShellTool(name) {
  return SHELL_TOOLS.has(String(name).toLowerCase());
}

/** First real command word: skips VAR=value, sudo, env, time and option flags after them; strips the path. */
export function firstCommandWord(command) {
  if (typeof command !== 'string') return null;
  const words = command.trim().split(/\s+/);
  let wrapped = false;
  for (const w of words) {
    if (!w) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (WRAPPERS.has(w.toLowerCase())) { wrapped = true; continue; }
    if (wrapped && w.startsWith('-')) continue;
    const base = w.slice(w.lastIndexOf('/') + 1);
    return base ? base.toLowerCase() : null;
  }
  return null;
}

/**
 * simple-icons slug from brand-map.json, or undefined. Failed calls never get a brand.
 * @param {{ name: string, command?: string, isError?: boolean }} tool
 */
export function toolBrandOf({ name, command, isError }) {
  if (isError || typeof name !== 'string') return undefined;
  const lower = name.toLowerCase();
  if (lower.startsWith('mcp__')) {
    const server = lower.split('__')[1];
    return server ? BY_NAME.get(server) : undefined;
  }
  if (SHELL_TOOLS.has(lower)) {
    const word = firstCommandWord(command);
    return word ? BY_CMD.get(word) : undefined;
  }
  const head = lower.split(/[.:/]/)[0];
  return BY_NAME.get(head);
}
