import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIndex } from '../src/index/index.js';
import { parseSince } from '../src/index/scan.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CC_ROOT = join(FIX, 'claude-code/projects');
const CX_ROOT = join(FIX, 'codex/sessions');
const NOW = Date.parse('2026-12-01T00:00:00Z');
const mk = (claude = [CC_ROOT], codex = [CX_ROOT], extra = {}) => createIndex({
  roots: { claude: claude.map((path) => ({ path })), codex: codex.map((path) => ({ path })) },
  now: () => NOW,
  ...extra,
});
const A1 = '00000000-0000-4000-8000-0000000000a1';
const CX3 = 'cx:00000000-0000-4000-8000-000000000003';

// Snapshot form: checkout mtimes and the fileId-based unknown id are not stable.
const stable = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'lastWrite' ? 0 : v)).replace(/cx:unknown:\d+/g, 'cx:unknown:N'));
const byId = (arr) => [...arr].sort((a, b) => (a.id < b.id ? -1 : 1));

test('parseSince accepts 24h / 7d and rejects the rest', () => {
  assert.equal(parseSince('24h'), 24 * 3600e3);
  assert.equal(parseSince('7d'), 7 * 86400e3);
  assert.equal(parseSince(undefined), null);
  assert.throws(() => parseSince('soon'));
});

test('fixture roots: one list with CC and Codex sessions, sub-agents folded into the parent', () => {
  const list = mk().list();
  const ids = list.map((s) => s.id).sort();
  assert.ok(ids.includes(A1));
  assert.ok(ids.includes(CX3));
  // codex children (...04 ...05 ...06 ...07) are not sessions of their own
  for (const n of ['04', '05', '06', '07']) assert.ok(!ids.includes(`cx:00000000-0000-4000-8000-0000000000${n}`));
  assert.equal(list.filter((s) => s.source === 'claude-code').length, 2);
  assert.equal(list.find((s) => s.id === A1).agentCount, 4); // main + 3 sub-agent files
  assert.equal(list.find((s) => s.id === CX3).agentCount, 5); // root + 4 child rollouts
});

test('list summary snapshot (quick path)', () => {
  const list = mk().list();
  const snap = JSON.parse(readFileSync(join(FIX, 'index-quick.snapshot.json'), 'utf8'));
  assert.deepEqual(stable(byId(list)), snap);
});

test('opened summary snapshot (full parse), same shape as the quick one', () => {
  const idx = mk();
  const out = [];
  for (const s of idx.list()) {
    const full = idx.open(s.id).summary;
    const req = ['id', 'source', 'project', 'start', 'end', 'lastWrite', 'status', 'agentCount', 'callCount', 'errorCount', 'totals', 'models', 'inferredLinks', 'detail'];
    for (const k of req) assert.ok(k in full && k in s, `${s.id} ${k}`);
    assert.equal(s.detail, false);
    out.push(full);
  }
  const snap = JSON.parse(readFileSync(join(FIX, 'index-full.snapshot.json'), 'utf8'));
  assert.deepEqual(stable(byId(out)), snap);
});

test('open: CC and Codex give the same top-level shape; Codex children are linked', () => {
  const idx = mk();
  idx.list();
  const cc = idx.open(A1);
  const cx = idx.open(CX3);
  for (const r of [cc, cx]) {
    assert.deepEqual(Object.keys(r).sort(), ['markers', 'spans', 'summary', 'turns']);
    assert.equal(r.spans.filter((s) => s.kind === 'session').length, 1);
    assert.equal(r.summary.id, r.spans.find((s) => s.kind === 'session').id);
  }
  assert.ok(cc.markers.length >= 1);
  assert.deepEqual(cx.markers, []);
  assert.ok(cx.spans.some((s) => s.kind === 'agent' && s.linkApprox));
  assert.ok(cx.summary.inferredLinks >= 3);
  assert.equal(cc.summary.inferredLinks, 0);
  assert.ok(cx.turns.every((t) => 'start' in t && 'end' in t && 'status' in t));
  assert.ok(cc.turns.every((t) => 'start' in t && 'end' in t && 'status' in t));
  assert.equal(cx.summary.agentCount, 5);
  assert.equal(cc.summary.detail, true);
});

test('open is cached until the files change', () => {
  const idx = mk();
  idx.list();
  assert.equal(idx.open(A1), idx.open(A1));
  assert.throws(() => idx.open('nope'), { code: 'ARI_UNKNOWN_SESSION' });
});

test('output carries no file paths', () => {
  const idx = mk();
  const text = JSON.stringify([idx.list(), idx.open(A1), idx.open(CX3)]);
  assert.ok(!text.includes(FIX));
  assert.ok(!text.includes('/Users/'));
  assert.ok(!/rollout-2026/.test(text));
});

test('--source filter', () => {
  assert.ok(mk([CC_ROOT], [CX_ROOT], { source: 'claude' }).list().every((s) => s.source === 'claude-code'));
  assert.ok(mk([CC_ROOT], [CX_ROOT], { source: 'codex' }).list().every((s) => s.source === 'codex'));
  assert.equal(mk([CC_ROOT], [CX_ROOT], { source: 'all' }).list().length, mk().list().length);
});

function tmp() { return realpathSync(mkdtempSync(join(tmpdir(), 'ari-idx-'))); }
const line = (o) => `${JSON.stringify(o)}\n`;
function writeCc(root, proj, sid, mtimeSec, extra = '') {
  const touch = mtimeSec !== null;
  const dir = join(root, proj);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${sid}.jsonl`);
  writeFileSync(f, line({ type: 'user', sessionId: sid, timestamp: '2026-01-01T00:00:00.000Z', cwd: `/w/${proj}`, gitBranch: 'main', message: { role: 'user', content: 'hi' } })
    + extra
    + line({ type: 'ai-title', aiTitle: `T ${sid}`, sessionId: sid }));
  if (touch) utimesSync(f, mtimeSec, mtimeSec);
  return f;
}

test('--since filters by last write (own file or any sub-agent file)', () => {
  const root = tmp();
  const now = NOW / 1000;
  writeCc(root, 'p', 'new', now - 3600);
  writeCc(root, 'p', 'old', now - 10 * 86400);
  const old2 = writeCc(root, 'p', 'old2', now - 10 * 86400);
  mkdirSync(join(root, 'p', 'old2', 'subagents'), { recursive: true });
  const sub = join(root, 'p', 'old2', 'subagents', 'agent-x1.jsonl');
  writeFileSync(sub, line({ type: 'user', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'x' } }));
  utimesSync(sub, now - 60, now - 60);
  assert.ok(old2);
  const ids = createIndex({ roots: { claude: [{ path: root }], codex: [] }, now: () => NOW, since: '24h' }).list().map((s) => s.id).sort();
  assert.deepEqual(ids, ['new', 'old2']);
});

test('origin label only when a source has two or more roots', () => {
  const a = tmp(); const b = tmp();
  writeCc(a, 'p', 's1', NOW / 1000 - 5000);
  writeCc(b, 'p', 's2', NOW / 1000 - 6000);
  const two = createIndex({ roots: { claude: [{ path: a }, { path: b }], codex: [] }, now: () => NOW }).list();
  assert.equal(two.length, 2);
  assert.ok(two.every((s) => typeof s.origin === 'string' && s.origin.length > 0));
  assert.notEqual(two[0].origin, two[1].origin);
  assert.ok(!JSON.stringify(two).includes(a));
  const one = createIndex({ roots: { claude: [{ path: a }], codex: [] }, now: () => NOW }).list();
  assert.equal(one[0].origin, undefined);
});

test('symlinked folders and files are not followed', () => {
  const root = tmp(); const outside = tmp();
  const evil = writeCc(outside, 'p', 'evil', NOW / 1000);
  symlinkSync(join(outside, 'p'), join(root, 'linked-dir'));
  mkdirSync(join(root, 'p'));
  symlinkSync(evil, join(root, 'p', 'evil.jsonl'));
  assert.deepEqual(createIndex({ roots: { claude: [{ path: root }], codex: [] }, now: () => NOW }).list(), []);
});

test('list sorts by last write, newest first, and survives empty roots', () => {
  const root = tmp();
  writeCc(root, 'p', 'a', NOW / 1000 - 300);
  writeCc(root, 'p', 'b', NOW / 1000 - 100);
  writeCc(root, 'p', 'c', NOW / 1000 - 200);
  const l = createIndex({ roots: { claude: [{ path: root }], codex: [] }, now: () => NOW }).list();
  assert.deepEqual(l.map((s) => s.id), ['b', 'c', 'a']);
  assert.deepEqual(createIndex({ roots: { claude: [], codex: [] }, now: () => NOW }).list(), []);
});

test('1,000 synthetic sessions list within 1 second', () => {
  const root = tmp();
  const cc = join(root, 'cc'); const cx = join(root, 'cx');
  const filler = line({ type: 'assistant', timestamp: '2026-01-01T00:00:05.000Z', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'x'.repeat(400) }], usage: { input_tokens: 1, output_tokens: 1 } } });
  for (let i = 0; i < 500; i++) {
    const sid = `s${String(i).padStart(4, '0')}`;
    // ~300 KB main files so a full read would be visible
    writeCc(cc, `proj${i % 20}`, sid, null, filler.repeat(i % 5 === 0 ? 750 : 20));
    if (i % 10 === 0) {
      const d = join(cc, `proj${i % 20}`, sid, 'subagents');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'agent-a1.jsonl'), line({ type: 'user', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'x' } }));
    }
  }
  for (let i = 0; i < 500; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const dir = join(cx, '2026', '03', String(1 + (i % 28)).padStart(2, '0'));
    mkdirSync(dir, { recursive: true });
    const body = line({ timestamp: '2026-03-01T00:00:00.000Z', type: 'session_meta', payload: { id, timestamp: '2026-03-01T00:00:00.000Z', cwd: '/w/p', cli_version: '0.166.0', ...(i % 7 === 3 ? { parent_thread_id: `00000000-0000-4000-8000-${String(i - 3).padStart(12, '0')}` } : {}) } })
      + line({ timestamp: '2026-03-01T00:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-x' } }).repeat(i % 5 === 0 ? 1500 : 10)
      + line({ timestamp: '2026-03-01T00:00:09.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 't' } });
    const f = join(dir, `rollout-2026-03-01T00-00-00-${id}.jsonl`);
    writeFileSync(f, body);
  }
  const idx = createIndex({ roots: { claude: [{ path: cc }], codex: [{ path: cx }] }, now: () => NOW });
  const t0 = performance.now();
  const list = idx.list();
  const ms = performance.now() - t0;
  assert.ok(list.length >= 900 && list.length <= 1000, `sessions: ${list.length}`);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  const t1 = performance.now();
  idx.list(); // second call uses the quick-summary cache
  assert.ok(performance.now() - t1 < 1000);
});
