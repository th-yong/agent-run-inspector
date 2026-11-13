import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./fixtures/codex/sessions', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^rollout-(\d{4})-(\d{2})-(\d{2})T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})\.jsonl$/;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ROOT).filter((p) => p.endsWith('.jsonl'));
const sessions = files.map((path) => {
  const rel = relative(ROOT, path).split(sep);
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
  return { path, rel, text, lines, first: lines[0] };
});
const metaOf = (s) => s.lines.find((l) => l.type === 'session_meta')?.payload;
const byVersion = (prefix) => sessions.filter((s) => s.first.type === 'session_meta' && s.first.payload.cli_version.startsWith(prefix));
const all = (s) => s.lines;
const payloads = (s, type, sub) => s.lines.filter((l) => l.type === type && (!sub || l.payload.type === sub)).map((l) => l.payload);

test('every file parses line by line and has a well-formed name and folder', () => {
  assert.ok(files.length >= 8);
  for (const s of sessions) {
    const m = NAME.exec(s.rel.at(-1));
    assert.ok(m, `bad name ${s.rel.join('/')}`);
    assert.deepEqual(s.rel.slice(0, 3), [m[1], m[2], m[3]], 'folder matches filename date');
    assert.match(m[4], UUID);
    assert.ok(s.text.endsWith('\n'));
    for (const l of s.lines) {
      assert.equal(typeof l.timestamp, 'string');
      assert.equal(typeof l.type, 'string');
      assert.ok(l.payload && typeof l.payload === 'object');
    }
  }
});

test('synthetic only: marker strings present, no real paths or home dirs', () => {
  for (const s of sessions) {
    assert.match(s.text, /SECRET-MARKER-CX-\d+/);
    assert.doesNotMatch(s.text, /\/Users\/|\/home\/|C:\\\\/);
    for (const l of s.lines.filter((x) => x.type === 'session_meta')) {
      assert.match(l.payload.id, UUID);
      assert.equal(l.payload.id, l.payload.id.toLowerCase());
      assert.ok(l.payload.id.startsWith('00000000-0000-4000-8000-'), 'synthetic id format');
      assert.equal(l.payload.cwd, '/work/synthetic-project');
    }
  }
});

test('covers old (0.4x): info null, duplicate cumulative token_count, unpaired call', () => {
  const [s] = byVersion('0.4');
  assert.ok(s);
  const tc = payloads(s, 'event_msg', 'token_count');
  assert.ok(tc.some((p) => p.info === null));
  const cums = tc.filter((p) => p.info).map((p) => JSON.stringify(p.info.total_token_usage));
  assert.ok(new Set(cums).size < cums.length, 'a cumulative total repeats');
  const calls = payloads(s, 'response_item', 'function_call').map((p) => p.call_id);
  const outs = new Set(payloads(s, 'response_item', 'function_call_output').map((p) => p.call_id));
  assert.ok(calls.some((c) => !outs.has(c)), 'one call has no output');
  assert.ok(calls.some((c) => outs.has(c)), 'one call has an output');
  assert.equal(payloads(s, 'event_msg', 'task_started').length, 0);
});

test('covers middle (0.107): task_started/complete, turn_aborted, custom_tool_call', () => {
  const [s] = byVersion('0.107');
  assert.ok(s);
  assert.ok(payloads(s, 'event_msg', 'task_started').length >= 2);
  assert.ok(payloads(s, 'event_msg', 'task_complete').length >= 1);
  assert.equal(payloads(s, 'event_msg', 'turn_aborted')[0].reason, 'interrupted');
  const c = payloads(s, 'response_item', 'custom_tool_call')[0];
  assert.ok(payloads(s, 'response_item', 'custom_tool_call_output').some((o) => o.call_id === c.call_id));
  assert.ok(s.lines.some((l) => l.type === 'turn_context' && l.payload.model));
  assert.ok(metaOf(s).git.branch);
});

test('covers 0.166 parent: token_usage_record, item_completed, SubAgentActivity, cache_write', () => {
  const parent = sessions.find((s) => metaOf(s)?.cli_version === '0.166.0' && !metaOf(s).parent_thread_id);
  assert.ok(parent);
  assert.ok(parent.lines.every((l, i) => l.ordinal === i), 'ordinal present');
  const recs = parent.lines.filter((l) => l.type === 'token_usage_record');
  assert.equal(recs.length, 2);
  for (const r of recs) {
    for (const k of ['response_id', 'turn_id', 'usage', 'turn_token_usage', 'thread_token_usage']) assert.ok(k in r.payload, k);
  }
  assert.ok(recs.some((r) => r.payload.usage.cache_write_input_tokens > 0));
  assert.equal(payloads(parent, 'event_msg', 'token_count').length, 2, 'token_count accompanies each record');
  const items = payloads(parent, 'event_msg', 'item_completed');
  const cmd = items.filter((p) => p.item.type === 'CommandExecution');
  assert.ok(cmd.some((p) => p.item.status === 'completed' && p.item.exit_code === 0));
  assert.ok(cmd.some((p) => p.item.status === 'failed' && p.item.exit_code === 1 && p.item.error.message));
  for (const p of cmd) assert.ok(p.started_at_ms < p.completed_at_ms);
  const sub = items.filter((p) => p.item.type === 'SubAgentActivity');
  assert.deepEqual(sub.map((p) => p.item.kind), ['started', 'completed']);
});

test('two spawn_agent calls share one timestamp; more spawn calls follow', () => {
  const parent = sessions.find((s) => metaOf(s)?.cli_version === '0.166.0' && !metaOf(s).parent_thread_id);
  const spawns = parent.lines.filter((l) => l.type === 'response_item' && l.payload.type === 'function_call' && l.payload.name === 'spawn_agent');
  assert.equal(spawns.length, 4);
  assert.equal(spawns[0].timestamp, spawns[1].timestamp);
  assert.notEqual(spawns[1].timestamp, spawns[2].timestamp);
  assert.equal(new Set(spawns.map((l) => l.payload.call_id)).size, 4);
});

test('child rollouts: both parent link shapes, depth, nickname, role, one in another date folder', () => {
  const parent = sessions.find((s) => metaOf(s)?.cli_version === '0.166.0' && !metaOf(s).parent_thread_id);
  const parentId = metaOf(parent).id;
  const kids = sessions.filter((s) => metaOf(s)?.parent_thread_id);
  assert.equal(kids.length, 4);
  for (const k of kids) assert.equal(metaOf(k).parent_thread_id, parentId);
  const spawnForm = kids.filter((k) => metaOf(k).source?.subagent?.thread_spawn);
  const flatOnly = kids.filter((k) => !metaOf(k).source);
  assert.ok(spawnForm.length >= 1 && flatOnly.length >= 1);
  for (const k of spawnForm) {
    const t = metaOf(k).source.subagent.thread_spawn;
    assert.equal(t.parent_thread_id, parentId);
    assert.equal(t.depth, 1);
    assert.ok(t.agent_nickname && t.agent_role);
  }
  const parentDay = parent.rel.slice(0, 3).join('/');
  const other = kids.filter((k) => k.rel.slice(0, 3).join('/') !== parentDay);
  assert.equal(other.length, 1, 'exactly one child in a different date folder');
  const same = kids.filter((k) => k.rel.slice(0, 3).join('/') === parentDay);
  assert.equal(same.length, 3);
  // two children start at the same instant
  const starts = same.map((k) => metaOf(k).timestamp);
  assert.ok(new Set(starts).size < starts.length);
  // SubAgentActivity link points to an existing child
  const link = payloads(parent, 'event_msg', 'item_completed').find((p) => p.item.type === 'SubAgentActivity').item.agent_thread_id;
  assert.ok(kids.some((k) => metaOf(k).id === link));
  // endings: completed, aborted, still running
  const ends = kids.map((k) => (payloads(k, 'event_msg', 'task_complete').length ? 'complete' : payloads(k, 'event_msg', 'turn_aborted').length ? 'aborted' : 'running')).sort();
  assert.deepEqual(ends, ['aborted', 'complete', 'complete', 'running']);
  // child start comes after at least one parent spawn call
  const firstSpawn = parent.lines.find((l) => l.payload.name === 'spawn_agent').timestamp;
  for (const k of kids) assert.ok(metaOf(k).timestamp > firstSpawn);
});

test('file whose first line is not session_meta, plus an unknown line type', () => {
  const odd = sessions.filter((s) => s.first.type !== 'session_meta');
  assert.equal(odd.length, 1);
  assert.ok(odd[0].lines.some((l) => l.type === 'session_meta'), 'session_meta exists later');
  assert.ok(odd[0].lines.some((l) => l.type === 'future_unknown_type'));
});

test('cli_version spans old, middle and new', () => {
  const versions = sessions.map((s) => metaOf(s).cli_version);
  for (const p of ['0.4', '0.107', '0.166']) assert.ok(versions.some((v) => v.startsWith(p)), p);
});
