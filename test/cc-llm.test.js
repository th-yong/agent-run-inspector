import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeSession, parseSessionText } from '../src/adapters/claude-code/index.js';
import { mapUsage } from '../src/adapters/claude-code/llm.js';

const DIR = fileURLToPath(new URL('./fixtures/claude-code/projects/-synthetic-demo-app/', import.meta.url));
const S1 = '00000000-0000-4000-8000-0000000000a1';
const S2 = '00000000-0000-4000-8000-0000000000a2';
const NOW = Date.parse('2026-06-01T00:00:00Z');
const read = (id) => readFileSync(`${DIR}${id}.jsonl`, 'utf8');
const parse = (id) => parseSessionText(read(id), { fileId: 'f1', now: NOW });
const ms = (iso) => Date.parse(iso);

test('session: title, project, branch', () => {
  const { session, spans } = parse(S1);
  assert.equal(session.id, S1);
  assert.equal(session.title, 'Synthetic demo session');
  assert.equal(session.project, 'demo-app');
  assert.equal(session.branch, 'main');
  const root = spans[0];
  assert.equal(root.kind, 'session');
  assert.equal(root.name, 'Synthetic demo session');
  assert.equal(root.status, 'ok');
  assert.equal(root.start, ms('2026-01-01T00:00:00Z'));
  assert.equal(root.end, ms('2026-01-01T00:01:13Z'));
  assert.equal(root.parentId, null);
});

test('session without ai-title falls back to project; recent write means running', () => {
  const { spans } = parseSessionText(read(S2), { fileId: 'f2', now: ms('2026-01-02T00:00:30Z') });
  assert.equal(spans[0].name, 'demo-app');
  assert.equal(spans[0].status, 'running');
  assert.equal(spans[0].end, null);
});

test('repeated message.id lines make one llm span with usage counted once', () => {
  const llms = parse(S1).spans.filter((s) => s.kind === 'llm' && s.id === 'llm:msg_synth_01');
  assert.equal(llms.length, 1);
  assert.deepEqual(llms[0].tokens, {
    input: 120, output: 45, cacheRead: 800, cacheWrite: 300, reasoning: 10, includedInOutput: true,
  });
  assert.equal(llms[0].model, 'synthetic-model-a');
  assert.equal(llms[0].status, 'ok');
  assert.equal(llms[0].parentId, S1);
});

test('start from api-request via requestRef, end = last line of the id', () => {
  const s = parse(S1).spans.find((x) => x.id === 'llm:msg_synth_01');
  assert.equal(s.start, ms('2026-01-01T00:00:01Z'));
  assert.equal(s.end, ms('2026-01-01T00:00:05.5Z'));
  assert.equal(s.startApprox, undefined);
  assert.equal(s.ref.line, 4);
});

test('no requestRef: start is the previous line, flagged startApprox', () => {
  const s = parse(S1).spans.find((x) => x.id === 'llm:msg_synth_03');
  assert.equal(s.start, ms('2026-01-01T00:00:09Z'));
  assert.equal(s.startApprox, true);
});

test('total tokens over the fixture count each message.id once', () => {
  const sum = parse(S1).spans.filter((s) => s.kind === 'llm').reduce((a, s) => a + s.tokens.input, 0);
  // msg_01..06 = 6 calls x 120 + advisor 500; synthetic error 0
  assert.equal(sum, 6 * 120 + 500);
});

test('<synthetic> is an error with zero tokens', () => {
  const s = parse(S1).spans.find((x) => x.id === 'llm:msg_synth_err');
  assert.equal(s.status, 'error');
  assert.deepEqual(s.error, { message: 'overloaded', code: 529 });
  assert.deepEqual(s.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(JSON.stringify(s).includes('SECRET'), false);
});

test('advisor iteration becomes a child llm with its own model and provider', () => {
  const spans = parse(S1).spans;
  const parent = spans.find((x) => x.id === 'llm:msg_synth_04');
  const child = spans.find((x) => x.parentId === parent.id);
  assert.equal(child.kind, 'llm');
  assert.equal(child.model, 'synthetic-model-c');
  assert.notEqual(child.model, parent.model);
  assert.equal(child.tokens.input, 500);
  assert.equal(child.tokens.output, 90);
  assert.equal(parent.tokens.input, 120);
});

test('provider is attached', () => {
  const s = parse(S1).spans.find((x) => x.id === 'llm:msg_synth_01');
  assert.equal(s.provider, 'other');
  const c = parseSessionText(
    '{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","sessionId":"x","message":{"id":"m","model":"claude-opus-4-1","stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":2}}}\n',
    { fileId: 'f' },
  );
  assert.equal(c.spans.find((x) => x.kind === 'llm').provider, 'anthropic');
});

test('mapUsage: 5m + 1h cache writes sum, flat total as fallback', () => {
  assert.equal(mapUsage({ cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 3 } }).cacheWrite, 10);
  assert.equal(mapUsage({ cache_creation_input_tokens: 9 }).cacheWrite, 9);
  assert.equal(mapUsage({ input_tokens: 1 }).reasoning, undefined);
});

test('damaged and unknown lines are skipped; a cut tail is not consumed', () => {
  const { spans } = parse(S2);
  assert.ok(spans.some((s) => s.kind === 'llm'));
  const s = new ClaudeCodeSession({ fileId: 'f' });
  s.push(read(S2));
  assert.ok(s.pending.length > 0);
});

test('incremental feeding equals batch, for any chunking', () => {
  for (const id of [S1, S2]) {
    const text = read(id);
    const batch = parseSessionText(text, { fileId: 'f', now: NOW });
    for (const size of [1, 7, 64, 1000]) {
      const inc = new ClaudeCodeSession({ fileId: 'f', now: NOW });
      for (let i = 0; i < text.length; i += size) inc.push(text.slice(i, i + size));
      assert.deepEqual(inc.snapshot(), batch);
    }
  }
});

test('the end of an in-progress message grows when later lines arrive', () => {
  const lines = read(S1).split('\n');
  const s = new ClaudeCodeSession({ fileId: 'f', now: NOW });
  s.push(lines.slice(0, 4).join('\n') + '\n');
  const before = s.snapshot().spans.find((x) => x.id === 'llm:msg_synth_01');
  s.push(lines.slice(4, 5).join('\n') + '\n');
  const after = s.snapshot().spans.find((x) => x.id === 'llm:msg_synth_01');
  assert.ok(after.end > before.end);
  assert.ok(after.seq > before.seq);
  assert.equal(after.tokens.input, before.tokens.input);
});
