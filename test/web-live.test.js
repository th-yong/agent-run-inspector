import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearBottom, freshCalls, liveState, createFlushGate } from '../web/live-follow.js';
import { trimSpans, MAX_CALLS } from '../web/api.js';

test('nearBottom is true within the slack of the end', () => {
  assert.equal(nearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 }), true);
  assert.equal(nearBottom({ scrollTop: 480, clientHeight: 500, scrollHeight: 1000 }), true);
  assert.equal(nearBottom({ scrollTop: 100, clientHeight: 500, scrollHeight: 1000 }), false);
});

test('freshCalls lists call ids not seen before and ignores agents', () => {
  const known = new Set(['a']);
  const spans = [{ id: 'a', kind: 'llm' }, { id: 'b', kind: 'tool' }, { id: 'c', kind: 'agent' }, { id: 'd', kind: 'llm' }];
  assert.deepEqual(freshCalls(known, spans), ['b', 'd']);
  assert.deepEqual([...known].sort(), ['a', 'b', 'd']);
  assert.deepEqual(freshCalls(known, spans), []);
});

test('liveState: connected only when every stream is connected', () => {
  assert.equal(liveState({ list: 'connected', run: 'connected' }), 'connected');
  assert.equal(liveState({ list: 'connected' }), 'connected');
  assert.equal(liveState({ list: 'connected', run: 'reconnecting' }), 'reconnecting');
  assert.equal(liveState({ list: 'reconnecting', run: 'connected' }), 'reconnecting');
  assert.equal(liveState({}), 'connecting');
});

test('flush gate runs now while visible and once on return when hidden', () => {
  let hidden = false; let n = 0;
  const gate = createFlushGate(() => hidden, () => n++);
  gate.request(); gate.request();
  assert.equal(n, 2);
  hidden = true;
  gate.request(); gate.request(); gate.request();
  assert.equal(n, 2);
  hidden = false;
  gate.resume();
  assert.equal(n, 3);
  gate.resume();
  assert.equal(n, 3);
});

test('trimSpans drops the oldest finished calls over the cap and keeps agents and running calls', () => {
  assert.ok(MAX_CALLS >= 1000);
  const m = new Map();
  m.set('ag', { id: 'ag', kind: 'agent', start: 0, end: null });
  m.set('run', { id: 'run', kind: 'tool', start: 1, end: null });
  for (let i = 0; i < 10; i++) m.set(`c${i}`, { id: `c${i}`, kind: i % 2 ? 'llm' : 'tool', start: 10 + i, end: 20 + i });
  assert.equal(trimSpans(m, 100), 0);
  assert.equal(trimSpans(m, 5), 6);
  assert.deepEqual([...m.keys()].sort(), ['ag', 'c6', 'c7', 'c8', 'c9', 'run']);
});
