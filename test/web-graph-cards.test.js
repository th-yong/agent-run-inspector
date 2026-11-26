import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareGraph, hiddenAgents, foldedAgents, ownTotals } from '../web/graph.js';
import { cardInfo, callRows, barPct, toolLabel, statusKey } from '../web/card.js';

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

test('barPct: log scale keeps short calls apart when one call is very long', () => {
  const max = 300_000;
  assert.equal(barPct(max, max), 100);
  assert.equal(barPct(50, max), 8);
  assert.ok(Math.abs(barPct(205, max) - 9) < 1);
  assert.ok(Math.abs(barPct(7_300, max) - 54) < 1);
  assert.ok(Math.abs(barPct(60_000, max) - 80) < 1);
  assert.equal(barPct(80, 80), 8);
});

test('toolLabel: shell command, MCP names, plain names', () => {
  assert.equal(toolLabel(tool('t', 'a', { name: 'Bash', command: 'npm test' })), '$ npm test');
  assert.equal(toolLabel(tool('t', 'a', { name: 'mcp__github__create_issue' })), 'github · create_issue');
  assert.equal(toolLabel(tool('t', 'a', { name: 'Bash' })), 'Bash');
});

test('a just-finished agent in `held` is neither hidden nor folded yet', () => {
  const spans = [agent('r', null), agent('a', 'r'), agent('b', 'r')];
  const { agents } = prepareGraph(spans);
  const held = new Set(['a']);
  assert.deepEqual([...foldedAgents(agents, new Set(), null, held)], ['b']);
  assert.deepEqual([...hiddenAgents(agents, true, null, held)], ['b']);
  assert.deepEqual([...foldedAgents(agents, new Set())].sort(), ['a', 'b']);
});

test('cardInfo: the root agent is named Orchestrator and keeps its model beside the name', () => {
  const root = agent('r', null, { name: 'claude-opus-x', model: 'claude-opus-x', role: 'orchestrator', depth: 0 });
  const info = cardInfo(root, [], 0);
  assert.equal(info.name, 'Orchestrator');
  assert.equal(info.model, 'claude-opus-x');
  const kid = cardInfo(agent('k', 'r', { name: 'helper', role: 'worker' }), [llm('x', 'k')], 0);
  assert.equal(kid.name, 'helper');
});

test('callRows: a compact card gets the short model-call label', () => {
  const rows = callRows([llm('x', 'a')], 3, true);
  assert.equal(rows[0].label, 'Model');
  assert.equal(callRows([llm('x', 'a')], 3)[0].label, 'Model response');
});

test("a card's count and cost come from the server's totals, minus its child agents' (old calls may be gone here)", () => {
  const agents = [agent('a', 's'), agent('b', 'a'), agent('c', 'b')];
  // The server's shape (src/model/totals.js): usd is null when nothing was priced; there is no count of priced calls.
  const t = (modelCalls, toolCalls, usd) => ({ modelCalls, toolCalls, usd, basis: usd == null ? 'unknown' : 'priced' });
  const own = ownTotals(agents, { a: t(10, 5, 3), b: t(4, 2, 1), c: t(1, 0, null) });
  assert.deepEqual([own.get('a').modelCalls, own.get('a').toolCalls, own.get('a').usd], [6, 3, 2]);
  assert.deepEqual([own.get('b').modelCalls, own.get('c').modelCalls], [3, 1]);
  const info = cardInfo(agent('b', 'a'), [], 100, own.get('b')); // its calls were trimmed in the browser
  assert.deepEqual([info.callCount, info.usd], [5, 1]);
  assert.equal(cardInfo(agent('c', 'b'), [], 100, own.get('c')).usd, null, 'nothing priced: no cost');
  assert.equal(ownTotals(agents, undefined).size, 0);
});
