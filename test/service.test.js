import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/http.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  APP_ID, LABEL, appDir, buildApp, buildPlist, installService, uninstallService, loadService, plistFile, serviceFile,
} from '../src/service.js';

const tmpEnv = () => ({ HOME: mkdtempSync(join(tmpdir(), 'ari-svc-')) });
const recorder = () => {
  const calls = [];
  return { calls, run: async (file, args) => { calls.push([file, ...args].join(' ')); } };
};
const opts = (env, run) => ({ env, port: 7317, node: '/usr/local/bin/node', cli: '/usr/local/lib/node_modules/agent-run-inspector/bin/cli.js', platform: 'darwin', uid: 501, run });

test('install writes a 0600 token file and a plist without the token, then (re)starts the agent', async () => {
  const env = { ...tmpEnv(), CODEX_HOME: '/x/a&b' };
  const r = recorder();
  const s = await installService(opts(env, r.run));
  assert.equal(statSync(serviceFile(env)).mode & 0o777, 0o600);
  assert.deepEqual(loadService(env), s);
  const plist = readFileSync(plistFile(env), 'utf8');
  assert.ok(!plist.includes(s.token));
  assert.ok(plist.includes('<string>--service</string>'));
  assert.ok(plist.includes('<key>CODEX_HOME</key><string>/x/a&amp;b</string>'));
  assert.ok(plist.includes('<key>Crashed</key><true/>')); // no restart loop on a taken port (exit 2)
  assert.deepEqual(r.calls, [`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${plistFile(env)}`]);

  const again = await installService({ ...opts(env, r.run), port: 7400 });
  assert.equal(again.token, s.token); // installed apps stay signed in
  assert.equal(again.port, 7400);

  assert.equal(await uninstallService({ env, platform: 'darwin', uid: 501, run: r.run }), true);
  assert.ok(!existsSync(plistFile(env)) && !existsSync(serviceFile(env)));
  assert.equal(await uninstallService({ env, platform: 'darwin', uid: 501, run: r.run }), false);
});

test('install refuses other platforms and the npx cache', async () => {
  const env = tmpEnv();
  await assert.rejects(installService({ ...opts(env, recorder().run), platform: 'linux' }), /only macOS/);
  await assert.rejects(installService({ ...opts(env, recorder().run), cli: '/Users/u/.npm/_npx/abc/node_modules/agent-run-inspector/bin/cli.js' }), /npm i -g/);
  assert.equal(loadService(env), null);
});

test('buildPlist leaves out environment variables that are not set', () => {
  assert.ok(!buildPlist({ node: 'n', cli: 'c', env: { HOME: '/h' } }).includes('EnvironmentVariables'));
});

test('a service token gives a lasting cookie; a normal start keeps a session cookie', async () => {
  const get = (srv) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: `/?t=${srv.token}` }, (res) => { res.resume(); resolve(res.headers['set-cookie'][0]); }).on('error', reject);
  });
  const svc = await startServer({ token: 'fixed-token', cookieMaxAge: 1000 });
  const plain = await startServer();
  try {
    assert.equal(svc.token, 'fixed-token');
    assert.match(await get(svc), /^ari_\d+=fixed-token; HttpOnly; SameSite=Strict; Path=\/; Max-Age=1000$/);
    assert.ok(!(await get(plain)).includes('Max-Age'));
  } finally {
    await svc.close();
    await plain.close();
  }
});

test('install retries bootstrap while the old instance is still going away', async () => {
  const env = tmpEnv();
  let fails = 2;
  const calls = [];
  const run = async (file, args) => {
    calls.push(args[0]);
    if (args[0] === 'bootstrap' && fails-- > 0) throw Object.assign(new Error('x'), { stderr: 'Bootstrap failed: 5: Input/output error' });
  };
  await installService({ ...opts(env, run), wait: async () => {} });
  assert.deepEqual(calls, ['bootout', 'bootstrap', 'bootstrap', 'bootstrap']);
  const never = async (file, args) => { if (args[0] === 'bootstrap') throw new Error('down'); };
  await assert.rejects(installService({ ...opts(env, never), wait: async () => {} }), /down/);
});

test('buildApp: osacompile, the service-file key, bundle id, icon and an ad-hoc signature; uninstall removes it', async () => {
  const env = tmpEnv();
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'osacompile') { // stand-in for the applet osacompile writes
      const out = args[args.indexOf('-o') + 1];
      mkdirSync(join(out, 'Contents', 'Resources'), { recursive: true });
      writeFileSync(join(out, 'Contents', 'Info.plist'), '<plist/>');
    }
  };
  const app = await buildApp({ env, run });
  assert.equal(app, appDir(env));
  const plist = join(app, 'Contents', 'Info.plist');
  assert.deepEqual(calls.map((c) => c[0]), ['osacompile', 'plutil', 'plutil', 'codesign']);
  assert.ok(calls[0].includes('-s') && calls[0].at(-1).endsWith('src/macos/app.js'));
  assert.deepEqual(calls[1], ['plutil', '-replace', 'ARIServiceFile', '-string', serviceFile(env), plist]);
  assert.deepEqual(calls[2], ['plutil', '-replace', 'CFBundleIdentifier', '-string', APP_ID, plist]);
  assert.ok(readFileSync(join(app, 'Contents', 'Resources', 'applet.icns')).subarray(0, 4).equals(Buffer.from('icns')));
  assert.deepEqual(calls[3], ['codesign', '--force', '--sign', '-', app]);
  assert.equal(await uninstallService({ env, platform: 'darwin', uid: 501, run: async () => {} }), true);
  assert.ok(!existsSync(app));
});
