import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRolloutText } from '../src/adapters/codex/index.js';
import { linkCodexAgents } from '../src/adapters/codex/agents.js';

const ROOT = fileURLToPath(new URL('./fixtures/codex/sessions', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const FILES = walk(ROOT).filter((p) => p.endsWith('.jsonl'));
const COLD = () => Date.parse('2026-12-01T00:00:00Z');
const parse = (n) => {
  const p = FILES.find((f) => f.endsWith(`${n}.jsonl`));
  return parseRolloutText(basename(p), readFileSync(p, 'utf8'), { now: COLD });
};
const P = (n) => `00000000-0000-4000-8000-${n}`;
const all = () => ['03', '04', '05', '06', '07'].map((n) => parse(`0000000000${n}`));
const agentOf = (r, nick) => r.spans.find((s) => s.kind === 'agent' && s.name === nick);

test('children link to the parent, wherever their file lives (other date folder too)', () => {
  const r = linkCodexAgents(parse('000000000003'), all());
  const nicks = r.spans.filter((s) => s.kind === 'agent' && s.depth === 1).map((s) => s.name).sort();
  assert.deepEqual(nicks, ['Ada', 'Bob', 'Cy', 'Di']);
  assert.equal(agentOf(r, 'Di').id, `cx:${P('000000000007')}:main`);
});

test('SubAgentActivity gives an exact link; the rest are inferred', () => {
  const r = linkCodexAgents(parse('000000000003'), all());
  const ada = agentOf(r, 'Ada');
  assert.equal(ada.linkApprox, undefined);
  assert.equal(ada.startApprox, undefined);
  for (const n of ['Bob', 'Cy', 'Di']) {
    assert.equal(agentOf(r, n).linkApprox, true, n);
    assert.equal(agentOf(r, n).startApprox, true, n);
  }
});

test('same-instant spawns are consumed one by one, in order', () => {
  const r = linkCodexAgents(parse('000000000003'), all());
  const sp = (c) => `cx:${P('000000000003')}:${c}`;
  assert.equal(agentOf(r, 'Ada').parentId, sp('call_spawn_a'));
  assert.equal(agentOf(r, 'Bob').parentId, sp('call_spawn_b'));
  assert.equal(agentOf(r, 'Cy').parentId, sp('call_spawn_c'));
  assert.equal(agentOf(r, 'Di').parentId, sp('call_spawn_d'));
  for (const [c, n] of [['a', 'Ada'], ['b', 'Bob'], ['c', 'Cy'], ['d', 'Di']]) {
    const tool = r.spans.find((s) => s.id === sp(`call_spawn_${c}`));
    assert.equal(tool.spawnsAgentId, agentOf(r, n).id);
  }
});

test('agent fields: depth, name, task from role, status end/running', () => {
  const r = linkCodexAgents(parse('000000000003'), all());
  const ada = agentOf(r, 'Ada');
  assert.equal(ada.depth, 1);
  assert.equal(ada.task, 'worker');
  assert.equal(ada.source, 'codex');
  assert.equal(ada.status, 'ok');
  assert.equal(ada.end, Date.parse('2026-03-03T11:00:36.800Z'));
  assert.equal(ada.start, Date.parse('2026-03-03T11:00:06.800Z'));
  assert.equal(agentOf(r, 'Bob').status, 'unknown'); // never finished, log is cold
  assert.equal(agentOf(r, 'Cy').status, 'cancelled');
});

test('running child while the log is recent', () => {
  const NOW = () => Date.parse('2026-03-03T11:00:10Z');
  const mk = (n) => {
    const p = FILES.find((f) => f.endsWith(`${n}.jsonl`));
    return parseRolloutText(basename(p), readFileSync(p, 'utf8'), { now: NOW });
  };
  const r = linkCodexAgents(mk('000000000003'), [mk('000000000005')]);
  const bob = agentOf(r, 'Bob');
  assert.equal(bob.status, 'running');
  assert.equal(bob.end, null);
});

test('child spans move under the root session; child session span is dropped', () => {
  const r = linkCodexAgents(parse('000000000003'), all());
  assert.equal(r.spans.filter((s) => s.kind === 'session').length, 1);
  const ids = r.spans.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const childTool = r.spans.find((s) => s.id.endsWith(':call_child_1'));
  assert.equal(childTool.parentId, `cx:${P('000000000004')}:main`);
  assert.equal(childTool.sessionId, P('000000000003'));
  assert.ok(r.spans.every((s) => s.sessionId === P('000000000003')));
});

test('rollouts of another parent are ignored', () => {
  const parent = parse('000000000003');
  const lone = parse('000000000004');
  const r = linkCodexAgents(parse('000000000002'), [lone, parent]);
  assert.equal(r.spans.filter((s) => s.depth === 1).length, 0);
});

test('child with no spawn_agent before it falls back to the root agent, marked inferred', () => {
  const lines = [
    { timestamp: '2026-04-01T00:00:00Z', type: 'session_meta', payload: { id: 'pp', timestamp: '2026-04-01T00:00:00Z', cwd: '/w' } },
    { timestamp: '2026-04-01T00:00:05Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't' } },
  ];
  const kid = [
    { timestamp: '2026-04-01T00:00:03Z', type: 'session_meta', payload: { id: 'kk', timestamp: '2026-04-01T00:00:03Z', cwd: '/w', parent_thread_id: 'pp', agent_nickname: 'Zed' } },
  ];
  const mk = (id, ls) => parseRolloutText(id, ls.map((l) => JSON.stringify(l)).join('\n'), { now: COLD });
  const r = linkCodexAgents(mk('pp', lines), [mk('kk', kid)]);
  const z = agentOf(r, 'Zed');
  assert.equal(z.parentId, 'cx:pp:main');
  assert.equal(z.linkApprox, true);
});

test('grandchildren nest one level deeper; cycles do not loop', () => {
  const mkMeta = (id, parent) => JSON.stringify({ timestamp: '2026-04-01T00:00:00Z', type: 'session_meta', payload: { id, timestamp: '2026-04-01T00:00:00Z', cwd: '/w', ...(parent ? { parent_thread_id: parent, agent_nickname: `n-${id}` } : {}) } });
  const mk = (id, parent) => parseRolloutText(id, mkMeta(id, parent), { now: COLD });
  const r = linkCodexAgents(mk('a'), [mk('b', 'a'), mk('c', 'b')]);
  assert.equal(r.spans.find((s) => s.id === 'cx:c:main').depth, 2);
  const cyc = linkCodexAgents(mk('a', 'c'), [mk('b', 'a'), mk('c', 'b')]);
  assert.ok(cyc.spans.length > 0);
});
