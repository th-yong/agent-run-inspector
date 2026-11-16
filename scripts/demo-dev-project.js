#!/usr/bin/env node
// README demo: writes a made-up but realistic Claude Code run ("Add rate limiting to the login API" in a
// fictional shop-api project) line by line, so a server started with that folder as its root shows the
// graph moving. An orchestrator starts a planner, then a backend developer and a test writer in parallel,
// then a reviewer; one test run fails before the fix. Two finished sessions fill the list.
// Usage: node scripts/demo-dev-project.js [--out <dir>] [--speed 1] [--wait 0] [--hold 10]
//   --out: Claude Code root to write into (<out>/projects/...); default a new temp folder, printed first.
// Only made-up data is written. Nothing is read from real run logs.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { out: { type: 'string' }, speed: { type: 'string' }, hold: { type: 'string' }, wait: { type: 'string' } } });
const speed = Number(opt.speed ?? 1) || 1;
const waitMs = (Number(opt.wait ?? 0) || 0) * 1000;
const holdMs = (Number(opt.hold ?? 10) || 0) * 1000;
const outRoot = opt.out ?? mkdtempSync(join(tmpdir(), 'ari-demo-'));
const CWD = '/Users/dev/shop-api';
const dir = join(outRoot, 'projects', '-Users-dev-shop-api');
mkdirSync(dir, { recursive: true });
console.log(outRoot);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
let n = 0;
const uid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
let seq = 0;

/** One writer per file: keeps the parent chain and stamps each line with `at()` (now by default). */
function writer(file, sid, { agentId, model, at = () => new Date() } = {}) {
  let parent = null;
  const put = (rec) => appendFileSync(file, `${JSON.stringify({ timestamp: at().toISOString(), sessionId: sid, ...rec })}\n`);
  const base = (type) => {
    const uuid = uid();
    const rec = { parentUuid: parent, isSidechain: Boolean(agentId), type, uuid, cwd: CWD, gitBranch: 'feat/login-rate-limit', version: '2.1.300', ...(agentId ? { agentId } : {}) };
    parent = uuid;
    return rec;
  };
  const usage = (k) => ({ input_tokens: 1200 + (k % 5) * 310, output_tokens: 180 + (k % 7) * 95, cache_read_input_tokens: 18000 + (k % 4) * 6500, cache_creation_input_tokens: k % 6 === 0 ? 2400 : 0 });
  const w = {
    user: (text) => put({ ...base('user'), message: { role: 'user', content: text } }),
    request: (id) => put({ type: 'api-request', id }),
    assistant: (msgId, reqId, content, stop = 'tool_use') => put({
      ...base('assistant'),
      message: { id: msgId, type: 'message', role: 'assistant', model, content, stop_reason: stop, usage: usage(++seq) },
      requestRef: reqId,
    }),
    result: (toolId, content, extra = {}) => put({
      ...base('user'),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content, ...(extra.isError ? { is_error: true } : {}) }] },
      ...(extra.toolUseResult ? { toolUseResult: extra.toolUseResult } : {}),
    }),
    raw: put,
  };
  /** A model response that ends in one tool call, then its result `ms` later. */
  w.call = async (name, input, output, ms, isError = false) => {
    const k = ++seq;
    w.request(`req_${k}`);
    await sleep(450);
    w.assistant(`msg_${k}`, `req_${k}`, [{ type: 'tool_use', id: `toolu_${k}`, name, input }]);
    await sleep(ms);
    w.result(`toolu_${k}`, output, { isError });
  };
  w.answer = async (text) => {
    const k = ++seq;
    w.request(`req_${k}`);
    await sleep(500);
    w.assistant(`msg_${k}`, `req_${k}`, [{ type: 'text', text }], 'end_turn');
  };
  return w;
}

// ---- two finished sessions from earlier days (static) ----
function pastSession(sid, title, daysAgo, steps) {
  const file = join(dir, `${sid}.jsonl`);
  let t = Date.now() - daysAgo * 86400000;
  const w = writer(file, sid, { model: SONNET, at: () => new Date((t += 2300)) });
  writeFileSync(file, '');
  w.raw({ type: 'ai-title', aiTitle: title });
  w.user(title);
  for (const [name, input, output] of steps) {
    const k = ++seq;
    w.assistant(`msg_${k}`, `req_${k}`, [{ type: 'tool_use', id: `toolu_${k}`, name, input }]);
    w.result(`toolu_${k}`, output);
  }
  w.assistant(`msg_end_${sid}`, `req_end_${sid}`, [{ type: 'text', text: 'Done.' }], 'end_turn');
  w.raw({ type: 'system', subtype: 'turn_duration', durationMs: 240000 });
}
pastSession('00000000-0000-4000-8000-00000000d001', 'Fix flaky checkout test', 1, [
  ['Read', { file_path: `${CWD}/test/checkout.test.ts` }, '120 lines'],
  ['Bash', { command: 'npm test -- checkout' }, 'Tests: 9 passed, 9 total'],
  ['Edit', { file_path: `${CWD}/test/checkout.test.ts` }, 'ok'],
]);
pastSession('00000000-0000-4000-8000-00000000d002', 'Upgrade to Node 22', 3, [
  ['Read', { file_path: `${CWD}/package.json` }, '"engines": { "node": ">=20" }'],
  ['Edit', { file_path: `${CWD}/package.json` }, 'ok'],
  ['Bash', { command: 'npm ci && npm test' }, 'Tests: 212 passed, 212 total'],
]);

// ---- the live run ----
const SID = '00000000-0000-4000-8000-00000000d0a1';
const sessionFile = join(dir, `${SID}.jsonl`);
mkdirSync(join(dir, SID, 'subagents'), { recursive: true });
const main = writer(sessionFile, SID, { model: OPUS });
const meta = (a, extra = {}) => writeFileSync(join(dir, SID, 'subagents', `agent-${a.id}.meta.json`), JSON.stringify({
  agentType: a.type, name: a.name, description: a.task, spawnDepth: 1, toolUseId: `toolu_spawn_${a.id}`, model: SONNET, ...extra,
}));

const AGENTS = {
  planner: { id: 'dev0000000000001', name: 'planner', type: 'Explore', task: 'Map the login flow and where to throttle' },
  backend: { id: 'dev0000000000002', name: 'backend-dev', type: 'general-purpose', task: 'Add a rate limiter to POST /api/login' },
  tests: { id: 'dev0000000000003', name: 'test-writer', type: 'general-purpose', task: 'Write tests for the login rate limit' },
  review: { id: 'dev0000000000004', name: 'reviewer', type: 'code-reviewer', task: 'Review the change before the PR' },
};
const R = (p) => `${CWD}/${p}`;
const WORK = {
  planner: [
    ['Grep', { pattern: 'router.post\\(.*/login', path: R('src') }, 'src/routes/auth.ts:42:  router.post("/login", loginHandler);', 900],
    ['Read', { file_path: R('src/routes/auth.ts') }, '118 lines', 600],
    ['Glob', { pattern: 'src/middleware/*.ts' }, 'src/middleware/auth.ts\nsrc/middleware/cors.ts\nsrc/middleware/errors.ts', 500],
    ['Read', { file_path: R('src/config/index.ts') }, '64 lines', 500],
  ],
  backend: [
    ['Read', { file_path: R('src/middleware/auth.ts') }, '71 lines', 500],
    ['Write', { file_path: R('src/middleware/rateLimit.ts') }, 'File created', 900],
    ['Edit', { file_path: R('src/routes/auth.ts') }, 'The file has been updated', 700],
    ['Edit', { file_path: R('src/config/index.ts') }, 'The file has been updated', 600],
    ['Bash', { command: 'npm run typecheck' }, '> tsc --noEmit\n(no errors)', 2600],
    ['Edit', { file_path: R('src/middleware/rateLimit.ts') }, 'The file has been updated', 600],
  ],
  tests: [
    ['Read', { file_path: R('test/auth.test.ts') }, '156 lines', 500],
    ['Write', { file_path: R('test/rateLimit.test.ts') }, 'File created', 1100],
    ['Bash', { command: 'npm test -- rateLimit' }, 'FAIL test/rateLimit.test.ts\n  ✕ blocks the 6th attempt within a minute\n    Expected status 429, received 200\n\nTests: 1 failed, 3 passed, 4 total', 2800, true],
    ['Read', { file_path: R('src/middleware/rateLimit.ts') }, '38 lines', 500],
    ['Bash', { command: 'npm test -- rateLimit' }, 'PASS test/rateLimit.test.ts\n  ✓ allows 5 attempts per minute (14 ms)\n  ✓ blocks the 6th attempt within a minute (9 ms)\n  ✓ resets after the window (11 ms)\n  ✓ counts per IP and username (7 ms)\n\nTests: 4 passed, 4 total', 2600],
  ],
  review: [
    ['Bash', { command: 'git diff --stat' }, ' src/config/index.ts          |  6 +\n src/middleware/rateLimit.ts  | 38 +++++\n src/routes/auth.ts           |  4 +-\n test/rateLimit.test.ts       | 61 ++++++++\n 4 files changed, 107 insertions(+), 2 deletions(-)', 700],
    ['Read', { file_path: R('src/middleware/rateLimit.ts') }, '38 lines', 600],
    ['Grep', { pattern: 'TODO|console.log', path: R('src') }, 'No matches', 500],
    ['Bash', { command: 'npm test' }, 'Tests: 216 passed, 216 total', 3200],
  ],
};

async function runAgent(key) {
  const a = AGENTS[key];
  meta(a);
  const w = writer(join(dir, SID, 'subagents', `agent-${a.id}.jsonl`), SID, { agentId: a.id, model: SONNET });
  w.user(a.task);
  for (const [name, input, output, ms, err] of WORK[key]) {
    await w.call(name, input, output, ms, err);
    await sleep(250);
  }
  await w.answer(`${a.name}: done.`);
  meta(a, { finished: true });
}

async function spawn(keys) {
  const k = ++seq;
  main.request(`req_${k}`);
  await sleep(600);
  main.assistant(`msg_${k}`, `req_${k}`, keys.map((key) => {
    const a = AGENTS[key];
    return { type: 'tool_use', id: `toolu_spawn_${a.id}`, name: 'Agent', input: { subagent_type: a.type, name: a.name, description: a.task, run_in_background: true, prompt: a.task } };
  }));
  for (const key of keys) {
    const a = AGENTS[key];
    main.result(`toolu_spawn_${a.id}`, 'launched', { toolUseResult: { status: 'async_launched', agentId: a.id, description: a.task } });
  }
}

await new Promise((r) => setTimeout(r, waitMs));
writeFileSync(sessionFile, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Add rate limiting to the login API', sessionId: SID })}\n`);
main.user('Add rate limiting to POST /api/login: 5 attempts per minute per IP and username, with tests. Open a PR when it passes.');
await sleep(800);
await main.call('Read', { file_path: R('package.json') }, '"name": "shop-api"', 500);
await spawn(['planner']);
await runAgent('planner');
await spawn(['backend', 'tests']);
await Promise.all([runAgent('backend'), (async () => { await sleep(1500); await runAgent('tests'); })()]);
await spawn(['review']);
await runAgent('review');
await main.call('Bash', { command: 'gh pr create --fill' }, 'https://github.com/example/shop-api/pull/128', 1500);
await main.answer('Opened PR #128: login is limited to 5 attempts per minute per IP and username; 4 new tests pass.');
main.raw({ type: 'system', subtype: 'turn_duration', durationMs: 42000 });
console.error('demo done');
await new Promise((r) => setTimeout(r, holdMs));
