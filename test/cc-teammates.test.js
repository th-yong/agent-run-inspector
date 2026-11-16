import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndex } from '../src/index/index.js';

const LEAD = '00000000-0000-4000-8000-00000000f001';
const MATE = '00000000-0000-4000-8000-00000000f002';
const T0 = Date.now() - 60e3;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('agent-team teammate files fold into the lead, also from a worktree folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'ari-mates-'));
  const leadDir = join(root, '-p-app');
  const mateDir = join(root, '-p-app--claude-worktrees-agent-x'); // teammate ran in a worktree
  mkdirSync(leadDir); mkdirSync(mateDir);
  writeFileSync(join(leadDir, `${LEAD}.jsonl`), jl([
    { type: 'user', sessionId: LEAD, cwd: '/p/app', timestamp: at(0), message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: LEAD, timestamp: at(1), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { name: 'qa', subagent_type: 'product-qa' } }] } },
    { type: 'user', sessionId: LEAD, timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
      toolUseResult: { status: 'teammate_spawned', agentId: 'qa@team-1', teammate_id: 'qa@team-1', team_name: 'team-1' } },
  ]));
  writeFileSync(join(mateDir, `${MATE}.jsonl`), jl([
    { type: 'agent-setting', agentSetting: 'product-qa', sessionId: MATE },
    { type: 'user', sessionId: MATE, teamName: 'team-1', agentName: 'qa', cwd: '/p/app/.claude/worktrees/agent-x', timestamp: at(3), message: { role: 'user', content: 'hi' } },
    { type: 'assistant', sessionId: MATE, teamName: 'team-1', agentName: 'qa', timestamp: at(4), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 10, output_tokens: 5 } } },
  ]));
  const idx = createIndex({ roots: { claude: [{ path: root }] }, source: 'claude' });
  const list = idx.list();
  assert.deepEqual(list.map((s) => s.id), [LEAD]); // the teammate is not a session of its own
  const { spans } = idx.open(LEAD);
  const qa = spans.find((s) => s.id === 'ext:qa@team-1');
  assert.equal(qa.external, undefined);
  assert.equal(qa.status, 'running');
  assert.ok(spans.some((s) => s.kind === 'llm' && s.parentId === qa.id)); // its calls hang under it
});

test('spawnedIds finds teammate ids across long lines and only in complete lines', async () => {
  const { spawnedIds, SCAN_CHUNK } = await import('../src/index/scan.js');
  const long = `{"pad":"${'x'.repeat(SCAN_CHUNK + 10)}"}\n`;
  const text = `${long}{"toolUseResult":{"teammate_id":"a@t"}}\n{"toolUseResult":{"teammate_id":"b@t"}}`; // last line unfinished
  const buf = Buffer.from(text);
  const store = { readRange: (_id, o, l) => buf.subarray(o, o + l) };
  const cache = new Map();
  const file = { fileId: 1, size: buf.length };
  assert.deepEqual([...spawnedIds(store, file, cache)], ['a@t']);
  const buf2 = Buffer.concat([buf, Buffer.from('\n')]);
  const store2 = { readRange: (_id, o, l) => buf2.subarray(o, o + l) };
  assert.deepEqual([...spawnedIds(store2, { fileId: 1, size: buf2.length }, cache)].sort(), ['a@t', 'b@t']);
});

test('stopped or shut-down teammates are done although their files are fresh', () => {
  const root = mkdtempSync(join(tmpdir(), 'ari-mates-'));
  const dir = join(root, '-p-app');
  mkdirSync(dir);
  const spawn = (n, id) => [
    { type: 'assistant', sessionId: LEAD, timestamp: at(1), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Agent', input: { name: n } }] } },
    { type: 'user', sessionId: LEAD, timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
      toolUseResult: { status: 'teammate_spawned', teammate_id: `${n}@t` } },
  ];
  writeFileSync(join(dir, `${LEAD}.jsonl`), jl([
    { type: 'user', sessionId: LEAD, cwd: '/p/app', timestamp: at(0), message: { role: 'user', content: 'go' } },
    ...spawn('asked', 's1'), ...spawn('approved', 's2'), ...spawn('stopped', 's3'),
    { type: 'assistant', sessionId: LEAD, timestamp: at(20), message: { content: [{ type: 'tool_use', id: 'ts1', name: 'TaskStop', input: { task_id: 'stopped' } }] } },
    { type: 'user', sessionId: LEAD, timestamp: at(21), message: { content: [{ type: 'tool_result', tool_use_id: 'ts1', content: '{"message":"Successfully stopped task"}' }] } },
    { type: 'system', subtype: 'turn_duration', sessionId: LEAD, timestamp: at(22) },
  ]));
  const mate = (n, i, last) => writeFileSync(join(dir, `00000000-0000-4000-8000-00000000f10${i}.jsonl`), jl([
    { type: 'user', sessionId: `m${i}`, teamName: 't', agentName: n, timestamp: at(3), message: { role: 'user', content: 'work' } },
    last,
  ]));
  mate('asked', 1, { type: 'user', sessionId: 'm1', timestamp: at(15), message: { role: 'user', content: '<teammate-message teammate_id="team-lead">\n{"type":"shutdown_request","from":"team-lead"}\n</teammate-message>' } });
  mate('approved', 2, { type: 'assistant', sessionId: 'm2', timestamp: at(16), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x2', name: 'SendMessage', input: { to: 'team-lead', message: { type: 'shutdown_response', approve: true }, type: 'shutdown_response', approve: true } }] } });
  mate('stopped', 3, { type: 'assistant', sessionId: 'm3', timestamp: at(10), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x3', name: 'Read', input: {} }] } });

  const idx = createIndex({ roots: { claude: [{ path: root }] }, source: 'claude' });
  assert.equal(idx.list()[0].status, 'ok');
  const { spans } = idx.open(LEAD);
  for (const n of ['asked', 'approved', 'stopped']) assert.equal(spans.find((s) => s.id === `ext:${n}@t`).status, 'ok', n);
  assert.deepEqual(spans.filter((s) => s.status === 'running').map((s) => s.name), []); // their open calls do not run on
});
