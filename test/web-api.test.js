import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpan, upsertSession } from '../web/api.js';

test('mergeSpan keeps the newer seq and ignores stale or repeated events', () => {
  const spans = new Map();
  assert.equal(mergeSpan(spans, { id: 'a', seq: 5, name: 'new' }), true);
  assert.equal(mergeSpan(spans, { id: 'a', seq: 4, name: 'old' }), false);
  assert.equal(mergeSpan(spans, { id: 'a', seq: 5, name: 'dup' }), false);
  assert.equal(spans.get('a').name, 'new');
  assert.equal(mergeSpan(spans, { id: 'a', seq: 6, name: 'newer' }), true);
  assert.equal(spans.get('a').name, 'newer');
});

test('upsertSession replaces by id or appends', () => {
  const list = [{ id: 'a', title: '1' }];
  assert.deepEqual(upsertSession(list, { id: 'a', title: '2' }), [{ id: 'a', title: '2' }]);
  assert.deepEqual(upsertSession(list, { id: 'b' }).map((s) => s.id), ['a', 'b']);
  assert.equal(list[0].title, '1');
});
