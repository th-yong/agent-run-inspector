import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareGraph, hiddenAgents, foldedAgents } from '../web/graph.js';
import { cardInfo, callRows, toolLabel, statusKey } from '../web/card.js';

// Synthetic spans only.
const agent = (id, parentId, extra = {}) => ({ id, parentId, kind: 'agent', name: id, status: 'ok', start: 0, end: 10, ...extra });
const llm = (id, parentId, extra = {}) => ({ id, parentId, kind: 'llm', name: 'claude-sonnet-x', model: 'claude-sonnet-x', status: 'ok', start: 0, end: 1000, cost: { usd: 0.01, basis: 'priced' }, ...extra });
const tool = (id, parentId, extra = {}) => ({ id, parentId, kind: 'tool', name: 'Read', status: 'ok', start: 0, end: 500, toolCategory: 'file', ...extra });

test('prepareGraph counts only direct calls and sorts them by start', () => {
  const spans = [
    agent('a', null), agent('b', 'a'),
    llm('l2', 'a', { start: 20 }), llm('l1', 'a', { start: 10 }), tool('t1', 'a', { start: 15 }),
    llm('adv', 'l1'), llm('lb', 'b'),
  ];
  const g = prepareGraph(spans);
  assert.deepEqual(g.calls.get('a').map((c) => c.id), ['l1', 't1', 'l2']);
  assert.equal(g.agents.find((a) => a.id === 'a').callCount, 3);
  assert.equal(g.agents.find((a) => a.id === 'b').callCount, 1);
});

test('hideFinished keeps the root and finished agents that still have a running descendant', () => {
  const spans = [
    agent('r', null, { status: 'ok' }),
    agent('done', 'r'), agent('parentOfRunning', 'r'), agent('run', 'parentOfRunning', { status: 'running', end: null }),
    agent('deep', 'done'),
  ];
  const { agents } = prepareGraph(spans);
  assert.deepEqual([...hiddenAgents(agents, true)].sort(), ['deep', 'done']);
  assert.equal(hiddenAgents(agents, false).size, 0);
});

test('a selected agent is never hidden or folded; running agents and the root are not folded', () => {
  const spans = [agent('r', null), agent('a', 'r'), agent('b', 'r'), agent('c', 'r', { status: 'running', end: null })];
  const { agents } = prepareGraph(spans);
  assert.deepEqual([...foldedAgents(agents, new Set(), 'a')], ['b']);
  assert.deepEqual([...hiddenAgents(agents, true, 'a')], ['b']);
});

test('statusKey maps span status to the card state', () => {
  assert.equal(statusKey('running'), 'running');
  assert.equal(statusKey('ok'), 'done');
  assert.equal(statusKey('error'), 'failed');
  assert.equal(statusKey('cancelled'), 'cancelled');
  assert.equal(statusKey(undefined), 'unknown');
});

test('cardInfo: model from first real llm call, own cost sum, unknown cost is null', () => {
  const a = agent('a', null, { name: 'helper', task: 'do it', start: 1000, end: 5000 });
  const calls = [llm('x', 'a', { model: '<synthetic>' }), llm('y', 'a', { model: 'gpt-5', cost: { usd: 0.02, basis: 'priced' } }), llm('z', 'a', { cost: { usd: 0.03, basis: 'priced' } })];
  const info = cardInfo(a, calls, 9999);
  assert.equal(info.model, 'gpt-5');
  assert.equal(info.durationMs, 4000);
  assert.ok(Math.abs(info.usd - 0.06) < 1e-9);
  assert.equal(cardInfo(a, [llm('u', 'a', { cost: { usd: null, basis: 'unknown' } })], 9999).usd, null);
  assert.equal(cardInfo(agent('r', null, { status: 'running', start: 1000, end: null }), [], 4000).durationMs, 3000);
});

test('callRows: last N, earlier count, bars scale to the longest call, running is open-ended', () => {
  const calls = [1, 2, 3, 4, 5, 6, 7].map((i) => tool(`t${i}`, 'a', { start: i * 10, end: i * 10 + i * 100 }));
  calls.push(tool('run', 'a', { start: 100, end: null, status: 'running' }));
  calls.sort((x, y) => x.start - y.start);
  const rows = callRows(calls, 3);
  assert.equal(rows.length, 3);
  assert.equal(rows.at(-1).id, 'run');
  assert.equal(rows.at(-1).running, true);
  assert.equal(rows.at(-1).pct, 100);
  assert.ok(rows[0].pct <= 100 && rows[0].pct >= 8);
});

test('toolLabel: shell command, MCP names, plain names', () => {
  assert.equal(toolLabel(tool('t', 'a', { name: 'Bash', command: 'npm test' })), '$ npm test');
  assert.equal(toolLabel(tool('t', 'a', { name: 'mcp__github__create_issue' })), 'github · create_issue');
  assert.equal(toolLabel(tool('t', 'a', { name: 'Bash' })), 'Bash');
});
