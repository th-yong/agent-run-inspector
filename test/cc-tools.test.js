import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeSession, parseSessionText } from '../src/adapters/claude-code/index.js';

const DIR = fileURLToPath(new URL('./fixtures/claude-code/projects/-synthetic-demo-app/', import.meta.url));
const S1 = '00000000-0000-4000-8000-0000000000a1';
const NOW = Date.parse('2026-06-01T00:00:00Z');
const ms = (iso) => Date.parse(iso);
const fixture = parseSessionText(readFileSync(`${DIR}${S1}.jsonl`, 'utf8'), { fileId: 'f1', now: NOW });
const tools = (snap) => snap.spans.filter((s) => s.kind === 'tool');
const byId = (snap, id) => snap.spans.find((s) => s.id === id);

const asst = (ts, id, blocks) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, sessionId: 's', message: { id, model: 'm', content: blocks, stop_reason: 'tool_use', usage: {} } });
const result = (ts, toolUseId, extra = {}, top = {}) =>
  JSON.stringify({ type: 'user', timestamp: ts, sessionId: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'x', ...extra }] }, ...top });
const run = (lines, opts = {}) => parseSessionText(lines.join('\n') + '\n', { fileId: 'f', now: NOW, ...opts });

test('fixture: tool span ids, parent, name, command, ref', () => {
  const t = byId(fixture, 'tool:toolu_synth_bash1');
  assert.equal(t.kind, 'tool');
  assert.equal(t.parentId, S1);
  assert.equal(t.name, 'Bash');
  assert.equal(t.command, 'echo SECRET-MARKER-CMD');
  assert.equal(t.ref.line, 13);
  assert.equal(t.start, ms('2026-01-01T00:00:12Z'));
  assert.equal(t.end, ms('2026-01-01T00:00:13Z'));
  assert.equal(t.source, 'claude-code');
});

test('fixture: is_error -> error, interrupted -> cancelled', () => {
  assert.equal(byId(fixture, 'tool:toolu_synth_bash1').status, 'error');
  const b2 = byId(fixture, 'tool:toolu_synth_bash2');
  assert.equal(b2.status, 'cancelled');
  assert.equal(b2.end, ms('2026-01-01T00:00:25Z'));
});

test('fixture: error and body text never leak into spans', () => {
  assert.equal(JSON.stringify(fixture.spans).includes('SECRET-MARKER-OUTPUT'), false);
  assert.equal(JSON.stringify(fixture.spans).includes('SECRET-MARKER-STDERR'), false);
});

test('fixture: Agent tool_use is left to the agent task, not a tool span', () => {
  assert.equal(tools(fixture).some((s) => s.name === 'Agent'), false);
});

test('server_tool_use is a tool; no result in an old file is unknown with end null', () => {
  const t = byId(fixture, 'tool:srvtoolu_synth_01');
  assert.equal(t.name, 'web_search');
  assert.equal(t.status, 'unknown');
  assert.equal(t.end, null);
  assert.equal(t.toolCategory, 'web');
});

test('no result in a recently written file is running with end null', () => {
  const now = ms('2026-01-01T00:00:30Z');
  const snap = run([asst('2026-01-01T00:00:00Z', 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 9' } }])], { now });
  const t = byId(snap, 'tool:t1');
  assert.equal(t.status, 'running');
  assert.equal(t.end, null);
  assert.equal(snap.spans[0].status, 'running');
});

test('result arriving later closes the tool (incremental)', () => {
  const s = new ClaudeCodeSession({ fileId: 'f', now: ms('2026-01-01T00:00:30Z') });
  s.push(asst('2026-01-01T00:00:00Z', 'm1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]) + '\n');
  const before = byId(s.snapshot(), 'tool:t1');
  assert.equal(before.status, 'running');
  s.push(result('2026-01-01T00:00:04Z', 't1') + '\n');
  const after = byId(s.snapshot(), 'tool:t1');
  assert.equal(after.status, 'ok');
  assert.equal(after.end, ms('2026-01-01T00:00:04Z'));
  assert.ok(after.seq > before.seq);
});

test('same tool_use repeated across lines of one message.id makes one span', () => {
  const block = { type: 'tool_use', id: 't1', name: 'Read', input: {} };
  const snap = run([
    asst('2026-01-01T00:00:00Z', 'm1', [block]),
    asst('2026-01-01T00:00:01Z', 'm1', [block]),
    result('2026-01-01T00:00:02Z', 't1'),
  ]);
  assert.equal(tools(snap).length, 1);
  assert.equal(tools(snap)[0].start, ms('2026-01-01T00:00:00Z'));
  assert.equal(tools(snap)[0].ref.line, 1);
});

test('server tool result block inside an assistant line ends the tool', () => {
  const snap = run([
    asst('2026-01-01T00:00:00Z', 'm1', [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }]),
    asst('2026-01-01T00:00:03Z', 'm1', [{ type: 'web_search_tool_result', tool_use_id: 's1', content: [] }]),
  ]);
  const t = byId(snap, 'tool:s1');
  assert.equal(t.status, 'ok');
  assert.equal(t.end, ms('2026-01-01T00:00:03Z'));
});

test('toolUseResult.interrupted on a normal result is cancelled', () => {
  const snap = run([
    asst('2026-01-01T00:00:00Z', 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x' } }]),
    result('2026-01-01T00:00:02Z', 't1', {}, { toolUseResult: { interrupted: true } }),
  ]);
  assert.equal(byId(snap, 'tool:t1').status, 'cancelled');
});

test('Bash first word picks the brand; category is always set; errors lose the brand', () => {
  const mk = (cmd, err) => {
    const snap = run([
      asst('2026-01-01T00:00:00Z', 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: cmd } }]),
      result('2026-01-01T00:00:01Z', 't1', err ? { is_error: true } : {}),
    ]);
    return byId(snap, 'tool:t1');
  };
  const gh = mk('gh pr list', false);
  assert.equal(gh.toolBrand, 'github');
  assert.equal(gh.toolCategory, 'git');
  assert.equal(mk('GIT_X=1 sudo git status', false).toolBrand, 'git');
  assert.equal(mk('ls -la', false).toolBrand, undefined);
  assert.equal(mk('ls -la', false).toolCategory, 'shell');
  const bad = mk('gh pr list', true);
  assert.equal(bad.toolBrand, undefined);
  assert.equal(bad.toolCategory, 'git');
});

test('MCP tool brand comes from the server name; non-Bash tools have no command', () => {
  const snap = run([
    asst('2026-01-01T00:00:00Z', 'm1', [
      { type: 'tool_use', id: 't1', name: 'mcp__github__create_issue', input: { title: 'T' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a' } },
    ]),
  ]);
  assert.equal(byId(snap, 'tool:t1').toolBrand, 'github');
  assert.equal(byId(snap, 'tool:t1').toolCategory, 'mcp');
  assert.equal(byId(snap, 'tool:t2').toolCategory, 'file');
  assert.equal('command' in byId(snap, 'tool:t2'), false);
});

test('result before its tool_use (odd order) still pairs', () => {
  const snap = run([
    result('2026-01-01T00:00:01Z', 't1'),
    asst('2026-01-01T00:00:00Z', 'm1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
  ]);
  assert.equal(byId(snap, 'tool:t1').status, 'ok');
});

test('compact_boundary and turn_duration are exposed as markers and turns', () => {
  assert.deepEqual(fixture.markers, [
    { kind: 'compact', ts: ms('2026-01-01T00:00:27Z'), preTokens: 150000, postTokens: 12000, ref: { fileId: 'f1', line: 20 } },
  ]);
  assert.deepEqual(fixture.turns, [{ ts: ms('2026-01-01T00:00:28Z'), durationMs: 28000 }]);
});

test('tool spans do not change llm spans or the session span range', () => {
  const llm = fixture.spans.filter((s) => s.kind === 'llm');
  assert.equal(llm.length > 0, true);
  assert.equal(fixture.spans[0].end, ms('2026-01-01T00:01:13Z'));
});

test('tools of a session within chunked input equal batch', () => {
  const text = readFileSync(`${DIR}${S1}.jsonl`, 'utf8');
  const inc = new ClaudeCodeSession({ fileId: 'f1', now: NOW });
  for (let i = 0; i < text.length; i += 37) inc.push(text.slice(i, i + 37));
  assert.deepEqual(inc.snapshot(), fixture);
});

test('untitled session uses the text from strings.js', async () => {
  const { MSG } = await import('../src/strings.js');
  const snap = run([asst('2026-01-01T00:00:00Z', 'm1', [])]);
  assert.equal(snap.spans[0].name, MSG.untitledSession);
});
