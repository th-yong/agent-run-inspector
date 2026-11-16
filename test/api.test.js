import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/http.js';
import { briefAgents, createApiHandler } from '../src/server/api.js';
import { createIndex } from '../src/index/index.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const roots = {
  claude: [{ path: join(FIX, 'claude-code/projects'), origin: 'flag' }],
  codex: [{ path: join(FIX, 'codex/sessions'), origin: 'default' }],
};
const A1 = '00000000-0000-4000-8000-0000000000a1';
const CX3 = 'cx:00000000-0000-4000-8000-000000000003';
let srv;
const meta = { version: '9.8.7', latest: null }; // the CLI fills latest after its npm check

before(async () => {
  const index = createIndex({ roots, now: () => Date.parse('2026-12-01T00:00:00Z') });
  srv = await startServer({ webDir: FIX, handler: createApiHandler({ index, roots, meta }) });
});
after(() => srv.close());

function get(path, { cookie = true, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${srv.port}` };
    if (cookie) headers.cookie = `ari_${srv.port}=${srv.token}`;
    const r = http.request({ host: '127.0.0.1', port: srv.port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('every API route needs the cookie', async () => {
  for (const p of ['/api/sessions', `/api/sessions/${A1}`, '/api/roots', '/api/meta', '/api/live']) assert.equal((await get(p, { cookie: false })).status, 401);
});

test('GET /api/sessions lists both tools', async () => {
  const r = await get('/api/sessions');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/json/);
  const ids = JSON.parse(r.body).sessions.map((s) => s.id);
  assert.ok(ids.includes(A1) && ids.includes(CX3));
});

test('GET /api/sessions/:id returns spans, with encoded ids for Codex', async () => {
  for (const id of [A1, CX3]) {
    const r = await get(`/api/sessions/${encodeURIComponent(id)}`);
    assert.equal(r.status, 200, id);
    const b = JSON.parse(r.body);
    assert.equal(b.summary.id, id);
    assert.ok(b.spans.length > 0);
    assert.ok(b.spans.every((s) => typeof s.ref.fileId === 'string' && s.ref.line >= 0));
    assert.ok('totals' in b && Array.isArray(b.markers) && Array.isArray(b.turns));
  }
});

test('unknown session, paths and odd ids are 404/400, not file reads', async () => {
  assert.equal((await get('/api/sessions/nope')).status, 404);
  assert.equal((await get('/api/sessions/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await get('/api/sessions/a/b')).status, 404);
  assert.equal((await get('/api/sessions/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/sessions/' + encodeURIComponent(join(FIX, 'claude-code/projects')))).status, 404);
});

test('non-GET on the API is 405', async () => {
  assert.equal((await get('/api/sessions', { method: 'POST' })).status, 405);
});

test('GET /api/roots lists the folders searched', async () => {
  const b = JSON.parse((await get('/api/roots')).body);
  assert.deepEqual(b.roots.map((r) => [r.source, r.origin]), [['claude-code', 'flag'], ['codex', 'default']]);
});

test('no response contains a record-file path', async () => {
  const sessions = JSON.parse((await get('/api/sessions')).body).sessions;
  const bodies = [(await get('/api/sessions')).body];
  for (const s of sessions) bodies.push((await get(`/api/sessions/${encodeURIComponent(s.id)}`)).body);
  for (const body of bodies) {
    assert.ok(!body.includes(FIX), 'fixture dir leaked');
    assert.ok(!/\.jsonl\b/.test(body), '.jsonl name leaked');
  }
});

test('session detail carries totals that match the summary', async () => {
  const body = JSON.parse((await get(`/api/sessions/${A1}`)).body);
  assert.equal(body.totals.total.usd, 1.25); // cost-state in the fixture
  assert.equal(body.totals.total.basis, 'reported');
  assert.equal(body.summary.totals.usd, 1.25);
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) assert.equal(body.totals.total[k], body.summary.totals[k]);
  assert.equal(body.totals.total.errors, body.summary.errorCount);
  assert.equal(body.totals.total.modelCalls + body.totals.total.toolCalls, body.summary.callCount);
  assert.equal(body.totals.total.agents, body.summary.agentCount);
});

test('/api/meta: version, and the newer version once the update check found one', async () => {
  assert.deepEqual(JSON.parse((await get('/api/meta')).body), { version: '9.8.7', latest: null });
  meta.latest = '9.9.0';
  assert.deepEqual(JSON.parse((await get('/api/meta')).body), { version: '9.8.7', latest: '9.9.0' });
});

test('GET /api/live lists only running sessions', async () => {
  const r = await get('/api/live');
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(r.body).sessions.every((s) => s.status === 'running' && Array.isArray(s.agents)));
});

test('briefAgents: tool count and the tool running now, per agent, orchestrator first', () => {
  const spans = [
    { kind: 'agent', id: 'w', name: 'tests', depth: 1, start: 5, status: 'running' },
    { kind: 'agent', id: 'm', name: 'main', depth: 0, start: 1, status: 'running', task: 'secret' },
    { kind: 'tool', id: 't1', parentId: 'w', name: 'Read', start: 6, status: 'ok' },
    { kind: 'tool', id: 't2', parentId: 'w', name: 'Bash', start: 7, status: 'running', command: 'npm test' },
    { kind: 'llm', id: 'l1', parentId: 'm', start: 2, status: 'ok' },
  ];
  const [m, w] = briefAgents(spans);
  assert.equal(m.name, 'main');
  assert.deepEqual([m.calls, m.now], [0, null]);
  assert.deepEqual([w.calls, w.now], [2, 'Bash']);
  assert.ok(!JSON.stringify([m, w]).includes('secret') && !JSON.stringify([m, w]).includes('npm test'));
});

function put(path, body, { origin = true } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${srv.port}`, cookie: `ari_${srv.port}=${srv.token}`, 'content-type': 'application/json' };
    if (origin) headers.origin = `http://127.0.0.1:${srv.port}`;
    const r = http.request({ host: '127.0.0.1', port: srv.port, path, method: 'PUT', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
}

test('PUT /api/groups saves groups; GET reads them back; bad documents and missing Origin are refused', async () => {
  assert.deepEqual(JSON.parse((await get('/api/groups')).body), { groups: [] });
  const doc = { groups: [{ id: 'shop', name: ' Shop API ', sessions: [A1, A1] }] };
  assert.equal((await put('/api/groups', doc, { origin: false })).status, 403);
  assert.equal((await put('/api/groups', { groups: [{ id: 'Bad Id', name: 'x', sessions: [] }] })).status, 400);
  const r = await put('/api/groups', doc);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse((await get('/api/groups')).body), { groups: [{ id: 'shop', name: 'Shop API', sessions: [A1] }] });
  assert.equal((await get('/api/groups', { cookie: false })).status, 401);
});
