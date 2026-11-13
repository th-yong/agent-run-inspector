import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollValue, ROLL_MS, scopeOf, runningAgents, costBasis, stripValues, firstStart } from '../web/run-header.js';

test('rollValue runs from the old to the new number in 250ms and never overshoots', () => {
  assert.equal(ROLL_MS, 250);
  assert.equal(rollValue(10, 20, 0), 10);
  assert.equal(rollValue(10, 20, 250), 20);
  assert.equal(rollValue(10, 20, 900), 20);
  let prev = 10;
  for (let t = 0; t <= 250; t += 25) {
    const v = rollValue(10, 20, t);
    assert.ok(v >= prev && v <= 20, `t=${t} v=${v}`);
    prev = v;
  }
  assert.ok(rollValue(10, 20, 125) > 15, 'ease-out is past halfway at half time');
});

test('rollValue also rolls down and jumps straight when a side is unknown', () => {
  assert.equal(rollValue(20, 10, 250), 10);
  assert.ok(rollValue(20, 10, 100) < 20);
  assert.equal(rollValue(null, 5, 10), 5);
  assert.equal(rollValue(5, null, 10), null);
  assert.equal(rollValue(5, 5, 10), 5);
});

const totals = {
  total: { agents: 3, modelCalls: 4, toolCalls: 6, errors: 1, input: 100, output: 50, cacheRead: 900, cacheWrite: 0, durationMs: null, usd: 1.5, basis: 'priced', partial: false },
  byAgent: { a1: { agents: 1, modelCalls: 1, toolCalls: 2, errors: 0, input: 10, output: 5, cacheRead: 0, cacheWrite: 0, durationMs: 4000, usd: 0.1, basis: 'reported', partial: false } },
};
const spans = [
  { id: 's', kind: 'session', status: 'running', name: 'x' },
  { id: 'a0', kind: 'agent', status: 'running', name: 'main' },
  { id: 'a1', kind: 'agent', status: 'ok', name: 'reviewer' },
  { id: 'a2', kind: 'agent', status: 'running', name: 'ext', external: true },
  { id: 'a3', kind: 'agent', status: 'running', name: 'worker' },
  { id: 'l1', kind: 'llm', status: 'running', name: 'm' },
];

test('scopeOf picks an agent only when its totals exist', () => {
  assert.deepEqual(scopeOf(totals, spans, 'a1'), { id: 'a1', name: 'reviewer', t: totals.byAgent.a1 });
  assert.deepEqual(scopeOf(totals, spans, null), { id: null, name: null, t: totals.total });
  assert.equal(scopeOf(totals, spans, 'nope').id, null);
  assert.equal(scopeOf(null, spans, 'a1').t, null);
});

test('runningAgents counts running agent spans, not external nodes or calls', () => {
  assert.equal(runningAgents(spans), 2);
  assert.equal(runningAgents([]), 0);
});

test('costBasis maps the server basis to a label and flags partial sums', () => {
  assert.deepEqual(costBasis({ usd: 1, basis: 'reported', partial: false }), { key: 'reported', partial: false });
  assert.deepEqual(costBasis({ usd: 1, basis: 'priced', partial: true }), { key: 'priced', partial: true });
  assert.deepEqual(costBasis({ usd: null, basis: 'unknown', partial: false }), { key: 'unknown', partial: false });
  assert.deepEqual(costBasis(null), { key: 'unknown', partial: false });
});

test('stripValues gathers the strip numbers; unknown stays null', () => {
  const v = stripValues(totals.total);
  assert.deepEqual(v, { usd: 1.5, tokens: 150, cached: 900, modelCalls: 4, toolCalls: 6, errors: 1 });
  assert.deepEqual(stripValues(null), { usd: null, tokens: null, cached: null, modelCalls: null, toolCalls: null, errors: null });
});

test('firstStart: earliest known start, null when there is none', () => {
  assert.equal(firstStart([{ start: 30 }, { start: 10 }, { start: null }, {}]), 10);
  assert.equal(firstStart([]), null);
  assert.equal(firstStart(undefined), null);
});
