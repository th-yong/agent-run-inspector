import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_NAME, fetchSessions, installPlugin, pluginScript, renderMenu, renderProblem, uninstallPlugin } from '../src/menubar.js';

const NOW = 1_800_000_000_000;
const o = { base: 'http://127.0.0.1:7317/', now: NOW, node: '/opt/n', cli: '/a b/cli.js' };
const ses = (id, status, extra = {}) => ({ id, status, project: 'app', start: NOW - 3_600_000, end: null, lastWrite: NOW - 60_000, totals: { usd: null }, ...extra });

test('menu: running count in the bar, running then recent (newest first), links without a token', () => {
  const menu = renderMenu([
    ses('r1', 'running', { title: 'fix | the bug' }),
    ses('old', 'ok', { end: NOW - 3 * 86_400_000 }),
    ses('new', 'error', { end: NOW - 5 * 60_000, totals: { usd: 1.5 } }),
  ], o).split('\n');
  assert.equal(menu[0], '1 | sfimage=point.3.connected.trianglepath.dotted');
  const r = menu.find((l) => l.includes('?s=r1'));
  assert.match(r, /^fix {3}the bug · app {2}1h 00m \| href="http:\/\/127\.0\.0\.1:7317\/\?s=r1"/); // "|" in a title cannot split the line
  const iNew = menu.findIndex((l) => l.includes('?s=new'));
  const iOld = menu.findIndex((l) => l.includes('?s=old'));
  assert.ok(iNew > 0 && iNew < iOld);
  assert.match(menu[iNew], /5m ago · \$1\.50 .*exclamationmark/);
  assert.match(menu[iOld], /3d ago/);
  assert.ok(menu.some((l) => l.startsWith('Sign in again | bash="/opt/n" param1="/a b/cli.js" param2=open')));
  assert.ok(!menu.join('\n').includes('?t='));
});

test('menu: nothing running shows only the icon', () => {
  const menu = renderMenu([ses('a', 'ok')], o);
  assert.ok(menu.startsWith(' | sfimage='));
  assert.ok(menu.includes('Nothing running'));
  assert.ok(renderProblem('down | now').includes('\ndown   now | size=12\n'));
});

test('fetchSessions sends the service cookie', async () => {
  let seen;
  const fake = async (url, init) => { seen = { url, cookie: init.headers.cookie }; return { ok: true, json: async () => ({ sessions: [1] }) }; };
  assert.deepEqual(await fetchSessions({ port: 7317, token: 'tok' }, fake), [1]);
  assert.deepEqual(seen, { url: 'http://127.0.0.1:7317/api/sessions', cookie: 'ari_7317=tok' });
  await assert.rejects(fetchSessions({ port: 1, token: 't' }, async () => ({ ok: false, status: 401 })), /401/);
});

test('plugin script: executable, quoted paths, no token; uninstall removes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ari-bar-'));
  const file = installPlugin(dir, { node: '/opt/n', cli: '/a b/cli.js' });
  assert.equal(file, join(dir, PLUGIN_NAME));
  assert.equal(statSync(file).mode & 0o111, 0o111);
  assert.equal(readFileSync(file, 'utf8'), pluginScript({ node: '/opt/n', cli: '/a b/cli.js' }));
  assert.match(readFileSync(file, 'utf8'), /exec "\/opt\/n" "\/a b\/cli\.js" menubar\n$/);
  uninstallPlugin(dir);
  assert.ok(!existsSync(file));
});
