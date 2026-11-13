import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, TotalsTree } from '../src/model/totals.js';

const sp = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'ok', start: 1000, end: 2000, ...extra });
const tok = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });
const spans = () => [
  sp('S', null, 'session', { start: 0, end: 10000 }),
  sp('A', 'S', 'agent', { start: 0, end: 9000 }),
  sp('l1', 'A', 'llm', { tokens: tok(10, 5, 100, 20) }),
  sp('t1', 'A', 'tool'),
  sp('t2', 'A', 'tool', { status: 'error' }),
  sp('B', 'A', 'agent', { start: 3000, end: 5000 }),
  sp('l2', 'B', 'llm', { tokens: tok(1, 2, 3, 4) }),
  sp('l3', 'B', 'llm', { status: 'running', end: null, tokens: tok(99, 99) }),
  sp('X', 'S', 'agent', { external: true }),
];

test('hand-computed totals, subtree included, running llm adds no tokens', () => {
  const { total, byAgent } = computeTotals(spans());
  assert.deepEqual(total, { durationMs: 10000, input: 11, output: 7, cacheRead: 103, cacheWrite: 24,
    modelCalls: 3, toolCalls: 2, errors: 1, agents: 2, usd: null, basis: 'unknown', partial: false });
  assert.equal(byAgent.A.input, 11);
  assert.equal(byAgent.A.agents, 2);
  assert.equal(byAgent.B.input, 1);
  assert.equal(byAgent.B.modelCalls, 2);
  assert.equal(byAgent.B.durationMs, 2000);
  assert.equal(byAgent.X.agents, 0);
});

test('incremental upsert equals full recompute, in any arrival order', () => {
  const t = new TotalsTree();
  for (const s of [...spans()].reverse()) t.upsert(s);
  assert.deepEqual(t.snapshot(), computeTotals(spans()));
  // l3 finishes, t1 fails
  const l3 = sp('l3', 'B', 'llm', { tokens: tok(5, 6, 7, 8) });
  const t1 = sp('t1', 'A', 'tool', { status: 'error' });
  t.upsert(l3); t.upsert(t1);
  const next = spans().map((s) => (s.id === 'l3' ? l3 : s.id === 't1' ? t1 : s));
  assert.deepEqual(t.snapshot(), computeTotals(next));
  assert.equal(t.of('B').input, 6);
  assert.equal(t.of('S').errors, 2);
});

test('reparenting moves the subtree between ancestors', () => {
  const t = new TotalsTree();
  for (const s of spans()) t.upsert(s);
  const moved = sp('B', 'X', 'agent', { start: 3000, end: 5000 });
  t.upsert(moved);
  const next = spans().map((s) => (s.id === 'B' ? moved : s));
  assert.deepEqual(t.snapshot(), computeTotals(next));
  assert.equal(t.of('A').input, 10);
});

test('empty and running runs', () => {
  assert.deepEqual(computeTotals([]), { total: null, byAgent: {} });
  const r = computeTotals([sp('S', null, 'session', { end: null, status: 'running' })]);
  assert.equal(r.total.durationMs, null);
});
