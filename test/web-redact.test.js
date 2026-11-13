import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMode, toggleView } from '../web/redact-toggle.js';

test('nextMode flips between off and basic, and is locked when the server started with redaction', () => {
  assert.equal(nextMode('off', 'off'), 'basic');
  assert.equal(nextMode('basic', 'off'), 'off');
  assert.equal(nextMode('strict', 'off'), 'off');
  assert.equal(nextMode('basic', 'basic'), null);
  assert.equal(nextMode('strict', 'strict'), null);
});

test('toggleView labels the level in words, not only by colour', () => {
  assert.equal(toggleView({ mode: 'off', floor: 'off' }).text, 'Redact: off');
  assert.equal(toggleView({ mode: 'basic', floor: 'off' }).text, 'Redact: on');
  assert.equal(toggleView({ mode: 'strict', floor: 'strict' }).text, 'Redact: strict');
  assert.equal(toggleView({ mode: 'strict', floor: 'strict' }).locked, true);
  assert.equal(toggleView(null).on, false);
});
