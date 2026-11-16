import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndex } from '../src/index/index.js';

const LEAD = '00000000-0000-4000-8000-00000000f001';
const MATE = '00000000-0000-4000-8000-00000000f002';
const T0 = Date.now() - 60e3;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('agent-team teammate files fold into the lead, also from a worktree folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'ari-mates-'));
  const leadDir = join(root, '-p-app');
  const mateDir = join(root, '-p-app--claude-worktrees-agent-x'); // teammate ran in a worktree
  mkdirSync(leadDir); mkdirSync(mateDir);
  writeFileSync(join(leadDir, `${LEAD}.jsonl`), jl([
    { type: 'user', sessionId: LEAD, cwd: '/p/app', timestamp: at(0), message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: LEAD, timestamp: at(1), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { name: 'qa', subagent_type: 'product-qa' } }] } },
    { type: 'user', sessionId: LEAD, timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
      toolUseResult: { status: 'teammate_spawned', agentId: 'qa@team-1', teammate_id: 'qa@team-1', team_name: 'team-1' } },
  ]));
  writeFileSync(join(mateDir, `${MATE}.jsonl`), jl([
    { type: 'agent-setting', agentSetting: 'product-qa', sessionId: MATE },
    { type: 'user', sessionId: MATE, teamName: 'team-1', agentName: 'qa', cwd: '/p/app/.claude/worktrees/agent-x', timestamp: at(3), message: { role: 'user', content: 'hi' } },
    { type: 'assistant', sessionId: MATE, teamName: 'team-1', agentName: 'qa', timestamp: at(4), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 10, output_tokens: 5 } } },
  ]));
  const idx = createIndex({ roots: { claude: [{ path: root }] }, source: 'claude' });
  const list = idx.list();
  assert.deepEqual(list.map((s) => s.id), [LEAD]); // the teammate is not a session of its own
  const { spans } = idx.open(LEAD);
  const qa = spans.find((s) => s.id === 'ext:qa@team-1');
  assert.equal(qa.external, undefined);
  assert.equal(qa.status, 'running');
  assert.ok(spans.some((s) => s.kind === 'llm' && s.parentId === qa.id)); // its calls hang under it
});
