import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexParser } from '../src/adapters/codex/index.js';
import { linkCodexAgents } from '../src/adapters/codex/agents.js';

// Found by the T39 real-record check: a rollout file with no parsable line (empty, or only a cut line)
// never reaches the first-line check, so meta() used to throw and opening the session answered 500.
const empty = () => createCodexParser({ fileId: 'f-empty', now: () => 0 });

test('a parser that saw no line has no meta, spans and turns do not throw', () => {
  const p = empty();
  assert.equal(p.meta(), null);
  assert.doesNotThrow(() => { p.spans(); p.turns(); p.spawns(); p.activities(); });
});

test('linking an empty rollout as root or as pool member does not throw', () => {
  const real = createCodexParser({ fileId: 'f-real', now: () => 0 });
  real.push(1, { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T-1', timestamp: '2026-01-01T00:00:00Z', cwd: '/x' } });
  assert.doesNotThrow(() => linkCodexAgents(real, [empty()]));
  assert.doesNotThrow(() => linkCodexAgents(empty(), [real]));
});
