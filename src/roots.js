import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function realDir(p) {
  try {
    const real = realpathSync(p);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

// First existing candidate wins: env override, then the home default.
export function defaultRoots(env = process.env) {
  const home = env.HOME || homedir();
  const pick = (cands) => {
    for (const c of cands.filter(Boolean)) {
      const real = realDir(c);
      if (real) return [real];
    }
    return [];
  };
  return {
    claude: pick([env.CLAUDE_CONFIG_DIR && join(env.CLAUDE_CONFIG_DIR, 'projects'), join(home, '.claude', 'projects')]),
    codex: pick([env.CODEX_HOME && join(env.CODEX_HOME, 'sessions'), join(home, '.codex', 'sessions')]),
  };
}

// Merge defaults, config and flags. De-duplicated by realpath; missing folders are reported, not used.
// Each entry: { path, origin: 'default' | 'config' | 'flag' }.
export function resolveRoots({ env = process.env, config, flags = {}, cwd = process.cwd() }) {
  const defs = defaultRoots(env);
  const out = { claude: [], codex: [], missing: [] };
  const add = (kind, p, origin) => {
    const real = realDir(resolve(cwd, p));
    if (!real) return out.missing.push(resolve(cwd, p));
    if (!out[kind].some((r) => r.path === real)) out[kind].push({ path: real, origin });
  };
  for (const p of defs.claude) add('claude', p, 'default');
  for (const p of defs.codex) add('codex', p, 'default');
  for (const p of config?.claudeRoots ?? []) add('claude', p, 'config');
  for (const p of config?.codexRoots ?? []) add('codex', p, 'config');
  for (const p of flags.root ?? []) add('claude', p, 'flag');
  for (const p of flags.codexRoot ?? []) add('codex', p, 'flag');
  return out;
}
