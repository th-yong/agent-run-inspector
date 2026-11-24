// Orca bots and dispatched workers (made-up data): a worker session is folded under the session whose
// `orchestration worker-start` result named its task; a bot's own session is flagged and its root is a bot.
// Sessions that only quote the ids or the dispatch prompt link nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndex } from '../src/index/index.js';
import { botOf, workerTaskOf } from '../src/adapters/claude-code/orca.js';

const T0 = Date.now() - 120e3;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const BOT = '00000000-0000-4000-8000-0000000000b1';
const WORKER = '00000000-0000-4000-8000-0000000000b2';
const QUOTER = '00000000-0000-4000-8000-0000000000b3';
const LATE = '00000000-0000-4000-8000-0000000000b4';
const PROMPT = 'You are working inside Orca. You are a dispatched worker. Your task ID is: task_0a1 Do the thing.';
const RESULT = 'dispatchId=ctx_0f1 taskId=task_0a1 runId=run_1 state=ready agent=claude';

const rec = (sid, cwd) => ({
  user: (s, content) => ({ sessionId: sid, cwd, type: 'user', timestamp: at(s), message: { role: 'user', content } }),
  bash: (s, id, command) => ({ sessionId: sid, cwd, type: 'assistant', timestamp: at(s), message: { id: `m${sid}${s}`, model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } }),
  result: (s, id, text) => ({ sessionId: sid, cwd, type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }),
  done: (s) => ({ sessionId: sid, cwd, type: 'assistant', timestamp: at(s), message: { id: `d${sid}${s}`, model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'ok' }] } }),
});

function setup({ quoterFirst = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ari-orca-'));
  const put = (dir, sid, rows) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, `${sid}.jsonl`), jl(rows)); };
  const b = rec(BOT, '/Users/dev/.orca/bots/shop-bot');
  put('-Users-dev--orca-bots-shop-bot', BOT, [
    b.user(10, '[Orca: your live work now]'),
    b.bash(11, 'tw', 'O=orca; $O orchestration worker-start --name api-tests --agent claude --spec-file /tmp/x.md'),
    b.result(12, 'tw', `Linked to item 1\n${RESULT}\nNext: Orca wakes you`),
    b.done(13),
  ]);
  const w = rec(WORKER, '/Users/dev/orca/workspaces/shop/api-tests');
  put('-Users-dev-orca-workspaces-shop-api-tests', WORKER, [w.user(14, PROMPT), w.done(20)]);
  // quotes the worker-start result in an unrelated command's output, earlier or later than the bot
  const q = rec(QUOTER, '/Users/dev/notes');
  put('-Users-dev-notes', QUOTER, [q.user(quoterFirst ? 1 : 30, 'look'), q.bash(quoterFirst ? 2 : 31, 'tq', 'cat log.txt'), q.result(quoterFirst ? 3 : 32, 'tq', RESULT), q.done(quoterFirst ? 4 : 33)]);
  // pastes the dispatch prompt later in the chat: not a worker
  const l = rec(LATE, '/Users/dev/other');
  put('-Users-dev-other', LATE, [l.user(40, 'hi'), l.done(41), l.user(42, PROMPT), l.done(43)]);
  return createIndex({ roots: { claude: [{ path: root }] }, source: 'claude', now: () => T0 + 60e3 });
}

test('a worker folds under the bot that started it; quotes link nothing', () => {
  for (const quoterFirst of [false, true]) {
    const idx = setup({ quoterFirst });
    const list = idx.list();
    const ids = list.map((s) => s.id);
    assert.ok(!ids.includes(WORKER), 'the worker is not a top-level session');
    assert.ok(ids.includes(LATE) && ids.includes(QUOTER));
    const bot = list.find((s) => s.id === BOT);
    assert.equal(bot.bot, 'shop-bot');
    assert.equal(bot.agentCount, 2);
    assert.equal(list.find((s) => s.id === QUOTER).agentCount, 1);
    assert.equal(list.find((s) => s.id === QUOTER).bot, undefined);

    const v = idx.open(BOT);
    const agents = v.spans.filter((s) => s.kind === 'agent');
    const root = agents.find((s) => s.depth === 0);
    assert.equal(root.role, 'bot');
    assert.equal(root.bot, 'shop-bot');
    const worker = agents.find((s) => s.id === 'ext:task_0a1');
    assert.deepEqual([worker.name, worker.orca, worker.external, worker.status], ['api-tests', true, undefined, 'ok']);
    assert.ok(v.spans.some((s) => s.kind === 'llm' && s.parentId === 'ext:task_0a1'), "the worker's own calls are in the run");
    assert.equal(v.summary.bot, 'shop-bot');
    // a quoting session's full parse makes no worker node either
    assert.ok(!idx.open(QUOTER).spans.some((s) => s.orca));
  }
});

test('bot folders and dispatch prompts', () => {
  assert.equal(botOf('/Users/dev/.orca/bots/pr-review'), 'pr-review');
  assert.equal(botOf('/Users/dev/.orca/bots/pr-review/sub'), undefined);
  assert.equal(botOf('/Users/dev/orca/workspaces/x'), undefined);
  assert.equal(workerTaskOf({ type: 'user', message: { content: [{ type: 'text', text: PROMPT }] } }), 'task_0a1');
  assert.equal(workerTaskOf({ type: 'user', message: { content: 'Your task ID is: task_0a1' } }), undefined);
});
