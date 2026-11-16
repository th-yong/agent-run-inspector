import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assign, groupOf, newGroupId } from '../web/groups.js';
import { bySection } from '../web/mini.js';
import { filterSessions } from '../web/session-list.js';

const G = [{ id: 'a', name: 'A', sessions: ['s1'] }, { id: 'b', name: 'B', sessions: ['s2'] }];

test('assign moves a session to one group or out of all; groupOf finds it', () => {
  const moved = assign(G, 's1', 'b');
  assert.deepEqual(moved.map((g) => g.sessions), [[], ['s2', 's1']]);
  assert.equal(groupOf(moved, 's1').id, 'b');
  assert.equal(groupOf(assign(G, 's1', null), 's1'), null);
});

test('newGroupId: slug of the name, unique', () => {
  assert.equal(newGroupId(G, 'Shop API!'), 'shop-api');
  assert.equal(newGroupId(G, 'a'), 'a-2');
  assert.equal(newGroupId(G, '블로그'), 'group');
});

test('bySection: groups in order, then the ungrouped ones; empty groups left out', () => {
  const s = (id) => ({ id });
  const out = bySection([s('s2'), s('s9'), s('s1')], [...G, { id: 'c', name: 'C', sessions: [] }]);
  assert.deepEqual(out.map((p) => [p.group?.id ?? null, p.sessions.map((x) => x.id)]), [['a', ['s1']], ['b', ['s2']], [null, ['s9']]]);
});

test('filterSessions: `only` keeps the sessions of a group, running ones included', () => {
  const list = [{ id: 's1', status: 'running' }, { id: 's2', status: 'ok' }];
  assert.deepEqual(filterSessions(list, { only: new Set(['s2']) }).map((x) => x.id), ['s2']);
});
