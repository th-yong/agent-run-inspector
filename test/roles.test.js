import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { applyRoles } from '../src/model/roles.js';
import { createIndex } from '../src/index/index.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const mk = (extra = {}) => createIndex({
  roots: { claude: [{ path: join(FIX, 'claude-code/projects') }], codex: [{ path: join(FIX, 'codex/sessions') }] },
  now: () => Date.parse('2026-12-01T00:00:00Z'),
  ...extra,
});
const A1 = '00000000-0000-4000-8000-0000000000a1';
const CX3 = 'cx:00000000-0000-4000-8000-000000000003';
const roles = (spans) => spans.filter((s) => s.kind === 'agent').map((s) => `${s.name}:${s.role}`);

test('applyRoles: root orchestrator, others worker, no watcher by default', () => {
  const spans = [{ kind: 'agent', name: 'a', depth: 0 }, { kind: 'agent', name: 'b', depth: 1 }, { kind: 'llm', name: 'x' }];
  applyRoles(spans);
  assert.deepEqual(spans.map((s) => s.role), ['orchestrator', 'worker', undefined]);
});

test('applyRoles: patterns are case-insensitive globs over the whole name', () => {
  const spans = [{ kind: 'agent', name: 'Code-Watcher', depth: 1 }, { kind: 'agent', name: 'watcher-2', depth: 1 }, { kind: 'agent', name: 'my watcher x', depth: 1 }, { kind: 'agent', name: 'a.b', depth: 1 }];
  applyRoles(spans, ['*-watcher', 'WATCHER-?', 'a.b']);
  assert.deepEqual(spans.map((s) => s.role), ['watcher', 'worker', 'worker', 'watcher']);
});

test('index default config: no watcher in any fixture session', () => {
  const ix = mk();
  ix.list();
  for (const id of [A1, CX3]) assert.ok(!ix.open(id).spans.some((s) => s.role === 'watcher'));
  assert.deepEqual(roles(ix.open(A1).spans), ['synthetic-model-a:orchestrator', 'helper-one:worker', 'helper-two:worker', 'mate:worker', 'grandchild:worker']);
  assert.equal(roles(ix.open(CX3).spans)[0], 'gpt-5.5:orchestrator');
});

test('index with watcherNamePatterns: matching agents become watchers', () => {
  const ix = mk({ watcherNamePatterns: ['helper-*', 'Ada'] });
  ix.list();
  assert.deepEqual(roles(ix.open(A1).spans).filter((r) => r.endsWith('watcher')), ['helper-one:watcher', 'helper-two:watcher']);
  assert.ok(roles(ix.open(CX3).spans).includes('Ada:watcher'));
});
