// Orca (a multi-agent IDE) bots and dispatched workers, as seen in Claude Code logs. All Orca-specific
// rules live here so a format change is one edit. Only ids and names are taken from prompts and results.
//  - A bot is a long-lived session whose cwd is `~/.orca/bots/<slug>`.
//  - A coordinator (a bot or any session) starts workers with `orca orchestration worker-start`; that
//    Bash call's result prints `dispatchId=ctx_… taskId=task_…` per worker (bots often grep it down to
//    the dispatch id alone).
//  - A worker's own file opens with Orca's dispatch prompt, which names its task and dispatch ids.
// A session that only quotes these strings (a tool output, a pasted log) claims nothing: the ids count
// only from a worker-start call's own result, or from a file's first user message.

const BOT_CWD = /[\\/]\.orca[\\/]bots[\\/]([^\\/]+)(?:[\\/]|$)/; // its folder or one below
const WORKER_START = /\borchestration\s+worker-start\b/;
// one line per worker: `dispatchId=ctx_… taskId=task_… … workspace=<id>::<path>`, or only `dispatchId=ctx_…`
const DISPATCHED = /\bdispatchId=(ctx_[0-9a-z]+)(?:\s+taskId=(task_[0-9a-z]+))?(?:[^\n]*?\sworkspace=\S*::(\S+))?/g;
const WORKER_PROMPT = 'You are a dispatched worker';
const PROMPT_START = 'You are working inside Orca'; // the prompt opens the message; helpers that quote it do not
const HELPER_START = 'Generate a short git branch name'; // Orca's one-shot helper that names a worker's branch
const TASK_LINE = /Your task ID is:\s*(task_[0-9a-z]+)/;
const DISPATCH_FLAG = /--dispatch-id\s+(ctx_[0-9a-z]+)/;
const flag = (name) => new RegExp(`--${name}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`);
const NAME_FLAG = flag('name');
const TITLE_FLAG = flag('task-title');
const valueOf = (m) => (m ? m[1] ?? m[2] ?? m[3] : undefined);

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '');

/** The bot's slug when `cwd` is an Orca bot's home folder, else undefined. */
export const botOf = (cwd) => (typeof cwd === 'string' ? BOT_CWD.exec(cwd)?.[1] : undefined);
/** The bot's slug from Claude Code's project folder name (`-Users-me--orca-bots-<slug>`), for a file with no cwd. */
export const botOfProject = (dir) => (typeof dir === 'string' ? /--orca-bots-(.+)$/.exec(dir)?.[1] : undefined);

// Orca names each run of a bot with a `custom-title` record (its first line): "Home" for a chat, and its own
// scheduled runs "Look around" (a short read-only pass that suggests next steps) and "Tidy-up" (memory upkeep).
const ROUTINES = new Set(['Look around', 'Tidy-up']);
/** The run's name when it is one of a bot's routine runs, from the file's first records, else undefined. */
export const routineOf = (head) => {
  const t = head.find((r) => r?.type === 'custom-title')?.customTitle;
  return ROUTINES.has(t) ? t : undefined;
};

/** { task, dispatch } when this user record is Orca's dispatch prompt (call it on a file's first user record
 *  only); with `helper: true` when it is Orca's branch-name helper quoting that prompt. */
export function workerOf(rec) {
  if (rec?.type !== 'user') return undefined;
  const t = textOf(rec.message?.content).trimStart();
  // the helper quotes a shortened prompt: the task id, not always the worker line or the dispatch id
  const helper = t.startsWith(HELPER_START) && t.includes(PROMPT_START);
  const task = helper || (t.startsWith(PROMPT_START) && t.includes(WORKER_PROMPT)) ? TASK_LINE.exec(t)?.[1] : undefined;
  return task ? { task, dispatch: DISPATCH_FLAG.exec(t)?.[1], ...(helper ? { helper } : {}) } : undefined;
}

/** Workers a file started: feed records in order; `tasks` maps task id (dispatch id when the result shows
 *  only that) -> { name, task, start, line }. */
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
        // no --name: the worker's own title names it, else its workspace folder (see agents.js)
        const folder = m[3]?.split(/[\\/]/).filter(Boolean).at(-1);
        const key = m[2] ?? m[1];
        if (!this.tasks.has(key)) this.tasks.set(key, { ...call, ...(folder ? { folder } : {}) });
      }
    }
  }
}

/** Raw-byte prefilter for lines worth parsing with OrcaDispatches. */
export const DISPATCH_MARKS = [Buffer.from('worker-start'), Buffer.from('dispatchId=ctx_')];
export const WORKER_MARKS = [Buffer.from(WORKER_PROMPT), Buffer.from(HELPER_START)];
/** Worker files are started by Orca, not the claude CLI: their head says so (prefilter for a wider read). */
export const WORKER_HEAD_MARKS = ['"entrypoint":"orca"', '"entrypoint":"sdk-cli"'].map((s) => Buffer.from(s));
