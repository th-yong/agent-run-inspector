import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanGroups, createGroupStore } from '../src/groups.js';

test('cleanGroups: trims names, keeps a session in its first group, refuses bad shapes', () => {
  assert.deepEqual(cleanGroups({ groups: [{ id: 'a', name: ' A ', sessions: ['s1'] }, { id: 'b', name: 'B', sessions: ['s1', 's2'] }] }),
    { groups: [{ id: 'a', name: 'A', sessions: ['s1'] }, { id: 'b', name: 'B', sessions: ['s2'] }] });
  for (const bad of [null, {}, { groups: [{ id: 'a', name: '', sessions: [] }] }, { groups: [{ id: 'a', name: 'x', sessions: [1] }] },
    { groups: [{ id: 'a', name: 'x', sessions: [] }, { id: 'a', name: 'y', sessions: [] }] }]) assert.equal(cleanGroups(bad), null);
});

test('createGroupStore writes groups.json (0600) and reads it back', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ari-groups-')), 'sub', 'groups.json');
  const doc = { groups: [{ id: 'g', name: 'G', sessions: ['x'] }] };
  assert.deepEqual(createGroupStore({ file }).set(doc), doc);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), doc);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(createGroupStore({ file }).get(), doc);
});
