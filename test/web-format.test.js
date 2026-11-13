import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtTokens, fmtUsd, fmtDuration } from '../web/format.js';

test('fmtTokens: plain, k and M with one decimal', () => {
  assert.equal(fmtTokens(0), '0');
  assert.equal(fmtTokens(999), '999');
  assert.equal(fmtTokens(1200), '1.2k');
  assert.equal(fmtTokens(999949), '999.9k');
  assert.equal(fmtTokens(999950), '1.0M');
  assert.equal(fmtTokens(3_400_000), '3.4M');
});

test('fmtTokens / fmtUsd / fmtDuration show a dash for unknown values', () => {
  for (const v of [null, undefined, NaN]) {
    assert.equal(fmtTokens(v), '—');
    assert.equal(fmtUsd(v), '—');
    assert.equal(fmtDuration(v), '—');
  }
});

test('fmtUsd: four decimals under one dollar, two from one dollar', () => {
  assert.equal(fmtUsd(0.0123), '$0.0123');
  assert.equal(fmtUsd(0), '$0.0000');
  assert.equal(fmtUsd(0.99996), '$1.00');
  assert.equal(fmtUsd(1.25), '$1.25');
  assert.equal(fmtUsd(123.456), '$123.46');
});

test('fmtDuration: ms, seconds, minutes and hours', () => {
  assert.equal(fmtDuration(0), '0ms');
  assert.equal(fmtDuration(820), '820ms');
  assert.equal(fmtDuration(12_400), '12.4s');
  assert.equal(fmtDuration(59_960), '1m 00s');
  assert.equal(fmtDuration(185_000), '3m 05s');
  assert.equal(fmtDuration(3_720_000), '1h 02m');
});
