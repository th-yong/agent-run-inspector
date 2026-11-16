// A run whose last turn has ended is waiting for the user: it is not "running", even right after the last write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionText } from '../src/adapters/claude-code/index.js';
import { parseLines } from '../src/adapters/codex/index.js';
import { createIndex } from '../src/index/index.js';

const SID = '00000000-0000-4000-8000-0000000000d1';
const T0 = Date.now() - 30e3;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const base = { sessionId: SID, cwd: '/synthetic/turns' };
const turn = [
  { ...base, type: 'user', timestamp: at(0), message: { role: 'user', content: 'go' } },
  { ...base, type: 'assistant', timestamp: at(2), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
  { ...base, type: 'system', subtype: 'turn_duration', durationMs: 2000, timestamp: at(3) },
];
const nextPrompt = { ...base, type: 'user', timestamp: at(10), message: { role: 'user', content: 'again' } };
const statusOf = (snap) => snap.spans.find((s) => s.kind === 'session').status;

test('claude code: ended turn is done, a new prompt makes it running again', () => {
  const now = T0 + 20e3;
  assert.equal(statusOf(parseSessionText(jl(turn), { fileId: '0', now })), 'ok');
  assert.equal(statusOf(parseSessionText(jl([...turn, nextPrompt]), { fileId: '0', now })), 'running');
});

test('claude code: a final answer ends the turn without turn_duration; a tool call does not', () => {
  const now = T0 + 20e3;
  assert.equal(statusOf(parseSessionText(jl(turn.slice(0, 2)), { fileId: '0', now })), 'ok');
  const toolCall = { ...turn[1], message: { ...turn[1].message, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], stop_reason: 'tool_use' } };
  assert.equal(statusOf(parseSessionText(jl([turn[0], toolCall]), { fileId: '0', now })), 'running');
});

test('session list: ended turn is done unless a sub-agent is still working', () => {
  const root = mkdtempSync(join(tmpdir(), 'ari-turns-'));
  const proj = join(root, '-synthetic-turns');
  mkdirSync(join(proj, SID, 'subagents'), { recursive: true });
  writeFileSync(join(proj, `${SID}.jsonl`), jl(turn));
  const list = () => createIndex({ roots: { claude: [{ path: root }] }, source: 'claude' }).list()[0].status;
  assert.equal(list(), 'ok');
  writeFileSync(join(proj, SID, 'subagents', 'agent-abc.jsonl'), jl([{ ...base, type: 'user', timestamp: at(4), message: { role: 'user', content: 'sub' } }]));
  writeFileSync(join(proj, SID, 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'worker' }));
  assert.equal(list(), 'running');
  writeFileSync(join(proj, SID, 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'worker', finished: true }));
  assert.equal(list(), 'ok');
});

test('codex: a completed last turn is done even while the file is recent', () => {
  const meta = { type: 'session_meta', timestamp: at(0), payload: { id: '00000000-0000-4000-8000-0000000000d2', timestamp: at(0), cwd: '/synthetic/turns', cli_version: '0.166.0' } };
  const started = { type: 'event_msg', timestamp: at(1), payload: { type: 'task_started', turn_id: 't1' } };
  const done = { type: 'event_msg', timestamp: at(5), payload: { type: 'task_complete', turn_id: 't1' } };
  const now = () => T0 + 20e3;
  const session = (lines) => parseLines('0', lines, { now }).spans().find((s) => s.kind === 'session').status;
  assert.equal(session([meta, started]), 'running');
  assert.equal(session([meta, started, done]), 'ok');
});
