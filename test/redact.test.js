import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/http.js';
import { createApiHandler } from '../src/server/api.js';
import { createIndex } from '../src/index/index.js';
import { createRedactor, pathLikeKey } from '../src/model/redact.js';
import { cutUtf8, fileIdOf } from '../src/model/detail.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const roots = {
  claude: [{ path: join(FIX, 'claude-code/projects') }],
  codex: [{ path: join(FIX, 'codex/sessions') }],
};
const now = () => Date.parse('2026-12-01T00:00:00Z');
const A1 = '00000000-0000-4000-8000-0000000000a1';

async function boot(mode) {
  const index = createIndex({ roots, now });
  const redactor = createRedactor({ mode });
  const srv = await startServer({ webDir: FIX, handler: createApiHandler({ index, roots, redactor }) });
  const call = (path, { method = 'GET', body, origin } = {}) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${srv.port}`, cookie: `ari_${srv.port}=${srv.token}` };
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: srv.port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { srv, call };
}

// Every response the API can give for the fixture roots.
async function sweep(call) {
  const out = [];
  out.push((await call('/api/sessions')).text, (await call('/api/roots')).text);
  const sessions = (await call('/api/sessions')).json().sessions;
  for (const s of sessions) {
    const r = await call(`/api/sessions/${encodeURIComponent(s.id)}`);
    out.push(r.text);
    for (const sp of r.json().spans) {
      const d = await call(`/api/spans/${encodeURIComponent(sp.id)}/detail?session=${encodeURIComponent(s.id)}`);
      assert.equal(d.status, 200, sp.id);
      out.push(d.text);
    }
  }
  return out;
}

test('pathLikeKey and cutUtf8', () => {
  assert.ok(pathLikeKey('/synthetic/path/like/key.txt') && pathLikeKey('C:\\synthetic\\key.txt') && pathLikeKey('~/x') && pathLikeKey('a.txt'));
  assert.ok(!pathLikeKey('file_path') && !pathLikeKey('command'));
  const s = '\uAC00'.repeat(1000); // 3 bytes each
  const c = cutUtf8(s, 2048);
  assert.equal(Buffer.byteLength(c.text), 2046);
  assert.ok(c.truncated && !c.text.includes('\uFFFD'));
  assert.deepEqual(cutUtf8('abc', 2048), { text: 'abc', truncated: false });
});

test('fileIdOf unifies the string fileId with the integer the store wants', () => {
  assert.equal(fileIdOf({ ref: { fileId: '14' } }), 14);
  assert.equal(fileIdOf({ ref: { fileId: 3 } }), 3);
  assert.equal(fileIdOf({ ref: { fileId: '../x' } }), null);
  assert.equal(fileIdOf({}), null);
});

test('off: details carry input, output, file name and line', async () => {
  const { srv, call } = await boot('off');
  try {
    const sess = (await call(`/api/sessions/${A1}`)).json();
    const bash = sess.spans.find((s) => s.id === 'tool:toolu_synth_bash1');
    const d = (await call(`/api/spans/${encodeURIComponent(bash.id)}/detail`)).json();
    assert.equal(d.kind, 'tool');
    assert.match(d.input.text, /SECRET-MARKER-CMD/);
    assert.ok(d.input.keys.includes('command'));
    assert.equal(d.output.length > 0, true);
    assert.equal(d.source.file, `${A1}.jsonl`);
    assert.equal(d.source.line, bash.ref.line);
    assert.ok(Buffer.byteLength(d.input.text) <= 2048);
    assert.equal((await call('/api/spans/nope/detail')).status, 404);
    assert.equal((await call('/api/spans/x%2Fy/detail')).status, 404);
    const cx = (await call('/api/sessions/cx:00000000-0000-4000-8000-000000000003')).json();
    const sh = cx.spans.find((s) => s.name === 'shell');
    const cd = (await call(`/api/spans/${encodeURIComponent(sh.id)}/detail`)).json();
    assert.match(cd.output.text, /SECRET-MARKER-CX-8/);
  } finally { await srv.close(); }
});

test('off: markers are present (control for the sweeps)', async () => {
  const { srv, call } = await boot('off');
  try { assert.ok((await sweep(call)).some((t) => t.includes('SECRET-MARKER'))); } finally { await srv.close(); }
});

for (const mode of ['basic', 'strict']) {
  test(`${mode}: no SECRET-MARKER in any list, session, roots or detail response`, async () => {
    const { srv, call } = await boot(mode);
    try {
      for (const t of await sweep(call)) assert.ok(!t.includes('SECRET-MARKER'), t.slice(0, 200));
    } finally { await srv.close(); }
  });
}

test('basic: previews are hidden with a length, tool input keeps key names, path-like keys hidden', async () => {
  const { srv, call } = await boot('basic');
  try {
    await call(`/api/sessions/${A1}`); // serving a session teaches the server who owns its spans
    const d = (await call('/api/spans/tool%3Atoolu_synth_bash1/detail', {})).json();
    assert.equal(d.input.hidden, true);
    assert.ok(d.input.length > 0 && !('text' in d.input));
    assert.deepEqual(d.input.keys, ['command', '(hidden)', '(hidden)']);
    assert.equal(d.output.hidden, true);
    const s = (await call(`/api/sessions/${A1}`)).json();
    assert.ok(s.spans.every((x) => !('task' in x) && !('command' in x)));
    assert.equal(s.summary.project, 'demo-app'); // basic keeps titles and projects
  } finally { await srv.close(); }
});

test('strict: title, project, branch, cwd and folder paths are gone', async () => {
  const { srv, call } = await boot('strict');
  try {
    const all = (await sweep(call)).join('\n');
    for (const needle of ['Synthetic demo session', 'demo-app', 'synthetic-project', '/synthetic/demo-app', '/work/synthetic-project', 'synthetic-branch', FIX]) {
      assert.ok(!all.includes(needle), needle);
    }
    const r = (await call('/api/roots')).json();
    assert.ok(r.roots.length === 2 && r.roots.every((x) => !('path' in x) && x.source));
  } finally { await srv.close(); }
});

test('preview is cut at 2 KB on a character boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ari-detail-'));
  try {
    const proj = join(dir, 'projects', '-t');
    mkdirSync(proj, { recursive: true });
    const sid = '00000000-0000-4000-8000-0000000000b1';
    const line = (o) => JSON.stringify({ sessionId: sid, cwd: '/t', timestamp: '2026-01-01T00:00:00.000Z', ...o });
    const big = '\uAC00'.repeat(2000);
    writeFileSync(join(proj, `${sid}.jsonl`), [
      line({ type: 'user', message: { role: 'user', content: 'hi' } }),
      line({ type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'm1', role: 'assistant', model: 'm', content: [{ type: 'text', text: big }], usage: { input_tokens: 1, output_tokens: 1 } } }),
    ].join('\n') + '\n');
    const r2 = { claude: [{ path: join(dir, 'projects') }] };
    const index = createIndex({ roots: r2, now });
    const srv = await startServer({ webDir: FIX, handler: createApiHandler({ index, roots: r2 }) });
    const call = (path) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}`, cookie: `ari_${srv.port}=${srv.token}` } }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve(JSON.parse(t)));
    }));
    try {
      const s = await call(`/api/sessions/${sid}`);
      const llm = s.spans.find((x) => x.kind === 'llm');
      const d = await call(`/api/spans/${encodeURIComponent(llm.id)}/detail`);
      assert.equal(d.output.truncated, true);
      assert.equal(d.output.length, 2000);
      assert.equal(Buffer.byteLength(d.output.text), 2046);
    } finally { await srv.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
