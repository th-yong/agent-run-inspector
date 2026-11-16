import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPricer, loadPrices, applyCosts, reportedUsdOf } from '../src/cost.js';
import { computeTotals } from '../src/model/totals.js';
import { createIndex } from '../src/index/index.js';

const table = {
  models: {
    'm-a': { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2 },
    'm-a-big': { input: 5, output: 50, cacheRead: 0.5, cacheWrite: 6 },
    'm-nocache': { input: 1, output: 2, cacheRead: null, cacheWrite: null },
  },
};
const tok = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });
const llm = (id, parentId, model, tokens, extra = {}) => ({ id, parentId, kind: 'llm', status: 'ok', start: 1, end: 2, model, tokens, ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('priced: exact match, hand-computed per 1M tokens', () => {
  const p = createPricer(table);
  const c = p.cost('m-a', tok(1_000_000, 100_000, 2_000_000, 500_000));
  near(c.usd, 1 + 1 + 0.2 + 1);
  assert.equal(c.basis, 'priced');
});

test('prefix: longest wins, only dated/suffix snapshots; sibling models do not match', () => {
  const p = createPricer(table);
  assert.equal(p.find('m-a-big-20260101')?.input, 5);
  assert.equal(p.find('m-a-20260101')?.input, 1);
  assert.equal(p.find('m-a[1m]')?.input, 1);
  assert.equal(p.find('m-a-mini'), null); // not a snapshot of m-a
  assert.equal(p.find('m-a-bigger'), null);
});

test('unknown model or missing rate for used tokens: usd null', () => {
  const p = createPricer(table);
  assert.deepEqual(p.cost('nope', tok(1, 1)), { usd: null, basis: 'unknown' });
  assert.deepEqual(p.cost(undefined, tok(1, 1)), { usd: null, basis: 'unknown' });
  assert.deepEqual(p.cost('<synthetic>', tok(1, 1)), { usd: null, basis: 'unknown' });
  assert.deepEqual(p.cost('m-nocache', tok(1, 1, 5)), { usd: null, basis: 'unknown' });
  assert.equal(p.cost('m-nocache', tok(1_000_000, 0)).usd, 1); // rate missing but unused tokens
});

test('overrides merge field by field and add models', () => {
  const p = createPricer(table, { 'm-a': { output: 20 }, 'm-new': { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 } });
  assert.equal(p.find('m-a').output, 20);
  assert.equal(p.find('m-a').input, 1);
  near(p.cost('m-new', tok(1_000_000, 1_000_000)).usd, 7);
  assert.throws(() => createPricer(table, { 'm-a': { input: 'x' } }), /price/i);
});

test('loadPrices: built-in file has dated, sourced entries; --prices file and config override', () => {
  const builtin = loadPrices();
  const e = builtin.find('claude-sonnet-5-5');
  assert.match(e.asOf, /^\d{4}-\d\d-\d\d$/);
  assert.match(e.source, /^https:\/\//);
  const dir = mkdtempSync(join(tmpdir(), 'ari-prices-'));
  const f = join(dir, 'p.json');
  writeFileSync(f, JSON.stringify({ models: { 'claude-sonnet-5-5': { input: 99 } } }));
  assert.equal(loadPrices({ file: f }).find('claude-sonnet-5-5').input, 99);
  const g = join(dir, 'flat.json');
  writeFileSync(g, JSON.stringify({ 'claude-sonnet-5-5': { input: 7 } }));
  assert.equal(loadPrices({ file: g }).find('claude-sonnet-5-5').input, 7);
  assert.equal(loadPrices({ config: { 'claude-sonnet-5-5': { input: 5 } }, file: g }).find('claude-sonnet-5-5').input, 7); // file beats config
  assert.equal(loadPrices({ config: { 'claude-sonnet-5-5': { input: 5 } } }).find('claude-sonnet-5-5').input, 5);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{nope');
  assert.throws(() => loadPrices({ file: bad }), (err) => err.code === 'EPRICES');
  assert.throws(() => loadPrices({ file: join(dir, 'missing.json') }), (err) => err.code === 'EPRICES');
});

test('applyCosts sets span.cost on llm spans only; totals sum priced and flag partial', () => {
  const p = createPricer(table);
  const spans = [
    { id: 'S', parentId: null, kind: 'session', status: 'ok', start: 0, end: 10 },
    { id: 'A', parentId: 'S', kind: 'agent', status: 'ok', start: 0, end: 9 },
    llm('l1', 'A', 'm-a', tok(1_000_000, 0)),
    llm('l2', 'A', 'mystery', tok(5, 5)),
    { id: 't', parentId: 'A', kind: 'tool', status: 'ok', start: 1, end: 2 },
  ];
  applyCosts(spans, p);
  assert.equal(spans[2].cost.usd, 1);
  assert.deepEqual(spans[3].cost, { usd: null, basis: 'unknown' });
  assert.equal(spans[4].cost, undefined);
  const { total, byAgent } = computeTotals(spans);
  assert.equal(total.usd, 1);
  assert.equal(total.partial, true);
  assert.equal(total.basis, 'priced');
  assert.equal(byAgent.A.usd, 1);
});

test('all unknown: usd null, basis unknown, not partial; no llm: null', () => {
  const spans = [
    { id: 'S', parentId: null, kind: 'session', status: 'ok', start: 0, end: 10 },
    llm('l', 'S', 'mystery', tok(1, 1)),
  ];
  applyCosts(spans, createPricer(table));
  const { total } = computeTotals(spans);
  assert.equal(total.usd, null);
  assert.equal(total.basis, 'unknown');
  assert.equal(total.partial, false);
});

test('reported value wins for the session total; sub-agents stay priced', () => {
  const spans = [
    { id: 'S', parentId: null, kind: 'session', status: 'ok', start: 0, end: 10 },
    { id: 'A', parentId: 'S', kind: 'agent', status: 'ok', start: 0, end: 9 },
    llm('l1', 'A', 'm-a', tok(1_000_000, 0)),
    llm('l2', 'A', 'mystery', tok(5, 5)),
  ];
  applyCosts(spans, createPricer(table));
  const { total, byAgent } = computeTotals(spans, { reportedUsd: 12.5 });
  assert.equal(total.usd, 12.5);
  assert.equal(total.basis, 'reported');
  assert.equal(total.partial, false);
  assert.equal(byAgent.A.usd, 1);
  assert.equal(byAgent.A.basis, 'priced');
  assert.equal(byAgent.A.partial, true);
});

test('reportedUsdOf: totalCostUSD, else sum of modelUsage costUSD, else null', () => {
  assert.equal(reportedUsdOf({ type: 'cost-state', totalCostUSD: 3.5 }), 3.5);
  assert.equal(reportedUsdOf({ type: 'cost-state', modelUsage: { a: { costUSD: 1 }, b: { costUSD: 0.5 } } }), 1.5);
  assert.equal(reportedUsdOf({ type: 'cost-state', modelUsage: { a: {} } }), null);
  assert.equal(reportedUsdOf(undefined), null);
});

test('index.open on the Claude Code fixture: reported total (session 1) vs no report (session 2)', () => {
  const root = new URL('./fixtures/claude-code/projects', import.meta.url).pathname;
  const idx = createIndex({ roots: { claude: [{ path: root }], codex: [] }, now: () => Date.parse('2026-12-01T00:00:00Z'), pricer: createPricer({ models: {} }) });
  const list = idx.list();
  let reported = 0; let unknown = 0;
  for (const s of list) {
    const o = idx.open(s.id);
    const { total } = computeTotals(o.spans, { reportedUsd: o.reportedUsd });
    if (total.basis === 'reported') { reported++; assert.ok(Number.isFinite(total.usd)); assert.equal(o.summary.totals.usd, total.usd); }
    else { unknown++; assert.equal(total.usd, null); }
  }
  assert.ok(reported >= 1 && unknown >= 1);
});

test('longContext: a second rate card above a prompt size (Claude Haiku 5.5: 100K)', () => {
  const p = loadPrices();
  const small = p.cost('claude-haiku-5-5', { input: 1000, cacheRead: 90000, output: 1000 });
  assert.ok(Math.abs(small.usd - (1000 * 0.1 + 90000 * 0.01 + 1000 * 0.5) / 1e6) < 1e-12);
  const large = p.cost('claude-haiku-5-5', { input: 1000, cacheRead: 150000, output: 1000 });
  assert.ok(Math.abs(large.usd - (1000 * 0.5 + 150000 * 0.05 + 1000 * 2.5) / 1e6) < 1e-12);
  assert.equal(large.basis, 'priced');
  assert.throws(() => createPricer({ models: { x: { input: 1, longContext: { input: 2 } } } }), /longContext/);
  assert.throws(() => createPricer({ models: { x: { input: 1, longContext: { above: 10, input: -1 } } } }), /longContext/);
});

test('a record with no tokens costs nothing, even for a model not in the table ("<synthetic>")', () => {
  const p = loadPrices();
  assert.deepEqual(p.cost('<synthetic>', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), { usd: 0, basis: 'priced' });
  assert.deepEqual(p.cost('<synthetic>', {}), { usd: 0, basis: 'priced' });
  assert.equal(p.cost('<synthetic>', { output: 5 }).basis, 'unknown');
});

test('Claude models seen in real logs are priced: Opus 5, Sonnet 5, Fable 5 / 5.1, Haiku 5.5', () => {
  const p = loadPrices();
  for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-haiku-5-5', 'claude-opus-5-5[1m]']) {
    assert.equal(p.cost(m, { input: 10, output: 10, cacheRead: 10, cacheWrite: 10 }).basis, 'priced', m);
  }
  assert.ok(Math.abs(p.cost('claude-opus-5', { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }).usd - (5 + 25 + 0.5 + 6.25)) < 1e-9);
});
