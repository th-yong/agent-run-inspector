import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, niceStep, ticksFor, fmtTick, boxOf, timelineRows, callsByAgent } from '../web/timeline-scale.js';

const ag = (id, parentId, start, end, extra = {}) => ({ id, parentId, kind: 'agent', status: end == null ? 'running' : 'ok', start, end, ...extra });
const call = (id, parentId, kind, start, end, extra = {}) => ({ id, parentId, kind, status: end == null ? 'running' : 'ok', start, end, ...extra });

test('domainOf spans from the earliest start to the latest end, running ones reach now', () => {
  const spans = [ag('a', null, 1000, 9000), call('c1', 'a', 'llm', 2000, null)];
  assert.deepEqual(domainOf(spans, 12000), { t0: 1000, t1: 12000 });
  assert.deepEqual(domainOf([ag('a', null, 1000, 9000)], 50000), { t0: 1000, t1: 9000 });
});

test('domainOf is never empty', () => {
  assert.deepEqual(domainOf([], 5000), { t0: 5000, t1: 6000 });
  const d = domainOf([ag('a', null, 1000, 1000)], 9);
  assert.ok(d.t1 > d.t0);
});

test('domainOf ignores spans without a start and session spans', () => {
  const spans = [{ id: 's', kind: 'session', start: 0, end: 99999 }, { id: 'x', kind: 'llm', start: NaN, end: 5 }, ag('a', null, 1000, 3000)];
  assert.deepEqual(domainOf(spans, 10), { t0: 1000, t1: 3000 });
});

test('niceStep picks a round step giving at most the wanted tick count', () => {
  assert.equal(niceStep(10_000, 6), 2000);
  assert.equal(niceStep(600_000, 6), 120_000);
  assert.equal(niceStep(3_700_000, 6), 900_000);
  assert.equal(niceStep(500, 5), 100);
  assert.ok(niceStep(1e9, 6) >= 1e9 / 6);
});

test('ticksFor lists offsets from 0 with positions in percent', () => {
  const t = ticksFor({ t0: 100, t1: 100 + 600_000 }, 6);
  assert.equal(t[0].ms, 0);
  assert.equal(t[0].pct, 0);
  assert.equal(t[1].ms, 120_000);
  assert.equal(t[1].pct, 20);
  assert.ok(t.every((x) => x.pct <= 100));
  assert.equal(t[1].label, '2m');
});

test('fmtTick labels', () => {
  assert.equal(fmtTick(0, 1000), '0');
  assert.equal(fmtTick(500, 100), '500ms');
  assert.equal(fmtTick(2000, 1000), '2s');
  assert.equal(fmtTick(90_000, 30_000), '1m 30s');
  assert.equal(fmtTick(120_000, 120_000), '2m');
  assert.equal(fmtTick(3_600_000, 900_000), '1h');
  assert.equal(fmtTick(5_400_000, 900_000), '1h 30m');
});

test('boxOf gives percent left and width; running bars are open-ended', () => {
  const d = { t0: 0, t1: 1000 };
  assert.deepEqual(boxOf(call('c', 'a', 'llm', 250, 750), d, 1000), { left: 25, width: 50, open: false });
  assert.deepEqual(boxOf(call('c', 'a', 'llm', 500, null), d, 800), { left: 50, width: 30, open: true });
  const b = boxOf(call('c', 'a', 'tool', 2000, 3000), d, 1000);
  assert.ok(b.left <= 100 && b.left + b.width <= 100);
  const early = boxOf(call('c', 'a', 'tool', -50, 100), d, 1000);
  assert.equal(early.left, 0);
});

test('callsByAgent groups llm and tool spans by parent in time order', () => {
  const spans = [ag('a', null, 0, 10), call('t', 'a', 'tool', 5, 6), call('l', 'a', 'llm', 1, 4), call('x', 'b', 'llm', 1, 2)];
  const m = callsByAgent(spans);
  assert.deepEqual(m.get('a').map((c) => c.id), ['l', 't']);
  assert.deepEqual(m.get('b').map((c) => c.id), ['x']);
});

test('timelineRows: sub-agents first, then own calls; collapsed agents show only the row', () => {
  const spans = [
    ag('m', null, 0, 100), ag('w', 'm', 10, 50), ag('v', 'm', 5, 20),
    call('c1', 'm', 'llm', 1, 2), call('c2', 'm', 'tool', 3, 4), call('w1', 'w', 'llm', 11, 12),
  ];
  const ids = (rows) => rows.map((r) => `${r.type}:${r.span.id}:${r.depth}`);
  assert.deepEqual(ids(timelineRows(spans, new Set())), ['agent:m:0']);
  assert.deepEqual(ids(timelineRows(spans, new Set(['m']))), ['agent:m:0', 'agent:v:1', 'agent:w:1', 'call:c1:1', 'call:c2:1']);
  assert.deepEqual(ids(timelineRows(spans, new Set(['m', 'w']))), ['agent:m:0', 'agent:v:1', 'agent:w:1', 'call:w1:2', 'call:c1:1', 'call:c2:1']);
});

test('timelineRows survives parent loops and unknown parents', () => {
  const spans = [ag('a', 'b', 0, 1), ag('b', 'a', 0, 1), ag('o', 'gone', 0, 1)];
  const rows = timelineRows(spans, new Set(['a', 'b', 'o']));
  assert.equal(new Set(rows.map((r) => r.span.id)).size, rows.length);
  assert.ok(rows.some((r) => r.span.id === 'o'));
});

test('a running span in a quiet log stops at its last activity', () => {
  const stale = call('c', 'a', 'tool', 1000, null, { lastActivity: 4000 });
  assert.deepEqual(domainOf([ag('a', null, 1000, 3000), stale], 10 * 60_000), { t0: 1000, t1: 4000 });
  assert.deepEqual(boxOf(stale, { t0: 1000, t1: 4000 }, 10 * 60_000), { left: 0, width: 100, open: true });
  const live = call('c', 'a', 'tool', 1000, null, { lastActivity: 9000 });
  assert.equal(domainOf([live], 10_000).t1, 10_000);
});
