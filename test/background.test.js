// A run whose turn ended while a background task (run_in_background Bash, Monitor, background agent) is still
// open is running, flagged `background`; the task-notification with a final status closes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionText } from '../src/adapters/claude-code/index.js';
import { createIndex } from '../src/index/index.js';

const SID = '00000000-0000-4000-8000-0000000000e1';
const T0 = Date.now() - 60e3;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const base = { sessionId: SID, cwd: '/synthetic/bg' };
const asst = (s, content, stop) => ({ ...base, type: 'assistant', timestamp: at(s), message: { id: `m${s}`, model: 'claude-opus-5-5', content, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } } });
const result = (s, id, tur) => ({ ...base, type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult: tur });
const note = (s, task, status) => ({ ...base, type: 'user', timestamp: at(s), origin: { kind: 'task-notification' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<status>${status}</status>\n<summary>SECRET</summary>\n</task-notification>` } });
const turnEnd = (s) => ({ ...base, type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: at(s) });

const launch = [
  { ...base, type: 'user', timestamp: at(0), message: { role: 'user', content: 'go' } },
  asst(1, [{ type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'sleep 100', run_in_background: true } }], 'tool_use'),
  result(2, 'tb', { backgroundTaskId: 'bg1', interrupted: false }),
  asst(3, [{ type: 'text', text: 'waiting' }], 'end_turn'),
  turnEnd(4),
];
const resumed = [...launch, note(10, 'bg1', 'completed')];
const finished = [...resumed, asst(12, [{ type: 'text', text: 'done' }], 'end_turn'), turnEnd(13)];

function both(rows, now = T0 + 20e3) {
  const snap = parseSessionText(jl(rows), { fileId: '0', now });
  const s = snap.spans.find((x) => x.kind === 'session');
  const root = mkdtempSync(join(tmpdir(), 'ari-bg-'));
  mkdirSync(join(root, '-synthetic-bg'));
  writeFileSync(join(root, '-synthetic-bg', `${SID}.jsonl`), jl(rows));
  const l = createIndex({ roots: { claude: [{ path: root }] }, source: 'claude', now: () => now }).list()[0];
  const full = { status: s.status, background: Boolean(s.background) };
  assert.deepEqual({ status: l.status, background: Boolean(l.background) }, full, 'list and full parse agree');
  assert.equal(Boolean(snap.spans.find((x) => x.id === `${SID}:main`).background), full.background, 'root agent carries the flag');
  return full;
}

test('background bash: turn end -> background, notification -> running, final answer -> ok', () => {
  assert.deepEqual(both(launch), { status: 'running', background: true });
  assert.deepEqual(both(resumed), { status: 'running', background: false });
  assert.deepEqual(both(finished), { status: 'ok', background: false });
});

test('a non-final notification keeps the task open; TaskStop closes it', () => {
  assert.deepEqual(both([...launch, note(10, 'bg1', 'running')]).background, false); // agent is reacting, turn is open
  assert.deepEqual(both([...launch, note(10, 'bg1', 'running'), asst(11, [{ type: 'text', text: 'k' }], 'end_turn')]), { status: 'running', background: true });
  const stop = [asst(10, [{ type: 'tool_use', id: 'ts', name: 'TaskStop', input: { task_id: 'bg1' } }], 'tool_use'), result(11, 'ts', {}), asst(12, [{ type: 'text', text: 'k' }], 'end_turn')];
  assert.deepEqual(both([...launch.slice(0, 3), ...stop]), { status: 'ok', background: false });
});

test('monitor task id comes from its result', () => {
  const rows = [
    { ...base, type: 'user', timestamp: at(0), message: { role: 'user', content: 'go' } },
    asst(1, [{ type: 'tool_use', id: 'tm', name: 'Monitor', input: {} }], 'tool_use'),
    result(2, 'tm', { taskId: 'mon1', persistent: false, timeoutMs: 60000 }),
    asst(3, [{ type: 'text', text: 'watching' }], 'end_turn'),
  ];
  assert.deepEqual(both(rows), { status: 'running', background: true });
  assert.deepEqual(both([...rows, note(10, 'mon1', 'killed'), asst(11, [{ type: 'text', text: 'k' }], 'end_turn')]), { status: 'ok', background: false });
});

test('an open background task stops counting after 10 quiet minutes', () => {
  assert.deepEqual(both(launch, T0 + 11 * 60e3), { status: 'ok', background: false });
});
