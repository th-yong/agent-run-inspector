import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtAgo, nowOf, pickAgents } from '../web/mini.js';

const a = (name, status, now = null, nowStart = 0) => ({ name, status, now, nowStart, depth: 1 });

test('pickAgents: running agents first, then the latest finished ones, the rest counted', () => {
  const r = pickAgents([a('main', 'running'), a('d1', 'ok'), a('d2', 'ok'), a('w', 'running'), a('d3', 'error'), a('d4', 'ok')], 4);
  assert.deepEqual(r.shown.map((x) => x.name), ['main', 'w', 'd4', 'd3']);
  assert.equal(r.done, 4);
  assert.equal(r.more, 2);
});

test('nowOf: the newest running tool call; waiting when it asks the user; thinking without a tool', () => {
  assert.equal(nowOf([a('m', 'running', 'Read', 1), a('w', 'running', 'Bash', 5), a('x', 'ok', 'Edit', 9)]).tool, 'Bash');
  assert.equal(nowOf([a('m', 'running', 'AskUserQuestion', 3)]).waiting, true);
  assert.deepEqual(nowOf([a('m', 'running')]).tool, null);
  assert.equal(nowOf([{ ...a('m', 'running'), depth: 0 }, a('w', 'running')]).agent.name, 'w'); // not the waiting orchestrator
  assert.equal(nowOf([a('m', 'ok')]), null);
});

test('fmtAgo: now, seconds, minutes, hours', () => {
  assert.deepEqual([2e3, 40e3, 300e3, 7200e3].map(fmtAgo), ['now', '40s ago', '5m ago', '2h ago']);
});
