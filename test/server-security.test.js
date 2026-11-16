import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/http.js';

let webDir;
let s1;
let s2;

// Raw request so we can control Host/Origin/Cookie and the path verbatim.
function req(srv, path, { host, headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port: srv.port, path, method, headers: { host: host ?? `127.0.0.1:${srv.port}`, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    r.on('error', reject);
    r.end();
  });
}

const cookieOf = (srv) => `ari_${srv.port}=${srv.token}`;

before(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'ari-web-'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(webDir, 'app.css'), 'body{}');
  writeFileSync(join(tmpdir(), 'ari-secret.txt'), 'secret');
  s1 = await startServer({ webDir });
  s2 = await startServer({ webDir });
});

after(async () => {
  await s1.close();
  await s2.close();
  rmSync(webDir, { recursive: true, force: true });
  rmSync(join(tmpdir(), 'ari-secret.txt'), { force: true });
});

test('binds to 127.0.0.1 on an ephemeral port', () => {
  const a = s1.server.address();
  assert.equal(a.address, '127.0.0.1');
  assert.ok(a.port > 0);
  assert.equal(s1.port, a.port);
  assert.notEqual(s1.port, s2.port);
  assert.notEqual(s1.token, s2.token);
  assert.match(s1.token, /^[A-Za-z0-9_-]{32,}$/);
});

test('rejects a foreign Host header', async () => {
  const r = await req(s1, `/?t=${s1.token}`, { host: `evil.test:${s1.port}` });
  assert.equal(r.status, 403);
  const r2 = await req(s1, '/', { host: '127.0.0.1:1', headers: { cookie: cookieOf(s1) } });
  assert.equal(r2.status, 403);
});

test('accepts localhost:<port> as Host', async () => {
  const r = await req(s1, '/', { host: `localhost:${s1.port}`, headers: { cookie: cookieOf(s1) } });
  assert.equal(r.status, 200);
});

test('rejects a cross-origin Origin, accepts the same origin', async () => {
  const bad = await req(s1, '/', { headers: { cookie: cookieOf(s1), origin: 'http://evil.test' } });
  assert.equal(bad.status, 403);
  const nul = await req(s1, '/', { headers: { cookie: cookieOf(s1), origin: 'null' } });
  assert.equal(nul.status, 403);
  const ok = await req(s1, '/', { headers: { cookie: cookieOf(s1), origin: `http://127.0.0.1:${s1.port}` } });
  assert.equal(ok.status, 200);
});

test('no cookie is 401, wrong cookie is 401', async () => {
  assert.equal((await req(s1, '/')).status, 401);
  assert.equal((await req(s1, '/', { headers: { cookie: `ari_${s1.port}=nope` } })).status, 401);
  // a cookie left by another run (other port, other token) must not work
  assert.equal((await req(s1, '/', { headers: { cookie: cookieOf(s2) } })).status, 401);
  assert.equal((await req(s1, '/', { headers: { cookie: `ari_${s2.port}=${s2.token}` } })).status, 401);
});

test('wrong ?t= is 401 and sets no cookie', async () => {
  const r = await req(s1, '/?t=wrong');
  assert.equal(r.status, 401);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('?t= sets the cookie and redirects, and works more than once', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await req(s1, `/?t=${s1.token}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
    const c = r.headers['set-cookie'][0];
    assert.ok(c.startsWith(`ari_${s1.port}=${s1.token}`));
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.match(c, /Path=\//);
  }
});

test('?t= redirect keeps other query params', async () => {
  const r = await req(s1, `/app.css?x=1&t=${s1.token}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/app.css?x=1');
});

test('two servers do not overwrite each other cookies', async () => {
  const a = (await req(s1, `/?t=${s1.token}`)).headers['set-cookie'][0].split('=')[0];
  const b = (await req(s2, `/?t=${s2.token}`)).headers['set-cookie'][0].split('=')[0];
  assert.notEqual(a, b);
  const both = `${cookieOf(s1)}; ${cookieOf(s2)}`;
  assert.equal((await req(s1, '/', { headers: { cookie: both } })).status, 200);
  assert.equal((await req(s2, '/', { headers: { cookie: both } })).status, 200);
});

test('serves fixed static files with correct types', async () => {
  const h = { cookie: cookieOf(s1) };
  const idx = await req(s1, '/', { headers: h });
  assert.equal(idx.status, 200);
  assert.match(idx.headers['content-type'], /text\/html/);
  const css = await req(s1, '/app.css', { headers: h });
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
});

test('path traversal and unlisted files are 404', async () => {
  const h = { cookie: cookieOf(s1) };
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/..%2fpackage.json', '/app.css/../../x', '/ari-secret.txt', '//etc/passwd', '/index.html%00', '/web/index.html']) {
    const r = await req(s1, p, { headers: h });
    assert.equal(r.status, 404, p);
  }
});

test('non GET/HEAD methods are 405', async () => {
  const r = await req(s1, '/', { method: 'POST', headers: { cookie: cookieOf(s1) } });
  assert.equal(r.status, 405);
});

test('favicon.ico gets no data and needs no cookie', async () => {
  const r = await req(s1, '/favicon.ico');
  assert.equal(r.status, 204);
});

test('security headers on every response', async () => {
  const cases = [
    req(s1, '/', { headers: { cookie: cookieOf(s1) } }),
    req(s1, '/'),
    req(s1, `/?t=${s1.token}`),
    req(s1, '/nope', { headers: { cookie: cookieOf(s1) } }),
    req(s1, '/', { host: 'evil.test' }),
    req(s1, '/', { method: 'POST', headers: { cookie: cookieOf(s1) } }),
    req(s1, '/favicon.ico'),
  ];
  for (const r of await Promise.all(cases)) {
    assert.equal(r.headers['content-security-policy'], "default-src 'self'; img-src 'self' data:; connect-src 'self'");
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
  }
});

test('OPTIONS preflight gets no CORS grant', async () => {
  const r = await req(s1, '/', { method: 'OPTIONS', headers: { origin: 'http://evil.test', 'access-control-request-method': 'GET' } });
  assert.ok([403, 405].includes(r.status));
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('authenticated non-static requests reach the handler', async () => {
  const s = await startServer({
    webDir,
    handler: (rq, res) => {
      if (rq.url === '/api/ping') {
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
        return true;
      }
      return false;
    },
  });
  try {
    assert.equal((await req(s, '/api/ping')).status, 401);
    const r = await req(s, '/api/ping', { headers: { cookie: cookieOf(s) } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  } finally {
    await s.close();
  }
});

test('an explicit --port is honoured and the host cannot be changed', async () => {
  const probe = await startServer({ webDir });
  const port = probe.port;
  await probe.close();
  const s = await startServer({ webDir, port, host: '0.0.0.0' });
  try {
    assert.equal(s.port, port);
    assert.equal(s.server.address().address, '127.0.0.1');
  } finally {
    await s.close();
  }
});

test('url helper contains the token and 127.0.0.1', () => {
  assert.equal(s1.url, `http://127.0.0.1:${s1.port}/?t=${s1.token}`);
});

test('web app manifest and icons are served without the cookie; nothing else is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ari-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"x"}');
  writeFileSync(join(dir, 'icon-192.png'), 'png');
  const srv = await startServer({ webDir: dir });
  try {
    const m = await req(srv, '/manifest.webmanifest');
    assert.equal(m.status, 200);
    assert.equal(m.headers['content-type'], 'application/manifest+json');
    assert.equal((await req(srv, '/icon-192.png')).headers['content-type'], 'image/png');
    assert.equal((await req(srv, '/')).status, 401);
    assert.equal((await req(srv, '/index.html')).status, 401);
    assert.equal((await req(srv, '/api/sessions')).status, 401);
    assert.equal((await req(srv, '/manifest.webmanifest', { host: 'evil.test' })).status, 403); // Host check still first
  } finally {
    await srv.close();
  }
});
