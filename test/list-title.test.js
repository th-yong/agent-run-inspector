import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndex } from '../src/index/index.js';
import { HEAD_BYTES, TAIL_BYTES, TITLE_SCAN_BYTES } from '../src/index/scan.js';

const ID = '00000000-0000-4000-8000-0000000071e1';
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const big = (n, i) => ({ type: 'user', sessionId: ID, timestamp: new Date(1e12 + i).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x'.repeat(n) }] } });

function listTitle(rows) {
  const root = mkdtempSync(join(tmpdir(), 'ari-title-'));
  mkdirSync(join(root, '-p'));
  writeFileSync(join(root, '-p', `${ID}.jsonl`), jl(rows));
  return createIndex({ roots: { claude: [{ path: root }] }, source: 'claude' }).list()[0].title;
}

test('list title: found when long tool output pushes it out of the head and tail windows', () => {
  const pad = HEAD_BYTES + TAIL_BYTES;
  const rows = [
    { type: 'user', sessionId: ID, cwd: '/p', timestamp: new Date(1e12).toISOString(), message: { role: 'user', content: 'go' } },
    big(pad, 1),
    { type: 'ai-title', aiTitle: 'Old title', sessionId: ID },
    big(pad, 2),
    { type: 'ai-title', aiTitle: 'Git pull 작업', sessionId: ID },
    big(TAIL_BYTES * 2, 3), // the newest title is beyond the tail window
  ];
  assert.equal(listTitle(rows), 'Git pull 작업');
});

test('list title: text that only mentions ai-title is not a title; too far from the end stays untitled', () => {
  const mention = { type: 'user', sessionId: ID, timestamp: new Date(1e12).toISOString(), message: { role: 'user', content: 'the "type":"ai-title" record' } };
  assert.equal(listTitle([mention, big(HEAD_BYTES + TAIL_BYTES, 1), mention, big(TAIL_BYTES * 2, 2)]), undefined);
  assert.equal(listTitle([mention, big(HEAD_BYTES * 2, 1), { type: 'ai-title', aiTitle: 'Far', sessionId: ID }, big(TITLE_SCAN_BYTES + TAIL_BYTES, 2)]), undefined);
});
