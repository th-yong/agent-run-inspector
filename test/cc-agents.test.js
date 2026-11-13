import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeSession, parseSessionText } from '../src/adapters/claude-code/index.js';
import { buildSessionTree } from '../src/adapters/claude-code/agents.js';

const DIR = fileURLToPath(new URL('./fixtures/claude-code/projects/-synthetic-demo-app/', import.meta.url));
const S1 = '00000000-0000-4000-8000-0000000000a1';
const S2 = '00000000-0000-4000-8000-0000000000a2';
const NOW = Date.parse('2026-06-01T00:00:00Z');
const ms = (iso) => Date.parse(iso);

function load(sid, opts = {}) {
  const subDir = `${DIR}${sid}/subagents/`;
  const subagents = readdirSync(subDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f, i) => ({
      fileId: `${sid}-sub${i}`,
      agentId: f.slice('agent-'.length, -'.jsonl'.length),
      text: readFileSync(subDir + f, 'utf8'),
      meta: JSON.parse(readFileSync(subDir + f.replace(/\.jsonl$/, '.meta.json'), 'utf8')),
    }));
  return buildSessionTree({ main: { fileId: sid, text: readFileSync(`${DIR}${sid}.jsonl`, 'utf8') }, subagents, now: NOW, ...opts });
}
const t1 = load(S1);
const t2 = load(S2);
const byId = (t, id) => t.spans.find((s) => s.id === id);
const agents = (t) => t.spans.filter((s) => s.kind === 'agent');

test('root agent span: session child, depth 0, orchestrator; llm and tool hang under it', () => {
  const root = byId(t1, `${S1}:main`);
  assert.equal(root.kind, 'agent');
  assert.equal(root.parentId, S1);
  assert.equal(root.depth, 0);
  assert.equal(root.role, 'orchestrator');
  assert.equal(byId(t1, S1).parentId, null);
  assert.equal(byId(t1, 'tool:toolu_synth_bash1').parentId, `${S1}:main`);
  assert.ok(t1.spans.filter((s) => s.kind === 'llm' && s.parentId === `${S1}:main`).length > 0);
});

test('depth 1 and 2 tree shape', () => {
  const h1 = byId(t1, 'ag:toolu_synth_agent1');
  const h2 = byId(t1, 'ag:toolu_synth_agent2');
  const g = byId(t1, 'ag:toolu_synth_a1_agent');
  assert.equal(h1.parentId, `${S1}:main`);
  assert.equal(h2.parentId, `${S1}:main`);
  assert.equal(g.parentId, h1.id);
  assert.deepEqual([h1.depth, h2.depth, g.depth], [1, 1, 2]);
  assert.equal(h1.kind, 'agent');
  assert.equal(h1.role, 'worker');
  assert.equal(h1.agentType, 'worker');
  assert.equal(h1.name, 'helper-one');
  assert.equal(h1.task, 'synthetic helper');
  assert.equal(h1.model, 'synthetic-model-b');
  assert.equal(h1.provider, 'other');
});

test('sub-agent file llm and tool spans hang under their agent span', () => {
  const inner = t1.spans.filter((s) => (s.kind === 'llm' || s.kind === 'tool') && s.parentId === 'ag:toolu_synth_agent1');
  assert.ok(inner.length > 0);
  assert.ok(inner.every((s) => s.ref.fileId === `${S1}-sub0`));
  const ids = t1.spans.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'span ids are unique');
  assert.equal(t1.spans.filter((s) => s.kind === 'session').length, 1);
});

test('Agent calls make no tool span', () => {
  assert.equal(t1.spans.some((s) => s.kind === 'tool' && /^agent$/i.test(s.name)), false);
});

test('finished agent: ok, ends at the last line of its file', () => {
  const h1 = byId(t1, 'ag:toolu_synth_agent1');
  assert.equal(h1.status, 'ok');
  assert.ok(h1.end > h1.start);
  assert.equal(h1.start, ms('2026-01-01T00:00:05Z'));
  assert.equal(h1.ref.fileId, S1);
});

test('running / stopped by user', () => {
  const recent = load(S2, { now: ms('2026-01-02T00:05:00Z') });
  const run = byId(recent, 'ag:toolu_synth_s2_run');
  assert.equal(run.status, 'running');
  assert.equal(run.end, null);
  const stop = byId(recent, 'ag:toolu_synth_s2_stop');
  assert.equal(stop.status, 'cancelled');
  assert.ok(stop.end !== null);
  assert.equal(byId(recent, S2).status, 'running');
  // long after: unfinished, unstopped -> unknown, never "running"
  assert.equal(byId(t2, 'ag:toolu_synth_s2_run').status, 'unknown');
  assert.equal(byId(t2, 'ag:toolu_synth_s2_run').end, null);
});

test('teammate_spawned -> external agent node, no file link', () => {
  const ext = agents(t1).filter((a) => a.external);
  assert.equal(ext.length, 1);
  const e = ext[0];
  assert.equal(e.id, 'ext:mate@synth-team');
  assert.equal(e.name, 'mate');
  assert.equal(e.agentType, 'worker');
  assert.equal(e.parentId, `${S1}:main`);
  assert.equal(e.start, ms('2026-01-01T00:00:08Z'));
  assert.equal(e.end, null);
  assert.equal(e.status, 'unknown');
  assert.equal(e.task, undefined);
  assert.equal(agents(t1).filter((a) => !a.external && a.depth === 0).length, 1);
});

test('no body text leaks into spans', () => {
  const noCommands = t1.spans.map(({ command, ...rest }) => rest); // Bash command is a masked field by design
  assert.doesNotMatch(JSON.stringify(noCommands), /SECRET-MARKER/);
});

test('orphan sub file (no matching call) hangs under the root agent', () => {
  const lines = [{ type: 'user', timestamp: '2026-01-01T00:00:00Z', sessionId: 's', message: { role: 'user', content: 'x' } }];
  const t = buildSessionTree({
    main: { fileId: 'm', text: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' },
    subagents: [{ fileId: 'x', agentId: 'a9', text: JSON.stringify({ ...lines[0], timestamp: '2026-01-01T00:00:05Z' }) + '\n', meta: { name: 'lost', spawnDepth: 1, finished: true } }],
    now: NOW,
  });
  const a = t.spans.find((s) => s.id === 'ag:file:a9');
  assert.equal(a.parentId, 's:main');
  assert.equal(a.name, 'lost');
  assert.equal(a.status, 'ok');
});

test('meta without finished but a matching task-notification -> ok', () => {
  const call = { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', sessionId: 's', message: { id: 'm1', model: 'm', stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { description: 'd' } }] } };
  const res = { type: 'user', timestamp: '2026-01-01T00:00:02Z', sessionId: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] }, toolUseResult: { status: 'async_launched', agentId: 'ag1' } };
  const note = { type: 'user', timestamp: '2026-01-01T00:00:30Z', sessionId: 's', message: { role: 'user', content: 'agent ag1 done' }, origin: { kind: 'task-notification' } };
  const t = buildSessionTree({
    main: { fileId: 'm', text: [call, res, note].map((l) => JSON.stringify(l)).join('\n') + '\n' },
    subagents: [{ fileId: 'x', agentId: 'ag1', text: JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:20Z', sessionId: 's', message: { role: 'user', content: 'p' } }) + '\n', meta: { toolUseId: 'tu1', spawnDepth: 1 } }],
    now: NOW,
  });
  const a = t.spans.find((s) => s.id === 'ag:tu1');
  assert.equal(a.status, 'ok');
  assert.equal(a.end, ms('2026-01-01T00:00:30Z'));
});

test('Agent call without a file: sync result ok, error result error', () => {
  const mk = (id, extra) => [
    { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', sessionId: 's', message: { id: 'm' + id, model: 'm', stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id, name: 'Task', input: { subagent_type: 'x' } }] } },
    { type: 'user', timestamp: '2026-01-01T00:00:04Z', sessionId: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'r', ...extra }] }, toolUseResult: { status: 'completed' } },
  ];
  const text = [...mk('a', {}), ...mk('b', { is_error: true })].map((l) => JSON.stringify(l)).join('\n') + '\n';
  const snap = parseSessionText(text, { fileId: 'f', now: NOW });
  assert.equal(snap.spans.find((s) => s.id === 'ag:a').status, 'ok');
  assert.equal(snap.spans.find((s) => s.id === 'ag:a').end, ms('2026-01-01T00:00:04Z'));
  assert.equal(snap.spans.find((s) => s.id === 'ag:b').status, 'error');
});

test('incremental feed equals whole-file parse', () => {
  const text = readFileSync(`${DIR}${S1}.jsonl`, 'utf8');
  const s = new ClaudeCodeSession({ fileId: S1, now: NOW });
  for (let i = 0; i < text.length; i += 97) s.push(text.slice(i, i + 97));
  assert.deepEqual(s.snapshot(), parseSessionText(text, { fileId: S1, now: NOW }));
});
