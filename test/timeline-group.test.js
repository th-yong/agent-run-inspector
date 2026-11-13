import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCalls, foldCalls, FOLD_LIMIT } from '../web/timeline-group.js';
import { timelineRows } from '../web/timeline-scale.js';

const call = (id, kind, start, extra = {}) => ({ id, parentId: 'a', kind, status: 'ok', start, end: start + 1, name: kind === 'llm' ? 'm' : 'Bash', ...extra });
const agent = { id: 'a', parentId: null, kind: 'agent', status: 'ok', start: 0, end: 5000 };
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test('summarizeCalls counts kinds and errors', () => {
  const s = summarizeCalls([call('1', 'llm', 0), call('2', 'tool', 1), call('3', 'tool', 2, { status: 'error' })]);
  assert.deepEqual(s, { total: 3, llm: 1, tool: 2, error: 1 });
  assert.deepEqual(summarizeCalls([]), { total: 0, llm: 0, tool: 0, error: 0 });
});

test('foldCalls leaves up to the limit alone', () => {
  const calls = many(FOLD_LIMIT, (i) => call(`t${i}`, 'tool', i));
  const items = foldCalls(calls);
  assert.equal(items.length, FOLD_LIMIT);
  assert.ok(items.every((x) => x.type === 'call'));
});

test('foldCalls folds consecutive same-tool calls above the limit', () => {
  const calls = [
    ...many(150, (i) => call(`b${i}`, 'tool', i)),
    call('l1', 'llm', 150),
    ...many(60, (i) => call(`r${i}`, 'tool', 151 + i, { name: 'Read' })),
  ];
  const items = foldCalls(calls);
  assert.deepEqual(items.map((x) => x.type), ['run', 'call', 'run']);
  assert.equal(items[0].count, 150);
  assert.equal(items[0].key, 'run:b0');
  assert.equal(items[0].name, 'Bash');
  assert.equal(items[0].start, 0);
  assert.equal(items[0].end, 150);
  assert.equal(items[2].name, 'Read');
});

test('foldCalls keeps errors, running calls and single calls as their own rows', () => {
  const calls = [
    ...many(100, (i) => call(`a${i}`, 'tool', i)),
    call('e', 'tool', 100, { status: 'error' }),
    ...many(100, (i) => call(`c${i}`, 'tool', 101 + i)),
    call('run', 'tool', 201, { end: null, status: 'running' }),
    call('one', 'tool', 202, { name: 'Edit' }),
  ];
  const items = foldCalls(calls);
  assert.deepEqual(items.map((x) => (x.type === 'run' ? `run${x.count}` : x.span.id)), ['run100', 'e', 'run100', 'run', 'one']);
});

test('timelineRows: sub-agents, then a collapsed Calls group, then call rows when it is open', () => {
  const spans = [agent, { ...agent, id: 'w', parentId: 'a', start: 1 }, call('c1', 'llm', 1), call('c2', 'tool', 2)];
  const ids = (rows) => rows.map((r) => `${r.type}:${r.key ?? r.span.id}:${r.depth}`);
  assert.deepEqual(ids(timelineRows(spans, new Set(['a']))), ['agent:a:0', 'agent:w:1', 'group:calls:a:1']);
  assert.deepEqual(ids(timelineRows(spans, new Set(['a', 'calls:a']))), ['agent:a:0', 'agent:w:1', 'group:calls:a:1', 'call:c1:2', 'call:c2:2']);
  assert.equal(timelineRows(spans, new Set(['a']))[2].summary.total, 2);
});

test('timelineRows opens a folded run on its own key', () => {
  const calls = many(300, (i) => call(`b${i}`, 'tool', i));
  const rows = timelineRows([agent, ...calls], new Set(['a', 'calls:a']));
  assert.deepEqual(rows.map((r) => r.type), ['agent', 'group', 'run']);
  const open = timelineRows([agent, ...calls], new Set(['a', 'calls:a', 'run:b0']));
  assert.equal(open.length, 3 + 300);
  assert.equal(open[3].type, 'call');
  assert.equal(open[3].depth, 3);
});
