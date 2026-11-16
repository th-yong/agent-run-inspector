import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAndStop } from './helpers/launch.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'ari-cli-')));
const run = (args, home, extraEnv = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ARI_NO_UPDATE_CHECK: '1', ...extraEnv },
  });
const cfgFile = (home) => join(home, '.config', 'agent-run-inspector', 'config.json');

test('--help prints English usage, exit 0', () => {
  const r = run(['--help'], tmp());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: ari/);
  for (const f of ['--port', '--no-open', '--root', '--codex-root', '--source', '--since', '--redact', '--prices', '--session']) {
    assert.ok(r.stdout.includes(f), f);
  }
  assert.doesNotMatch(r.stdout, /[가-힣]/);
});

test('unknown option -> usage hint, exit 2', () => {
  const r = run(['--bogus'], tmp());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Error:/);
  assert.match(r.stderr, /--help/);
});

test('unknown command -> exit 2', () => {
  assert.equal(run(['frobnicate'], tmp()).status, 2);
});

test('bad option values -> exit 2', () => {
  const h = tmp();
  for (const a of [['--port', 'abc'], ['--port', '70000'], ['--source', 'x'], ['--since', '7'], ['--redact=loud'], ['--open', '--no-open']]) {
    assert.equal(run(a, h).status, 2, a.join(' '));
  }
});

test('valid option set parses and the server starts', async () => {
  const h = tmp();
  mkdirSync(join(h, 'r'));
  writeFileSync(join(h, 'p.json'), '{}');
  const r = await runAndStop(['--port', '0', '--no-open', '--root', join(h, 'r'), '--source', 'claude', '--since', '7d', '--redact', '--prices', join(h, 'p.json'), '--session', 's1'], h);
  assert.equal(r.code, 0, r.out.stderr);
  const r2 = await runAndStop(['--no-open', '--redact=strict', '--root', join(h, 'r')], h);
  assert.equal(r2.code, 0, r2.out.stderr);
});

test('no log folders -> message and exit 1', () => {
  const r = run([], tmp());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No run logs found/);
});

test('missing --root folder warns', async () => {
  const h = tmp();
  mkdirSync(join(h, '.claude', 'projects'), { recursive: true });
  const r = await runAndStop(['--no-open', '--root', join(h, 'gone')], h);
  assert.match(r.out.stderr, /folder not found/);
});

test('roots add/list/remove changes only the config file', () => {
  const h = tmp();
  const logs = join(h, 'logs');
  mkdirSync(logs);
  writeFileSync(join(logs, 'a.jsonl'), '');
  const before = readdirSync(logs);

  let r = run(['roots', 'add', logs], h);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(cfgFile(h), 'utf8')).claudeRoots, [logs]);
  assert.match(run(['roots', 'add', logs], h).stdout, /Already listed/);

  r = run(['roots', 'add', '--codex', logs], h);
  assert.deepEqual(JSON.parse(readFileSync(cfgFile(h), 'utf8')).codexRoots, [logs]);

  r = run(['roots', 'list'], h);
  assert.match(r.stdout, new RegExp(`claude +${logs}`));
  assert.match(r.stdout, new RegExp(`codex +${logs}`));

  assert.equal(run(['roots', 'remove', logs], h).status, 0);
  assert.equal(run(['roots', 'remove', '--codex', logs], h).status, 0);
  assert.equal(run(['roots', 'remove', logs], h).status, 1);
  const cfg = JSON.parse(readFileSync(cfgFile(h), 'utf8'));
  assert.deepEqual([cfg.claudeRoots, cfg.codexRoots], [[], []]);
  assert.deepEqual(readdirSync(logs), before);
});

test('roots add of a non-directory fails and writes nothing', () => {
  const h = tmp();
  const r = run(['roots', 'add', join(h, 'nope')], h);
  assert.equal(r.status, 2);
  assert.equal(existsSync(cfgFile(h)), false);
});

test('roots usage errors -> exit 2', () => {
  const h = tmp();
  assert.equal(run(['roots'], h).status, 2);
  assert.equal(run(['roots', 'add'], h).status, 2);
  assert.equal(run(['roots', 'zap', 'x'], h).status, 2);
});

test('XDG_CONFIG_HOME is honored and configured roots are used', async () => {
  const h = tmp();
  const xdg = join(h, 'xdg');
  const logs = join(h, 'logs');
  mkdirSync(logs);
  assert.equal(run(['roots', 'add', logs], h, { XDG_CONFIG_HOME: xdg }).status, 0);
  assert.ok(existsSync(join(xdg, 'agent-run-inspector', 'config.json')));
  const r = await runAndStop(['--no-open'], h, { XDG_CONFIG_HOME: xdg });
  assert.equal(r.code, 0, r.out.stderr);
});

test('invalid config file -> exit 2', () => {
  const h = tmp();
  mkdirSync(join(h, '.config', 'agent-run-inspector'), { recursive: true });
  writeFileSync(cfgFile(h), '{nope');
  assert.equal(run(['roots', 'list'], h).status, 2);
});

test('default folders from CLAUDE_CONFIG_DIR / CODEX_HOME are listed', () => {
  const h = tmp();
  mkdirSync(join(h, 'cc', 'projects'), { recursive: true });
  mkdirSync(join(h, 'cx', 'sessions'), { recursive: true });
  const r = run(['roots', 'list'], h, { CLAUDE_CONFIG_DIR: join(h, 'cc'), CODEX_HOME: join(h, 'cx') });
  assert.match(r.stdout, /claude .*cc\/projects +\(default\)/);
  assert.match(r.stdout, /codex .*cx\/sessions +\(default\)/);
});

test('--prices with an unreadable or invalid file -> error, exit 2', () => {
  const home = tmp();
  const bad = join(home, 'bad.json');
  writeFileSync(bad, '{nope');
  for (const f of [bad, join(home, 'missing.json')]) {
    const r = run(['--prices', f, '--no-open'], home);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /price file/i);
  }
});

test('service commands: usage errors and "no service" without an install', () => {
  const h = tmp();
  for (const args of [['open'], ['--service'], ['service', 'install', 'extra'], ['service', 'bogus']]) {
    const r = run(args, h);
    assert.equal(r.status, 2, args.join(' '));
  }
  assert.match(run(['open'], h).stderr, /No service is installed/);
  assert.match(run(['service', 'bogus'], h).stderr, /Usage: ari service/);
});

test('menubar: without a service it prints a SwiftBar notice; install writes into the given folder', () => {
  const h = tmp();
  const r = run(['menubar'], h);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^⚠︎ \| sfimage=/);
  assert.match(r.stdout, /No service is installed/);
  const dir = tmp();
  assert.equal(run(['menubar', 'install', dir], h).status, 0);
  assert.ok(existsSync(join(dir, 'agent-run-inspector.30s.sh')));
  assert.equal(run(['menubar', 'uninstall', dir], h).status, 0);
  assert.ok(!existsSync(join(dir, 'agent-run-inspector.30s.sh')));
  assert.equal(run(['menubar', 'bogus'], h).status, 2);
});
