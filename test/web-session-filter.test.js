import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSessions, groupSessions, widerPeriod, providerSlugs, fmtStart, periodStart } from '../web/session-list.js';

const NOW = new Date(2026, 10, 13, 15, 0, 0).getTime();
const H = 3600 * 1000;
const D = 24 * H;
const mk = (id, o = {}) => ({ id, source: 'claude-code', title: `t-${id}`, project: 'demo', status: 'ok', lastWrite: NOW - H, start: NOW - 2 * H, ...o });
const SESSIONS = [
  mk('a', { title: 'Fix login', project: 'web-app' }),
  mk('b', { source: 'codex', title: 'Refactor api', project: 'server', lastWrite: NOW - 3 * D }),
  mk('c', { title: 'Old thing', project: 'web-app', lastWrite: NOW - 20 * D }),
  mk('d', { source: 'codex', title: 'Ancient', project: 'tools', lastWrite: NOW - 90 * D }),
  mk('e', { title: 'Live one', project: 'server', status: 'running', lastWrite: NOW - 80 * D }),
];
const ids = (l) => l.map((s) => s.id).sort().join('');

test('period filter keeps running sessions and cuts by last write', () => {
  assert.equal(ids(filterSessions(SESSIONS, { period: 'today' }, NOW)), 'ae');
  assert.equal(ids(filterSessions(SESSIONS, { period: '7d' }, NOW)), 'abe');
  assert.equal(ids(filterSessions(SESSIONS, { period: '30d' }, NOW)), 'abce');
  assert.equal(ids(filterSessions(SESSIONS, { period: 'all' }, NOW)), 'abcde');
});

test('source filter and search combine with the period', () => {
  assert.equal(ids(filterSessions(SESSIONS, { source: 'codex' }, NOW)), 'bd');
  assert.equal(ids(filterSessions(SESSIONS, { source: 'codex', period: '7d' }, NOW)), 'b');
  assert.equal(ids(filterSessions(SESSIONS, { query: 'WEB' }, NOW)), 'ac');
  assert.equal(ids(filterSessions(SESSIONS, { query: 'web', period: '7d' }, NOW)), 'a');
  assert.equal(ids(filterSessions(SESSIONS, { query: 'web', source: 'codex' }, NOW)), '');
  assert.equal(ids(filterSessions(SESSIONS, { query: '  fix  ' }, NOW)), 'a');
  assert.equal(ids(filterSessions(SESSIONS, { query: 'tools' }, NOW)), 'd');
});

test('a session without a title or project does not break search', () => {
  const list = [{ id: 'x', source: 'codex', status: 'ok', lastWrite: NOW }];
  assert.equal(filterSessions(list, { query: 'undefined' }, NOW).length, 0);
  assert.equal(filterSessions(list, { query: '' }, NOW).length, 1);
});

test('groupSessions pins running first and sorts newest first', () => {
  const g = groupSessions(SESSIONS);
  assert.deepEqual(g.running.map((s) => s.id), ['e']);
  assert.deepEqual(g.recent.map((s) => s.id), ['a', 'b', 'c', 'd']);
});

test('widerPeriod steps outward and stops at all', () => {
  assert.equal(widerPeriod('today'), '7d');
  assert.equal(widerPeriod('7d'), '30d');
  assert.equal(widerPeriod('30d'), 'all');
  assert.equal(widerPeriod('all'), null);
});

test('periodStart today is local midnight', () => {
  assert.equal(periodStart('today', NOW), new Date(2026, 10, 13).getTime());
  assert.equal(periodStart('all', NOW), 0);
});

test('providerSlugs lists distinct known providers and skips unknown ones', () => {
  assert.deepEqual(providerSlugs(['claude-opus-4', 'claude-haiku-4', 'gpt-5']), ['claude', 'openai']);
  assert.deepEqual(providerSlugs(['gemini-2.5-pro', 'mystery-model']), ['googlegemini']);
  assert.deepEqual(providerSlugs(undefined), []);
  assert.deepEqual(providerSlugs([null, 3]), []);
});

test('fmtStart shows time today and date otherwise', () => {
  assert.equal(fmtStart(new Date(2026, 10, 13, 9, 5).getTime(), NOW), '09:05');
  assert.equal(fmtStart(new Date(2026, 2, 3, 11, 0).getTime(), NOW), 'Mar 3 11:00');
  assert.equal(fmtStart(0, NOW), '—');
});
