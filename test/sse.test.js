// SSE stream tests. Waits are event/poll based (no fixed sleeps) so they hold up under load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/http.js';
import { createApiHandler } from '../src/server/api.js';
import { createIndex } from '../src/index/index.js';
import { createWatcher } from '../src/live/watch.js';
import { createRedactor } from '../src/model/redact.js';

const SID = '00000000-0000-4000-8000-0000000000b1';
const MARK = 'SECRET-MARKER-SSE';
const T0 = Date.now();
const iso = (n) => new Date(T0 + n * 1000).toISOString();
const base = { isSidechain: false, sessionId: SID, cwd: '/synthetic/sse-app', gitBranch: 'main', version: '0.0.0-synthetic' };
const line = (o) => JSON.stringify({ ...base, ...o }) + '\n';
const userLine = () => line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: iso(0), message: { role: 'user', content: `${MARK} prompt` } });
const toolLine = (n) => line({
  type: 'assistant', uuid: `a${n}`, parentUuid: 'u1', timestamp: iso(n),
  message: {
    id: `msg_sse_${n}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
    content: [{ type: 'tool_use', id: `toolu_sse_${n}`, name: 'Bash', input: { command: `echo ${MARK}-${n}` } }],
    stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 },
  },
});

function until(cond, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = cond(); } catch { /* keep waiting */ }
      if (ok) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout')); }
    }, 10);
  });
}

async function setup({ redact = 'off', pingMs, watch = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ari-sse-')));
  const proj = join(root, '-synthetic-sse-app');
  mkdirSync(proj);
  const main = join(proj, `${SID}.jsonl`);
  writeFileSync(main, userLine() + toolLine(1));
  const roots = { claude: [{ path: root }], codex: [] };
  const index = createIndex({ roots });
  const redactor = createRedactor({ mode: redact });
  const handler = createApiHandler({ index, roots, redactor, live: undefined, ...(pingMs ? { pingMs } : {}) });
  const srv = await startServer({ webDir: root, handler });
  const w = createWatcher({ roots: [root], store: index.store, usePolling: true, pollMs: 20, debounceMs: 10, onBatch: handler.live.onBatch });
  if (watch) w.start();
  const clients = [];
  const api = {
    root, proj, main, index, srv, handler, w,
    append: (text, file = main) => appendFileSync(file, text),
    stream(path, lastId) {
      const c = { text: '', closed: false };
      c.events = () => c.text.split('\n\n').filter((b) => b.includes('data: ')).map((b) => {
        const id = /^id: (\d+)$/m.exec(b)?.[1];
        return { id: id === undefined ? null : Number(id), data: JSON.parse(/^data: (.*)$/m.exec(b)[1]) };
      });
      c.ready = new Promise((resolve, reject) => {
        const headers = { host: `127.0.0.1:${srv.port}`, cookie: `ari_${srv.port}=${srv.token}` };
        if (lastId !== undefined) headers['last-event-id'] = String(lastId);
        const r = http.request({ host: '127.0.0.1', port: srv.port, path, headers }, (res) => {
          c.res = res;
          c.status = res.statusCode;
          res.setEncoding('utf8');
          res.on('data', (d) => { c.text += d; });
          res.on('close', () => { c.closed = true; });
          resolve(c);
        });
        r.on('error', reject);
        r.end();
        c.req = r;
      });
      clients.push(c);
      return c;
    },
    async getJson(path) {
      return new Promise((resolve, reject) => {
        const headers = { host: `127.0.0.1:${srv.port}`, cookie: `ari_${srv.port}=${srv.token}` };
        http.get({ host: '127.0.0.1', port: srv.port, path, headers }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve(JSON.parse(b)));
        }).on('error', reject);
      });
    },
    async stop() {
      w.stop();
      for (const c of clients) c.req.destroy();
      handler.live.close();
      await srv.close();
    },
  };
  return api;
}

const spanEvents = (c) => c.events().filter((e) => e.data.type === 'span');

test('appended lines produce span and totals events with increasing ids', async () => {
  const t = await setup();
  try {
    const before = await t.getJson(`/api/sessions/${SID}`);
    assert.equal(before.spans.filter((s) => s.kind === 'tool').length, 1);
    const c = await t.stream(`/api/sessions/${SID}/stream`).ready;
    assert.equal(c.status, 200);
    assert.match(c.res.headers['content-type'], /text\/event-stream/);
    t.append(toolLine(2));
    await until(() => c.events().some((e) => e.data.type === 'totals'));
    const ev = c.events();
    const tools = spanEvents(c).filter((e) => e.data.span.kind === 'tool');
    assert.equal(tools.length, 1, 'only the new tool call changed');
    assert.equal(tools[0].data.span.id !== before.spans.find((s) => s.kind === 'tool').id, true);
    const ids = ev.map((e) => e.id);
    assert.ok(ids.every((n, i) => i === 0 || n > ids[i - 1]), 'ids strictly increase');
    assert.equal(tools[0].data.span.seq, tools[0].id, 'span.seq is the event id');
    assert.ok(tools[0].id > before.seq);
    const totals = ev.find((e) => e.data.type === 'totals').data.totals;
    assert.equal(totals.total.toolCalls, 2);
    assert.equal(totals.total.modelCalls, 2);
    // A fresh full load agrees with what the stream said.
    const after = await t.getJson(`/api/sessions/${SID}`);
    assert.equal(after.totals.total.toolCalls, 2);
    assert.equal(after.spans.find((s) => s.id === tools[0].data.span.id).seq, tools[0].id);
  } finally { await t.stop(); }
});

test('Last-Event-ID resumes without repeats; old or foreign ids get resync', async () => {
  const t = await setup();
  try {
    const first = await t.stream(`/api/sessions/${SID}/stream`).ready;
    t.append(toolLine(2));
    await until(() => spanEvents(first).length > 0 && first.events().some((e) => e.data.type === 'totals'));
    const lastId = first.events().at(-1).id;
    first.req.destroy();
    await until(() => t.handler.live.clientCount() === 0);
    t.append(toolLine(3));
    await until(() => t.srv && t.handler.live.currentSeq() > lastId);
    const second = await t.stream(`/api/sessions/${SID}/stream`, lastId).ready;
    await until(() => second.events().some((e) => e.data.type === 'totals'));
    const got = second.events();
    assert.ok(got.every((e) => e.id > lastId), 'nothing at or before the last id is repeated');
    assert.ok(got.every((e) => e.data.type !== 'resync'));
    assert.equal(spanEvents(second).filter((e) => e.data.span.kind === 'tool').length, 1);

    const tooOld = await t.stream(`/api/sessions/${SID}/stream`, 1).ready;
    await until(() => tooOld.events().length > 0);
    assert.deepEqual(tooOld.events()[0], { id: null, data: { type: 'resync' } });
    const future = await t.stream(`/api/sessions/${SID}/stream`, 'abc').ready;
    await until(() => future.events().length > 0);
    assert.equal(future.events()[0].data.type, 'resync');
  } finally { await t.stop(); }
});

test('a new sub-agent file shows up in the parent session stream', async () => {
  const t = await setup();
  try {
    const c = await t.stream(`/api/sessions/${SID}/stream`).ready;
    const sub = join(t.proj, SID, 'subagents');
    mkdirSync(sub, { recursive: true });
    const sline = (o) => JSON.stringify({ ...base, isSidechain: true, agentId: 'asynthsse00000001', ...o }) + '\n';
    writeFileSync(join(sub, 'agent-asynthsse00000001.meta.json'), JSON.stringify({ agentType: 'worker', name: 'helper', description: `${MARK} task`, spawnDepth: 1, toolUseId: 'toolu_sse_1' }));
    writeFileSync(join(sub, 'agent-asynthsse00000001.jsonl'), sline({ type: 'user', uuid: 's1', parentUuid: null, timestamp: iso(5), message: { role: 'user', content: 'go' } }));
    await until(() => spanEvents(c).some((e) => e.data.span.kind === 'agent' && e.data.span.depth === 1));
    // Lines added to an already-known child keep arriving.
    t.append(sline({ type: 'assistant', uuid: 's2', parentUuid: 's1', timestamp: iso(6), message: { id: 'msg_sse_sub', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } }), join(sub, 'agent-asynthsse00000001.jsonl'));
    await until(() => spanEvents(c).some((e) => e.data.span.kind === 'llm' && e.data.span.depth === undefined && e.data.span.id.includes('msg_sse_sub')) || c.events().filter((e) => e.data.type === 'totals').length >= 2);
  } finally { await t.stop(); }
});

test('redaction applies to stream payloads: nothing hidden ever leaves, mode changes take effect', async () => {
  for (const mode of ['basic', 'strict']) {
    const t = await setup({ redact: mode });
    try {
      const list = await t.stream('/api/sessions/stream').ready;
      const c = await t.stream(`/api/sessions/${SID}/stream`).ready;
      t.append(toolLine(2) + line({ type: 'ai-title', aiTitle: 'TITLE-SSE' }));
      await until(() => spanEvents(c).length > 0 && list.events().length > 0);
      await until(() => c.events().some((e) => e.data.type === 'totals'));
      for (const e of spanEvents(c)) assert.equal(e.data.span.command, undefined);
      assert.ok(!c.text.includes(MARK), `${mode}: session stream has no marker: ${c.text.split(MARK)[0].slice(-200)}`);
      assert.ok(!list.text.includes(MARK), `${mode}: list stream has no marker`);
      if (mode === 'strict') assert.ok(!c.text.includes('TITLE-SSE') && !list.text.includes('TITLE-SSE'), 'strict: no title');
      const s = list.events().find((e) => e.data.type === 'session').data.summary;
      if (mode === 'strict') {
        assert.equal(s.title, undefined);
        assert.equal(s.project, '(hidden)');
      }
    } finally { await t.stop(); }
  }
});

test('with redaction off the raw command is sent (so the test above can fail)', async () => {
  const t = await setup();
  try {
    const c = await t.stream(`/api/sessions/${SID}/stream`).ready;
    t.append(toolLine(2));
    await until(() => spanEvents(c).some((e) => e.data.span.command?.includes(MARK)));
  } finally { await t.stop(); }
});

test('list stream announces changed sessions', async () => {
  const t = await setup();
  try {
    const c = await t.stream('/api/sessions/stream').ready;
    t.append(toolLine(2));
    await until(() => c.events().some((e) => e.data.type === 'session' && e.data.summary.id === SID));
  } finally { await t.stop(); }
});

test('list stream: a session that leaves the list (folded under its lead) makes clients reload', async () => {
  const t = await setup({ watch: false });
  try {
    const c = await t.stream('/api/sessions/stream').ready;
    t.handler.live.onBatch(); // the first diff only records what is there
    const other = join(t.proj, '00000000-0000-4000-8000-0000000000c2.jsonl');
    writeFileSync(other, userLine() + toolLine(1));
    t.handler.live.onBatch();
    assert.ok(!c.events().some((e) => e.data.type === 'resync'));
    rmSync(other);
    t.handler.live.onBatch();
    await until(() => c.events().some((e) => e.data.type === 'resync'));
  } finally { await t.stop(); }
});

test('pings, client cleanup, unknown session', async () => {
  const t = await setup({ pingMs: 30 });
  try {
    const c = await t.stream(`/api/sessions/${SID}/stream`).ready;
    await until(() => c.text.includes(': ping'));
    assert.equal(t.handler.live.clientCount(), 1);
    c.req.destroy();
    await until(() => t.handler.live.clientCount() === 0);
    const missing = await t.stream('/api/sessions/nope/stream').ready;
    assert.equal(missing.status, 404);
  } finally { await t.stop(); }
});
