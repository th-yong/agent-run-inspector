import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRoots, resolveRoots } from '../src/roots.js';
import { configPath } from '../src/config.js';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'ari-roots-')));
const mk = (...p) => { const d = join(...p); mkdirSync(d, { recursive: true }); return d; };

test('defaults come from home', () => {
  const home = tmp();
  const c = mk(home, '.claude', 'projects');
  const x = mk(home, '.codex', 'sessions');
  assert.deepEqual(defaultRoots({ HOME: home }), { claude: [c], codex: [x] });
});

test('CLAUDE_CONFIG_DIR and CODEX_HOME win over home defaults', () => {
  const home = tmp();
  mk(home, '.claude', 'projects');
  mk(home, '.codex', 'sessions');
  const cc = mk(home, 'cc', 'projects');
  const ch = mk(home, 'ch', 'sessions');
  assert.deepEqual(defaultRoots({ HOME: home, CLAUDE_CONFIG_DIR: join(home, 'cc'), CODEX_HOME: join(home, 'ch') }), { claude: [cc], codex: [ch] });
});

test('env override that does not exist falls back to home', () => {
  const home = tmp();
  const c = mk(home, '.claude', 'projects');
  assert.deepEqual(defaultRoots({ HOME: home, CLAUDE_CONFIG_DIR: join(home, 'nope') }).claude, [c]);
});

test('nothing exists -> empty', () => {
  assert.deepEqual(defaultRoots({ HOME: tmp() }), { claude: [], codex: [] });
});

test('merge default, config and flags; dedupe by realpath incl. symlinks', () => {
  const home = tmp();
  const c = mk(home, '.claude', 'projects');
  const extra = mk(home, 'extra');
  symlinkSync(c, join(home, 'link'));
  const r = resolveRoots({
    env: { HOME: home },
    config: { claudeRoots: [join(home, 'link'), extra], codexRoots: [] },
    flags: { root: [extra, join(home, 'gone')] },
    cwd: home,
  });
  assert.deepEqual(r.claude, [{ path: c, origin: 'default' }, { path: extra, origin: 'config' }]);
  assert.deepEqual(r.missing, [join(home, 'gone')]);
});

test('relative --root resolves against cwd', () => {
  const home = tmp();
  const d = mk(home, 'rel');
  const r = resolveRoots({ env: { HOME: home }, config: {}, flags: { root: ['rel'] }, cwd: home });
  assert.equal(r.claude[0].path, d);
});

test('config path honors XDG_CONFIG_HOME', () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: '/x', HOME: '/h' }), '/x/agent-run-inspector/config.json');
  assert.equal(configPath({ HOME: '/h' }), '/h/.config/agent-run-inspector/config.json');
});
