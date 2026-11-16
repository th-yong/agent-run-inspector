import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAddress, findOrca, inOrca } from '../src/open.js';
import { launch, addressOf } from './helpers/launch.js';

const URL1 = 'http://127.0.0.1:1234/?t=abc&s=x';
const ORCA_ENV = { TERM_PROGRAM: 'Orca', PATH: '/bin' };
const canRun = () => true;

function recorder(handler) {
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return handler(file, args);
  };
  return { calls, exec };
}
const okJson = JSON.stringify({ ok: true, result: { browserPageId: 'p1' } });

test('inOrca: TERM_PROGRAM=Orca or ORCA_WORKTREE_ID', () => {
  assert.equal(inOrca({ TERM_PROGRAM: 'Orca' }), true);
  assert.equal(inOrca({ ORCA_WORKTREE_ID: 'w' }), true);
  assert.equal(inOrca({ TERM_PROGRAM: 'iTerm.app' }), false);
  assert.equal(inOrca({}), false);
});

test('findOrca: PATH first, then ORCA_CLI_BIN_DIR, else null', () => {
  const only = (p) => (f) => f === p;
  assert.equal(findOrca({ PATH: '/a:/b', ORCA_CLI_BIN_DIR: '/c' }, 'linux', only('/b/orca')), '/b/orca');
  assert.equal(findOrca({ PATH: '/a', ORCA_CLI_BIN_DIR: '/c' }, 'linux', only('/c/orca')), '/c/orca');
  assert.equal(findOrca({ PATH: '/a' }, 'linux', () => false), null);
});

test('Orca success: tab create with args array, no browser', async () => {
  const r = recorder(() => ({ stdout: okJson }));
  const got = await openAddress(URL1, { env: ORCA_ENV, platform: 'darwin', run: r.exec, canRun });
  assert.equal(got, 'orca');
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].args, ['tab', 'create', '--url', URL1, '--json']);
  assert.equal(r.calls[0].opts.timeout, 5000);
  assert.ok(!r.calls[0].args.includes('--split'));
});

test('Orca ok:false falls back to the default browser', async () => {
  const r = recorder((file) => ({ stdout: file.endsWith('orca') ? '{"ok":false}' : '' }));
  const got = await openAddress(URL1, { env: ORCA_ENV, platform: 'darwin', run: r.exec, canRun });
  assert.equal(got, 'browser');
  assert.deepEqual([r.calls[1].file, r.calls[1].args], ['open', [URL1]]);
});

test('Orca exit error, bad JSON and timeout fall back to xdg-open', async () => {
  for (const fail of [() => { throw new Error('exit 1'); }, () => ({ stdout: 'not json' }), () => { throw Object.assign(new Error('t'), { killed: true, signal: 'SIGTERM' }); }]) {
    const r = recorder((file) => (file.endsWith('orca') ? fail() : { stdout: '' }));
    const got = await openAddress(URL1, { env: ORCA_ENV, platform: 'linux', run: r.exec, canRun });
    assert.equal(got, 'browser');
    assert.equal(r.calls.at(-1).file, 'xdg-open');
  }
});

test('orca binary missing: straight to the browser', async () => {
  const r = recorder(() => ({ stdout: '' }));
  const got = await openAddress(URL1, { env: ORCA_ENV, platform: 'darwin', run: r.exec, canRun: () => false });
  assert.equal(got, 'browser');
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].file, 'open');
});

test('not in Orca: never calls orca', async () => {
  const r = recorder(() => ({ stdout: okJson }));
  const got = await openAddress(URL1, { env: { PATH: '/bin' }, platform: 'darwin', run: r.exec, canRun });
  assert.equal(got, 'browser');
  assert.deepEqual(r.calls.map((c) => c.file), ['open']);
});

test('mode none opens nothing; mode browser skips Orca; mode orca tries Orca outside Orca', async () => {
  let r = recorder(() => ({ stdout: okJson }));
  assert.equal(await openAddress(URL1, { mode: 'none', env: ORCA_ENV, run: r.exec, canRun }), null);
  assert.equal(r.calls.length, 0);
  r = recorder(() => ({ stdout: okJson }));
  assert.equal(await openAddress(URL1, { mode: 'browser', env: ORCA_ENV, platform: 'darwin', run: r.exec, canRun }), 'browser');
  assert.deepEqual(r.calls.map((c) => c.file), ['open']);
  r = recorder(() => ({ stdout: okJson }));
  assert.equal(await openAddress(URL1, { mode: 'orca', env: { PATH: '/bin' }, platform: 'darwin', run: r.exec, canRun }), 'orca');
});

test('everything failing resolves to null, never throws', async () => {
  const r = recorder(() => { throw new Error('nope'); });
  assert.equal(await openAddress(URL1, { env: ORCA_ENV, platform: 'win32', run: r.exec, canRun }), null);
  assert.equal(r.calls.at(-1).file, 'rundll32');
});

// CLI end to end with stub executables (nothing real is opened).
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const posix = process.platform !== 'win32';
const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';

function stubDir(stubs) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ari-open-')));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'log.txt');
  for (const [name, out] of Object.entries(stubs)) {
    const f = join(bin, name);
    writeFileSync(f, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${out}\n`);
    chmodSync(f, 0o755);
  }
  const root = join(dir, 'r');
  mkdirSync(root);
  return { dir, bin, log, root };
}
const waitLog = async (log, n) => {
  for (let i = 0; i < 100; i++) {
    if (existsSync(log) && readFileSync(log, 'utf8').trim().split('\n').length >= n) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
};
const env = (s, extra) => ({ PATH: `${s.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, ARI_NO_UPDATE_CHECK: '1', ...extra });

test('cli in Orca opens a tab via orca and prints the address first', { skip: !posix }, async () => {
  const s = stubDir({ orca: `echo '${okJson}'` });
  const run = launch(['--root', s.root], s.dir, env(s, { TERM_PROGRAM: 'Orca' }));
  try {
    const addr = await addressOf(run);
    const lines = await waitLog(s.log, 1);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], `orca tab create --url ${addr.href} --json`);
  } finally {
    run.child.kill('SIGKILL');
  }
});

test('cli: Orca fails -> default browser; --no-open and --open=none open nothing', { skip: !posix }, async () => {
  const s = stubDir({ orca: 'echo \'{"ok":false}\'', [opener]: 'true' });
  let run = launch(['--root', s.root], s.dir, env(s, { TERM_PROGRAM: 'Orca' }));
  try {
    const addr = await addressOf(run);
    const lines = await waitLog(s.log, 2);
    assert.equal(lines[1], `${opener} ${addr.href}`);
  } finally {
    run.child.kill('SIGKILL');
  }
  for (const flag of ['--no-open', '--open=none']) {
    const t = stubDir({ orca: `echo '${okJson}'`, [opener]: 'true' });
    run = launch(['--root', t.root, flag], t.dir, env(t, { TERM_PROGRAM: 'Orca' }));
    try {
      await addressOf(run);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(existsSync(t.log), false, flag);
    } finally {
      run.child.kill('SIGKILL');
    }
  }
});

test('cli: --open=browser skips Orca; bad --open value exits 2', { skip: !posix }, async () => {
  const s = stubDir({ orca: `echo '${okJson}'`, [opener]: 'true' });
  const run = launch(['--root', s.root, '--open=browser'], s.dir, env(s, { TERM_PROGRAM: 'Orca' }));
  try {
    const addr = await addressOf(run);
    assert.deepEqual(await waitLog(s.log, 1), [`${opener} ${addr.href}`]);
  } finally {
    run.child.kill('SIGKILL');
  }
  const bad = spawnSync(process.execPath, [cli, '--open=tab'], { encoding: 'utf8', env: env(s) });
  assert.equal(bad.status, 2);
});
