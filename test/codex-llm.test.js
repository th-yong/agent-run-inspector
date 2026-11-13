import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRolloutText, parseLines } from '../src/adapters/codex/index.js';

const ROOT = fileURLToPath(new URL('./fixtures/codex/sessions', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const FILES = walk(ROOT).filter((p) => p.endsWith('.jsonl'));
const text = (n) => readFileSync(FILES.find((p) => p.endsWith(`${n}.jsonl`)), 'utf8');
const COLD = () => Date.parse('2026-12-01T00:00:00Z');
const llms = (p) => p.spans().filter((s) => s.kind === 'llm');
const iso = (s) => Date.parse(`2026-03-01T09:00:${s}Z`);

test('old version: info:null skipped, repeated cumulative total dropped, last_token_usage used', () => {
  const p = parseRolloutText('f1', text('000000000001'), { now: COLD });
  const l = llms(p);
  assert.equal(l.length, 2);
  assert.equal(l[0].end, iso('06.000'));
  assert.deepEqual(l[0].tokens, { input: 800, output: 50, cacheRead: 200, cacheWrite: 0, reasoning: 10, includedInOutput: true });
  // second real response: last_token_usage (not the cumulative total)
  assert.deepEqual(l[1].tokens, { input: 1400, output: 120, cacheRead: 800, cacheWrite: 0, reasoning: 30, includedInOutput: true });
  assert.equal(l[1].end, iso('10.000'));
});

test('llm span shape: parent, model, provider, start from previous input/tool-output line', () => {
  const p = parseRolloutText('f1', text('000000000001'), { now: COLD });
  const [a, b] = llms(p);
  assert.equal(a.parentId, 'cx:00000000-0000-4000-8000-000000000001:main');
  assert.equal(a.model, 'gpt-5-codex');
  assert.equal(a.name, 'gpt-5-codex');
  assert.equal(a.provider, 'openai');
  assert.equal(a.status, 'ok');
  assert.equal(a.startApprox, true);
  assert.equal(a.start, iso('05.000')); // function_call_output just before
  assert.equal(b.start, iso('06.000')); // no new input since: previous response end
  assert.ok(b.start >= a.end);          // never starts before the previous response ended
  assert.equal(a.ref.line, 7);
});

test('0.166: token_usage_record only; the twin token_count is not counted again', () => {
  const p = parseRolloutText('f3', text('000000000003'), { now: COLD });
  const l = llms(p);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0].tokens, { input: 3000, output: 300, cacheRead: 1000, cacheWrite: 500, reasoning: 100, includedInOutput: true });
  assert.deepEqual(l[1].tokens, { input: 2500, output: 200, cacheRead: 2500, cacheWrite: 0, reasoning: 50, includedInOutput: true });
  assert.match(l[0].id, /resp_1$/);
  const sum = l.reduce((n, s) => n + s.tokens.output, 0);
  assert.equal(sum, 500);
});

test('incremental: re-pushing a line yields no change, spans are not re-emitted', () => {
  const rows = text('000000000001').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const p = parseLines('f1', rows.slice(0, 6), { now: COLD });
  const before = llms(p).length;
  const out = p.push(7, rows[6]);
  assert.equal(before, 0);
  assert.equal(out.filter((s) => s.kind === 'llm').length, 1);
  const dup = p.push(8, rows[7]);
  assert.equal(dup.filter((s) => s.kind === 'llm').length, 0);
});

test('cached never exceeds input: input is clamped at 0 if a record violates it', () => {
  const meta = { timestamp: '2026-03-01T09:00:00.000Z', type: 'session_meta', payload: { id: 's', timestamp: '2026-03-01T09:00:00.000Z' } };
  const tc = { timestamp: '2026-03-01T09:00:01.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5 }, last_token_usage: { input_tokens: 5, cached_input_tokens: 9, output_tokens: 1 } } } };
  const p = parseLines('f', [meta, tc], { now: COLD });
  assert.equal(llms(p)[0].tokens.input, 0);
});

test('token_count without last_token_usage is skipped', () => {
  const meta = { timestamp: '2026-03-01T09:00:00.000Z', type: 'session_meta', payload: { id: 's', timestamp: '2026-03-01T09:00:00.000Z' } };
  const tc = { timestamp: '2026-03-01T09:00:01.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5 } } } };
  assert.equal(llms(parseLines('f', [meta, tc], { now: COLD })).length, 0);
});

test('unknown format file yields no llm spans', () => {
  const p = parseLines('f', [{ type: 'x' }, { type: 'event_msg', payload: { type: 'token_count' } }], { now: COLD });
  assert.equal(llms(p).length, 0);
});
