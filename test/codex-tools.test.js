import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexParser, parseRolloutText } from '../src/adapters/codex/index.js';
import { commandOf } from '../src/adapters/codex/tools.js';

const ROOT = fileURLToPath(new URL('./fixtures/codex/sessions', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const FILES = walk(ROOT).filter((p) => p.endsWith('.jsonl'));
const text = (n) => readFileSync(FILES.find((p) => p.endsWith(`${n}.jsonl`)), 'utf8');
const T1 = text('000000000001');
const T2 = text('000000000002');
const T3 = text('000000000003');
const T8 = text('000000000008');
const LIVE = (t) => () => t + 60_000;
const COLD = () => Date.parse('2026-12-01T00:00:00Z');
const tools = (p) => p.spans().filter((s) => s.kind === 'tool');
const byCall = (p, id) => p.spans().find((s) => s.id.endsWith(`:${id}`));

test('old version (0.45): paired call is unknown, unpaired is unknown when cold', () => {
  const p = parseRolloutText('f1', T1, { now: COLD });
  assert.equal(p.meta().cliVersion, '0.45.0');
  assert.deepEqual(p.meta().models, ['gpt-5-codex']);
  const a = byCall(p, 'call_old_1');
  assert.equal(a.status, 'unknown');
  assert.equal(a.end - a.start, 1000);
  assert.equal(a.command, 'ls');
  assert.equal(a.name, 'shell');
  assert.equal(a.toolCategory, 'shell');
  const b = byCall(p, 'call_old_unpaired');
  assert.equal(b.status, 'unknown');
  assert.equal(b.end, null);
  assert.equal(p.turns().length, 0);
});

test('unpaired call is running while the session is recent', () => {
  const p = parseRolloutText('f1', T1, { now: LIVE(Date.parse('2026-03-01T09:00:10.000Z')) });
  const b = byCall(p, 'call_old_unpaired');
  assert.equal(b.status, 'running');
  assert.equal(b.end, null);
  assert.equal(p.spans().find((s) => s.kind === 'session').status, 'running');
});

test('mid version (0.107): turn bands, custom tool pair, aborted turn cancels pending call', () => {
  const p = parseRolloutText('f2', T2, { now: COLD });
  assert.equal(p.meta().branch, 'synthetic-branch');
  const turns = p.turns();
  assert.deepEqual(turns.map((t) => [t.turnId, t.status]), [['turn-a', 'ok'], ['turn-b', 'cancelled']]);
  assert.equal(turns[1].reason, 'interrupted');
  assert.equal(turns[0].model, 'gpt-5.1-codex');
  const patch = byCall(p, 'call_mid_1');
  assert.equal(patch.name, 'apply_patch');
  assert.equal(patch.toolCategory, 'edit');
  assert.equal(patch.status, 'unknown');
  const npm = byCall(p, 'call_mid_2');
  assert.equal(npm.status, 'cancelled');
  assert.equal(npm.end, Date.parse('2026-03-02T10:00:25.000Z'));
  assert.equal(npm.toolBrand, 'npm');
});

test('0.166: item_completed overrides time and status', () => {
  const p = parseRolloutText('f3', T3, { now: COLD });
  const ok = byCall(p, 'call_new_1');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.start, 1772535603000);
  assert.equal(ok.end, 1772535603800);
  assert.equal(ok.toolBrand, 'git');
  const bad = byCall(p, 'call_new_2');
  assert.equal(bad.status, 'error');
  assert.equal(bad.error.message, 'SECRET-MARKER-CX-10 exit 1');
  assert.equal(bad.toolBrand, undefined, 'failed calls never get a brand');
  assert.equal(bad.end - bad.start, 500);
});

test('0.166: SubAgentActivity items do not claim tool calls; spawn_agent stays a tool', () => {
  const p = parseRolloutText('f3', T3, { now: COLD });
  const spawns = tools(p).filter((s) => s.name === 'spawn_agent');
  assert.equal(spawns.length, 4);
  assert.ok(spawns.every((s) => s.toolCategory === 'agent' && s.status === 'unknown'));
  assert.equal(tools(p).length, 6);
});

test('hierarchy: tool -> main agent -> session; ids unique', () => {
  const p = parseRolloutText('f3', T3, { now: COLD });
  const spans = p.spans();
  const [session, agent] = spans;
  assert.equal(session.kind, 'session');
  assert.equal(session.parentId, null);
  assert.equal(agent.kind, 'agent');
  assert.equal(agent.parentId, session.id);
  assert.equal(agent.depth, 0);
  assert.ok(tools(p).every((s) => s.parentId === agent.id && s.source === 'codex' && s.sessionId === session.sessionId));
  assert.equal(new Set(spans.map((s) => s.id)).size, spans.length);
  assert.equal(session.status, 'ok');
  assert.equal(session.model, 'gpt-5.5');
});

test('format unknown: first line not session_meta gives one summary span, no error', () => {
  const p = parseRolloutText('f8', T8, { now: COLD });
  const spans = p.spans();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].status, 'unknown');
  assert.equal(spans[0].name, 'Unknown format');
  assert.equal(p.meta(), null);
  assert.equal(p.turns().length, 0);
});

test('empty and unparsable first line are also unknown format', () => {
  const p = createCodexParser({ fileId: 'x', now: COLD });
  assert.equal(p.push(1, null).length, 1);
  assert.deepEqual(p.push(2, { type: 'response_item', payload: { type: 'function_call', call_id: 'c', name: 'shell' } }), []);
});

test('unknown line types and bad lines are skipped', () => {
  const p = createCodexParser({ fileId: 'x', now: COLD });
  p.push(1, JSON.parse(T2.split('\n')[0]));
  assert.deepEqual(p.push(2, { timestamp: '2026-03-02T10:00:01.000Z', type: 'future_unknown_type', payload: { a: 1 } }).map((s) => s.kind), ['session', 'agent']);
  assert.deepEqual(p.push(3, null), []);
  assert.deepEqual(p.push(4, { type: 'event_msg' }), []);
});

test('incremental = batch for every fixture, and emitted changes converge to spans()', () => {
  for (const f of FILES) {
    const raw = readFileSync(f, 'utf8');
    const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const batch = parseRolloutText('f', raw, { now: COLD });
    const inc = createCodexParser({ fileId: 'f', now: COLD });
    const latest = new Map();
    lines.forEach((o, i) => { for (const s of inc.push(i + 1, o)) latest.set(s.id, s); });
    assert.deepEqual(inc.spans(), batch.spans(), f);
    assert.deepEqual([...latest.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), batch.spans().sort((a, b) => (a.id < b.id ? -1 : 1)), f);
    assert.deepEqual(inc.turns(), batch.turns());
  }
});

test('a call appears as running first, then completes when its output line arrives', () => {
  const p = createCodexParser({ fileId: 'x', now: () => Date.parse('2026-03-01T09:00:05.500Z') });
  const lines = T1.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let seen;
  lines.slice(0, 5).forEach((o, i) => { seen = p.push(i + 1, o); });
  assert.equal(seen.find((s) => s.kind === 'tool').status, 'running');
  seen = p.push(6, lines[5]);
  const t = seen.find((s) => s.kind === 'tool');
  assert.equal(t.status, 'unknown');
  assert.equal(t.end, Date.parse('2026-03-01T09:00:05.000Z'));
});

test('no output body text reaches any span', () => {
  for (const f of FILES) {
    const spans = parseRolloutText('f', readFileSync(f, 'utf8'), { now: COLD }).spans();
    const dump = JSON.stringify(spans);
    assert.doesNotMatch(dump.replace(/SECRET-MARKER-CX-10 exit 1/g, ''), /SECRET-MARKER/, f);
  }
});

test('commandOf handles shells, strings, odd input', () => {
  assert.equal(commandOf('{"command":["bash","-lc","git status"]}'), 'git status');
  assert.equal(commandOf('{"command":["ls","-la"]}'), 'ls -la');
  assert.equal(commandOf('{"cmd":"npm test"}'), 'npm test');
  assert.equal(commandOf('not json'), undefined);
  assert.equal(commandOf(undefined), undefined);
});
