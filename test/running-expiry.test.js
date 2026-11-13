// A session that stops being written must leave "running" in the list even though no file changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndex } from '../src/index/index.js';
import { createLiveHub } from '../src/live/sse.js';
import { createRedactor } from '../src/model/redact.js';

const SID = '00000000-0000-4000-8000-0000000000c1';
const MIN = 60 * 1000;

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ari-expiry-')));
  const proj = join(root, '-synthetic-expiry');
  mkdirSync(proj);
  const t = Date.now();
  const rec = { isSidechain: false, sessionId: SID, cwd: '/synthetic/expiry', version: '0.0.0-synthetic', type: 'user', uuid: 'u1', parentUuid: null, timestamp: new Date(t).toISOString(), message: { role: 'user', content: 'hi' } };
  const file = join(proj, `${SID}.jsonl`);
  writeFileSync(file, `${JSON.stringify(rec)}\n`);
  utimesSync(file, t / 1000, t / 1000);
  return { root, t };
}

test('index.list drops a stale running summary once the quiet window has passed', () => {
  const { root, t } = fixture();
  let clock = t + MIN;
  const index = createIndex({ roots: { claude: [{ path: root }], codex: [] }, now: () => clock });
  assert.equal(index.list()[0].status, 'running');
  clock = t + 11 * MIN;
  const s = index.list()[0];
  assert.notEqual(s.status, 'running');
  assert.notEqual(s.end, null);
});

test('the list stream announces the end of a quiet session without any file change', async () => {
  const { root, t } = fixture();
  let clock = t + MIN;
  const index = createIndex({ roots: { claude: [{ path: root }], codex: [] }, now: () => clock });
  const hub = createLiveHub({ index, redactor: createRedactor({ mode: 'off' }), sweepMs: 20 });
  const res = Object.assign(new EventEmitter(), { text: '', setHeader() {}, flushHeaders() {}, write(d) { this.text += d; return true; }, end() {} });
  hub.streamList({ headers: {}, on() {} }, res);
  clock = t + 11 * MIN;
  const t0 = Date.now();
  while (!/"type":"session"/.test(res.text) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 10));
  hub.close();
  const data = JSON.parse(/data: (.*\"type\":\"session\".*)/.exec(res.text)[1]);
  assert.notEqual(data.summary.status, 'running');
});
