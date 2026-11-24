// Orca (a multi-agent IDE) bots and dispatched workers, as seen in Claude Code logs. All Orca-specific
// rules live here so a format change is one edit. Only ids and names are taken from prompts and results.
//  - A bot is a long-lived session whose cwd is `~/.orca/bots/<slug>`.
//  - A coordinator (a bot or any session) starts workers with `orca orchestration worker-start`; that
//    Bash call's result prints `dispatchId=ctx_… taskId=task_…` per worker.
//  - A worker's own file opens with Orca's dispatch prompt, which names its task id.
// A session that only quotes these strings (a tool output, a pasted log) claims nothing: the ids count
// only from a worker-start call's own result, or from a file's first user message.

const BOT_CWD = /[\\/]\.orca[\\/]bots[\\/]([^\\/]+)(?:[\\/]|$)/; // its folder or one below
const WORKER_START = /\borchestration\s+worker-start\b/;
// one line per worker: `dispatchId=ctx_… taskId=task_… … workspace=<id>::<path>`
const DISPATCHED = /\bdispatchId=(ctx_[0-9a-z]+)\s+taskId=(task_[0-9a-z]+)(?:[^\n]*?\sworkspace=\S*::(\S+))?/g;
const WORKER_PROMPT = 'You are a dispatched worker';
const PROMPT_START = 'You are working inside Orca'; // the prompt opens the message; helpers that quote it do not
const TASK_LINE = /Your task ID is:\s*(task_[0-9a-z]+)/;
const flag = (name) => new RegExp(`--${name}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`);
const NAME_FLAG = flag('name');
const TITLE_FLAG = flag('task-title');
const valueOf = (m) => (m ? m[1] ?? m[2] ?? m[3] : undefined);

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '');

/** The bot's slug when `cwd` is an Orca bot's home folder, else undefined. */
export const botOf = (cwd) => (typeof cwd === 'string' ? BOT_CWD.exec(cwd)?.[1] : undefined);

/** The task id when this user record is Orca's dispatch prompt (call it on a file's first user record only). */
export function workerTaskOf(rec) {
  if (rec?.type !== 'user') return undefined;
  const t = textOf(rec.message?.content).trimStart();
  return t.startsWith(PROMPT_START) && t.includes(WORKER_PROMPT) ? TASK_LINE.exec(t)?.[1] : undefined;
}

/** Workers a file started: feed records in order; `tasks` maps task id -> { name, task, start, line }. */
export class OrcaDispatches {
  constructor() {
    this.calls = new Map(); // worker-start tool_use id -> { name, start, line }
    this.tasks = new Map();
  }

  onAssistant(rec, ts, line) {
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      const cmd = b?.type === 'tool_use' && b.name === 'Bash' ? b.input?.command : undefined;
      if (typeof cmd !== 'string' || !WORKER_START.test(cmd)) continue;
      this.calls.set(b.id, { name: valueOf(NAME_FLAG.exec(cmd)), task: valueOf(TITLE_FLAG.exec(cmd)), start: ts ?? 0, line });
    }
  }

  onUser(rec) {
    const content = rec.message?.content;
    if (!this.calls.size || !Array.isArray(content)) return;
    for (const b of content) {
      const call = b?.type === 'tool_result' ? this.calls.get(b.tool_use_id) : undefined;
      if (!call) continue;
      // one call can start several workers (a shell loop): each result line names one
      for (const m of textOf(b.content).matchAll(DISPATCHED)) {
        // no --name: the worker's workspace folder names it
        const folder = m[3]?.split(/[\\/]/).filter(Boolean).at(-1);
        if (!this.tasks.has(m[2])) this.tasks.set(m[2], { ...call, name: call.name ?? folder });
      }
    }
  }
}

/** Raw-byte prefilter for lines worth parsing with OrcaDispatches. */
export const DISPATCH_MARKS = [Buffer.from('worker-start'), Buffer.from('taskId=task_')];
export const WORKER_MARK = Buffer.from(WORKER_PROMPT);
/** Worker files are started by Orca, not the claude CLI: their head says so (prefilter for a wider read). */
export const WORKER_HEAD_MARKS = ['"entrypoint":"orca"', '"entrypoint":"sdk-cli"'].map((s) => Buffer.from(s));
