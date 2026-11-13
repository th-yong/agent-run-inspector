#!/usr/bin/env node
// Live-update demo: copies the synthetic fixtures to a temp folder, then writes a synthetic Claude Code session
// into it line by line, so a server started with `--root <that folder>` shows the graph moving.
// Usage: node scripts/replay-fixture.js [--out <dir>] [--speed 1] [--hold 10] [--wait 0]
//   --out    folder to use (default: a new temp folder); its path is printed first
//   --speed  time multiplier (2 = twice as fast)
//   --wait   seconds to wait before the first line (time to open the page)
//   --hold   seconds to keep the process (and the session "live") after the last line
// Only synthetic data is written. Nothing is read from real run logs.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { out: { type: 'string' }, speed: { type: 'string' }, hold: { type: 'string' }, wait: { type: 'string' } } });
const speed = Number(opt.speed ?? 1) || 1;
const waitMs = (Number(opt.wait ?? 0) || 0) * 1000;
const holdMs = (Number(opt.hold ?? 10) || 0) * 1000;

const outRoot = opt.out ?? mkdtempSync(join(tmpdir(), 'ari-replay-'));
const fixtures = fileURLToPath(new URL('../test/fixtures/claude-code/projects', import.meta.url));
cpSync(fixtures, join(outRoot, 'projects'), { recursive: true });
const dir = join(outRoot, 'projects', '-synthetic-live-demo');
const SID = '00000000-0000-4000-8000-0000000000b1';
const sessionFile = join(dir, `${SID}.jsonl`);
mkdirSync(join(dir, SID, 'subagents'), { recursive: true });
console.log(outRoot);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));
const MODEL = 'synthetic-model-a';
const USAGE = { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };
let n = 0;
const uid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;

/** One writer per file: keeps the parent chain and writes each line with the current time. */
function writer(file, agentId) {
  let parent = null;
  const put = (rec) => appendFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), sessionId: SID, ...rec })}\n`);
  const base = (type) => {
    const uuid = uid();
    const rec = { parentUuid: parent, isSidechain: Boolean(agentId), type, uuid, cwd: '/synthetic/live-demo', version: '0.0.0-synthetic', ...(agentId ? { agentId } : {}) };
    parent = uuid;
    return rec;
  };
  return {
    user: (text) => put({ ...base('user'), message: { role: 'user', content: text } }),
    request: (id) => put({ type: 'api-request', id }),
    assistant: (msgId, reqId, content, stop = 'tool_use') => put({
      ...base('assistant'),
      message: { id: msgId, type: 'message', role: 'assistant', model: MODEL, content, stop_reason: stop, usage: USAGE },
      requestRef: reqId,
    }),
    result: (toolId, content, extra = {}) => put({ ...base('user'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content }] }, ...extra }),
  };
}

let seq = 0;
/** A model response that ends in one tool call, then the tool's result `ms` later. */
async function toolCall(w, name, input, ms) {
  const k = ++seq;
  w.request(`req_live_${k}`);
  await sleep(500);
  w.assistant(`msg_live_${k}`, `req_live_${k}`, [{ type: 'tool_use', id: `toolu_live_${k}`, name, input }]);
  await sleep(ms);
  w.result(`toolu_live_${k}`, 'ok');
}

const meta = (id, body) => writeFileSync(join(dir, SID, 'subagents', `agent-${id}.meta.json`), JSON.stringify(body));
const finish = (id, body) => meta(id, { ...body, finished: true });

const main = writer(sessionFile);
const AGENTS = [
  { id: 'alive0000000001', name: 'researcher', task: 'Collect refund rules', calls: 8 },
  { id: 'alive0000000002', name: 'tester', task: 'Run the unit tests', calls: 3 },
  { id: 'alive0000000003', name: 'reviewer', task: 'Review the change', calls: 12 },
];

async function runAgent(a, startDelay) {
  await sleep(startDelay);
  const m = { agentType: 'worker', name: a.name, description: a.task, spawnDepth: 1, toolUseId: `toolu_live_spawn_${a.id}` };
  meta(a.id, m);
  const w = writer(join(dir, SID, 'subagents', `agent-${a.id}.jsonl`), a.id);
  w.user(a.task);
  const tools = ['Read', 'Grep', 'Bash', 'Edit', 'Glob'];
  for (let i = 0; i < a.calls; i++) {
    const name = tools[i % tools.length];
    await toolCall(w, name, name === 'Bash' ? { command: 'npm test -- refund' } : { file_path: `/synthetic/live-demo/src/part-${i}.js` }, 700 + ((i * 370) % 1400));
    await sleep(250);
  }
  w.request(`req_live_end_${a.id}`);
  await sleep(500);
  w.assistant(`msg_live_end_${a.id}`, `req_live_end_${a.id}`, [{ type: 'text', text: `${a.name} done` }], 'end_turn');
  finish(a.id, m);
}

await new Promise((r) => setTimeout(r, waitMs));

// Orchestrator: prompt, one model response that launches the three agents, then a few of its own calls.
writeFileSync(sessionFile, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Live replay demo', sessionId: SID })}\n`);
main.user('Replay a small team of agents');
await sleep(700);
main.request('req_live_main_1');
await sleep(600);
main.assistant('msg_live_main_1', 'req_live_main_1', AGENTS.map((a) => ({
  type: 'tool_use', id: `toolu_live_spawn_${a.id}`, name: 'Agent',
  input: { subagent_type: 'worker', name: a.name, description: a.task, run_in_background: true, prompt: a.task },
})));
for (const a of AGENTS) main.result(`toolu_live_spawn_${a.id}`, 'launched', { toolUseResult: { status: 'async_launched', agentId: a.id, description: a.task } });

await Promise.all([
  runAgent(AGENTS[0], 800),
  runAgent(AGENTS[1], 2200),
  runAgent(AGENTS[2], 4500),
  (async () => {
    await sleep(3000);
    await toolCall(main, 'Read', { file_path: '/synthetic/live-demo/README.md' }, 900);
    await sleep(6000);
    await toolCall(main, 'Bash', { command: 'git status' }, 1100);
  })(),
]);
console.error('replay done');
await new Promise((r) => setTimeout(r, holdMs));
