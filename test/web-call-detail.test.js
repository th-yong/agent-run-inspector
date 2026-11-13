import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewView, tokenRows, costView, sourceRefText, clockText } from '../web/call-detail.js';
import { agentCalls } from '../web/agent-panel.js';

// Synthetic values only.
test('previewView: text, cut text, hidden and missing previews', () => {
  assert.deepEqual(previewView(null), { kind: 'none' });
  assert.deepEqual(previewView({ text: 'hi', length: 2, truncated: false }), { kind: 'text', text: 'hi', length: 2, truncated: false, keys: null });
  assert.equal(previewView({ text: 'hi', length: 9000, truncated: true, keys: ['a'] }).truncated, true);
  assert.deepEqual(previewView({ hidden: true, length: 12, keys: ['command'] }), { kind: 'hidden', length: 12, keys: ['command'] });
  assert.deepEqual(previewView({ hidden: true, length: 5 }), { kind: 'hidden', length: 5, keys: null });
});

test('tokenRows lists the five kinds and shows unknown as a dash', () => {
  const rows = tokenRows({ input: 1200, output: 340, cacheRead: 5000 });
  assert.deepEqual(rows.map((r) => r.label), ['Input', 'Output', 'Cache read', 'Cache write', 'Reasoning']);
  assert.deepEqual(rows.map((r) => r.value), ['1.2k', '340', '5.0k', '—', '—']);
  assert.equal(tokenRows(undefined).every((r) => r.value === '—'), true);
});

test('costView names the basis', () => {
  assert.deepEqual(costView({ usd: 0.0123, basis: 'priced' }), { text: '$0.0123', basis: 'Priced' });
  assert.deepEqual(costView({ usd: 1.5, basis: 'reported' }), { text: '$1.50', basis: 'Reported' });
  assert.deepEqual(costView({ usd: null, basis: 'unknown' }), { text: '—', basis: '—' });
  assert.deepEqual(costView(undefined), { text: '—', basis: '—' });
});

test('sourceRefText joins file name and line', () => {
  assert.equal(sourceRefText({ file: 'agent-x.jsonl', line: 42 }), 'agent-x.jsonl:42');
  assert.equal(sourceRefText({ file: 'agent-x.jsonl', line: null }), 'agent-x.jsonl');
  assert.equal(sourceRefText({ file: null, line: 3 }), null);
  assert.equal(sourceRefText(undefined), null);
});

test('clockText is HH:MM:SS.mmm in local time and a dash for unknown', () => {
  const d = new Date(2026, 10, 13, 14, 2, 5, 70);
  assert.equal(clockText(d.getTime()), '14:02:05.070');
  assert.equal(clockText(null), '—');
});

test('agentCalls: only the agent\'s own llm/tool calls, newest first', () => {
  const spans = [
    { id: 'a', kind: 'agent', parentId: null, start: 0 },
    { id: 'b', kind: 'agent', parentId: 'a', start: 5 },
    { id: 'l1', kind: 'llm', parentId: 'a', start: 10 },
    { id: 't1', kind: 'tool', parentId: 'a', start: 20 },
    { id: 'l2', kind: 'llm', parentId: 'a', start: 30 },
    { id: 'x', kind: 'llm', parentId: 'b', start: 40 },
    { id: 'adv', kind: 'llm', parentId: 'l1', start: 12 },
  ];
  assert.deepEqual(agentCalls(spans, 'a').map((c) => c.id), ['l2', 't1', 'l1']);
  assert.deepEqual(agentCalls(spans, 'zzz'), []);
});
