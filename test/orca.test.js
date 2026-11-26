// Orca bots and dispatched workers (made-up data): a worker session is folded under the session whose
// `orchestration worker-start` result named its task; a bot's own session is flagged and its root is a bot.
// Sessions that only quote the ids or the dispatch prompt link nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndex } from '../src/index/index.js';
import { botOf, workerOf } from '../src/adapters/claude-code/orca.js';

const T0 = Date.now() - 120e3;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const BOT = '00000000-0000-4000-8000-0000000000b1';
const WORKER = '00000000-0000-4000-8000-0000000000b2';
const QUOTER = '00000000-0000-4000-8000-0000000000b3';
const LATE = '00000000-0000-4000-8000-0000000000b4';
const RIVAL = '00000000-0000-4000-8000-0000000000b5';
const PROMPT = 'You are working inside Orca. You are a dispatched worker. Your task ID is: task_0a1 When blocked: orca orchestration send --task-id task_0a1 --dispatch-id ctx_0f1 Do the thing.';
const RESULT = 'dispatchId=ctx_0f1 taskId=task_0a1 runId=run_1 state=ready agent=claude workspace=w1::/Users/dev/orca/workspaces/shop/api-tests keptOpen=true';

const rec = (sid, cwd) => ({
  user: (s, content) => ({ sessionId: sid, cwd, type: 'user', timestamp: at(s), message: { role: 'user', content } }),
  bash: (s, id, command) => ({ sessionId: sid, cwd, type: 'assistant', timestamp: at(s), message: { id: `m${sid}${s}`, model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } }),
  result: (s, id, text) => ({ sessionId: sid, cwd, type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }),
  done: (s) => ({ sessionId: sid, cwd, type: 'assistant', timestamp: at(s), message: { id: `d${sid}${s}`, model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'ok' }] } }),
});

// rivalFirst: another session with a genuine worker-start result naming the same task, before or after the bot.
// busy: the worker is mid-turn (a tool call without its result).
// grepped: the bot cut the result down to the dispatch id (no task id, no name, no workspace).
// helper: Orca's branch-name helper ran for the worker, ending with one big record after its answer.
// titled: the worker's session has its own title.
const HELPER = '00000000-0000-4000-8000-0000000000b6';
function setup({ quoterFirst = false, rivalFirst = null, busy = false, grepped = false, helper = false, titled = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ari-orca-'));
  const put = (dir, sid, rows) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, `${sid}.jsonl`), jl(rows)); };
  const b = rec(BOT, '/Users/dev/.orca/bots/shop-bot');
  put('-Users-dev--orca-bots-shop-bot', BOT, [
    b.user(10, '[Orca: your live work now]'),
    grepped ? b.bash(11, 'tw', 'O=orca; $O orchestration worker-start --item 3 --agent claude --spec-file /tmp/x.md | grep -oE "dispatchId=\\S+"')
      : b.bash(11, 'tw', 'O=orca; $O orchestration worker-start --name api-tests --task-title "Write API tests" --agent claude --spec-file /tmp/x.md'),
    b.result(12, 'tw', grepped ? 'dispatchId=ctx_0f1 N=3' : `Linked to item 1\n${RESULT}\nNext: Orca wakes you`),
    b.done(13),
  ]);
  const w = rec(WORKER, '/Users/dev/orca/workspaces/shop/api-tests');
  // Orca's dispatch prompt sits behind ~64 KB of attachment records, as in real worker files
  const pad = { sessionId: WORKER, type: 'attachment', entrypoint: 'orca', timestamp: at(14), attachment: { content: 'x'.repeat(70 * 1024) } };
  put('-Users-dev-orca-workspaces-shop-api-tests', WORKER, [pad, w.user(14, PROMPT), ...(busy ? [w.bash(15, 'wb', 'npm test')] : [w.done(20)]),
    ...(titled ? [{ type: 'ai-title', aiTitle: 'Login API tests', sessionId: WORKER }] : [])]);
  if (helper) {
    const h = rec(HELPER, '/Users/dev/orca/workspaces/shop/api-tests');
    put('-Users-dev-orca-workspaces-shop-api-tests', HELPER, [
      // it quotes a shortened prompt: no worker line, no dispatch id
      { ...h.user(13, 'Generate a short git branch name for the task below.\nUser request:\nYou are working inside Orca, a multi-agent IDE. Your task ID is: task_0a1 === TASK === x'), entrypoint: 'sdk-cli' }, h.done(13.5),
      { sessionId: HELPER, type: 'attachment', entrypoint: 'sdk-cli', timestamp: at(13.5), attachment: { content: 'y'.repeat(20 * 1024) } }]);
  }
  if (rivalFirst !== null) {
    const r = rec(RIVAL, '/Users/dev/elsewhere');
    const t = rivalFirst ? 5 : 50;
    put('-Users-dev-elsewhere', RIVAL, [r.user(t, 'go'), r.bash(t + 1, 'tr', 'orca orchestration worker-start --agent claude'), r.result(t + 2, 'tr', RESULT), r.done(t + 3)]);
  }
  // quotes the worker-start result in an unrelated command's output, earlier or later than the bot
  const q = rec(QUOTER, '/Users/dev/notes');
  put('-Users-dev-notes', QUOTER, [q.user(quoterFirst ? 1 : 30, 'look'), q.bash(quoterFirst ? 2 : 31, 'tq', 'cat log.txt'), q.result(quoterFirst ? 3 : 32, 'tq', RESULT), q.done(quoterFirst ? 4 : 33)]);
  // pastes the dispatch prompt later in the chat: not a worker
  const l = rec(LATE, '/Users/dev/other');
  put('-Users-dev-other', LATE, [l.user(40, 'hi'), l.done(41), l.user(42, PROMPT), l.done(43)]);
  return createIndex({ roots: { claude: [{ path: root }] }, source: 'claude', now: () => Date.now() }); // files are written now: the clock must not be behind them
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
    assert.deepEqual([worker.name, worker.task, worker.orca, worker.external, worker.status], ['api-tests', 'Write API tests', true, undefined, 'ok']);
    assert.ok(v.spans.some((s) => s.kind === 'llm' && s.parentId === 'ext:task_0a1'), "the worker's own calls are in the run");
    assert.equal(v.summary.bot, 'shop-bot');
    // a quoting session's full parse makes no worker node either
    assert.ok(!idx.open(QUOTER).spans.some((s) => s.orca));
  }
});

test('a task named by two worker-start results goes to the earlier one; no --name: the workspace folder names it', () => {
  const later = setup({ rivalFirst: false }).list();
  assert.equal(later.find((s) => s.id === BOT).agentCount, 2);
  assert.equal(later.find((s) => s.id === RIVAL).agentCount, 1);
  const earlier = setup({ rivalFirst: true }).list();
  assert.equal(earlier.find((s) => s.id === BOT).agentCount, 1);
  assert.equal(earlier.find((s) => s.id === RIVAL).agentCount, 2);
  const rival = setup({ rivalFirst: true });
  rival.list();
  assert.equal(rival.open(RIVAL).spans.find((s) => s.id === 'ext:task_0a1').name, 'api-tests');
});

test('a result cut down to the dispatch id still links; the worker folder names it', () => {
  const idx = setup({ grepped: true });
  const list = idx.list();
  assert.ok(!list.some((s) => s.id === WORKER));
  assert.equal(list.find((s) => s.id === BOT).agentCount, 2);
  const w = idx.open(BOT).spans.find((s) => s.id === 'ext:ctx_0f1');
  assert.deepEqual([w.name, w.orca, w.external, w.status], ['api-tests', true, undefined, 'ok']);
});

test("Orca's branch-name helper folds under its worker; the worker's own title names it", () => {
  const idx = setup({ helper: true, titled: true, grepped: true });
  const list = idx.list();
  assert.ok(!list.some((s) => s.id === HELPER || s.id === WORKER));
  const bot = list.find((s) => s.id === BOT);
  assert.equal(bot.agentCount, 3);
  assert.equal(bot.status, 'ok', 'a finished helper does not keep the bot running');
  const spans = idx.open(BOT).spans;
  assert.equal(spans.find((s) => s.id === 'ext:ctx_0f1').name, 'Login API tests');
  const h = spans.find((s) => s.kind === 'agent' && s.name === 'Branch name');
  assert.deepEqual([h.parentId, h.status], ['ext:ctx_0f1', 'ok']);
});

test('a big record after the last answer does not make a session look busy', () => {
  const root = mkdtempSync(join(tmpdir(), 'ari-tail-'));
  const sid = '00000000-0000-4000-8000-0000000000c7';
  const r = rec(sid, '/Users/dev/app');
  mkdirSync(join(root, '-Users-dev-app'));
  writeFileSync(join(root, '-Users-dev-app', `${sid}.jsonl`), jl([r.user(1, 'name it'), r.done(2),
    { sessionId: sid, type: 'attachment', timestamp: at(2), attachment: { content: 'y'.repeat(40 * 1024) } }]));
  const idx = createIndex({ roots: { claude: [{ path: root }] }, source: 'claude', now: () => Date.now() });
  assert.equal(idx.list()[0].status, 'ok');
});

test('a busy worker keeps its bot running, in the list and the full parse', () => {
  const idx = setup({ busy: true });
  const l = idx.list().find((s) => s.id === BOT);
  const v = idx.open(BOT);
  assert.equal(l.status, 'running');
  assert.equal(v.summary.status, 'running');
  // its own turn ended: still Running, not Background
  assert.equal(l.background, undefined);
  assert.equal(v.summary.background, undefined);
  assert.equal(v.spans.find((s) => s.depth === 0).background, undefined);
  assert.equal(v.spans.find((s) => s.id === 'ext:task_0a1').status, 'running');
});

test('bot folders and dispatch prompts', () => {
  assert.equal(botOf('/Users/dev/.orca/bots/pr-review'), 'pr-review');
  assert.equal(botOf('/Users/dev/.orca/bots/pr-review/sub'), 'pr-review');
  assert.equal(botOf('/Users/dev/orca/workspaces/x'), undefined);
  assert.deepEqual(workerOf({ type: 'user', message: { content: [{ type: 'text', text: PROMPT }] } }), { task: 'task_0a1', dispatch: 'ctx_0f1' });
  assert.equal(workerOf({ type: 'user', message: { content: 'Your task ID is: task_0a1' } }), undefined);
  // Orca's branch-name helper quotes the whole prompt inside its own task: not the worker, a helper for it
  assert.deepEqual(workerOf({ type: 'user', message: { content: `Generate a short git branch name for the task below.\n${PROMPT}` } }), { task: 'task_0a1', dispatch: 'ctx_0f1', helper: true });
  assert.equal(workerOf({ type: 'user', message: { content: `Summarize this.\n${PROMPT}` } }), undefined);
});
