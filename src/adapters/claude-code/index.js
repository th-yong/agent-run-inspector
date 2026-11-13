import { LlmCollector } from './llm.js';

const DEFAULT_RUNNING_MS = 10 * 60 * 1000;

function lastSegment(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? '';
}

/**
 * Incremental parser for one Claude Code main session file.
 * `push(text)` accepts any chunking; only newline-terminated lines are consumed,
 * a trailing fragment waits for the next chunk. Feeding a file whole or in pieces
 * gives the same `snapshot()`.
 */
export class ClaudeCodeSession {
  /**
   * @param {{ fileId: string, sessionId?: string, parentId?: string, now?: number }} opts
   */
  constructor({ fileId, sessionId, parentId, now } = {}) {
    this.fileId = fileId ?? '0';
    this.sessionId = sessionId ?? null;
    this.now = now;
    this.pending = '';
    this.lineNo = 0;
    this.seq = 0;
    this.prevTs = null;
    this.firstTs = null;
    this.lastTs = null;
    this.title = undefined;
    this.cwd = undefined;
    this.branch = undefined;
    this.sessionSeq = 0;
    this.llm = new LlmCollector({
      sessionId: this.sessionId,
      fileId: this.fileId,
      parentId: parentId ?? this.sessionId,
      nextSeq: () => ++this.seq,
    });
    this.parentIdOverride = parentId;
  }

  push(chunk) {
    this.pending += chunk;
    let nl;
    while ((nl = this.pending.indexOf('\n')) !== -1) {
      const text = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      this.lineNo++;
      this.#line(text, this.lineNo);
    }
  }

  #line(text, line) {
    if (!text.trim()) return;
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      return; // cut or damaged line
    }
    if (!rec || typeof rec !== 'object') return;
    const t = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    const ts = Number.isFinite(t) ? t : null;

    if (this.sessionId === null && typeof rec.sessionId === 'string') {
      this.sessionId = rec.sessionId;
      this.llm.ctx.sessionId = rec.sessionId;
      if (this.parentIdOverride === undefined) this.llm.ctx.parentId = rec.sessionId;
    }
    if (typeof rec.cwd === 'string' && rec.cwd) this.cwd = rec.cwd;
    if (typeof rec.gitBranch === 'string' && rec.gitBranch) this.branch = rec.gitBranch;

    switch (rec.type) {
      case 'ai-title':
        if (typeof rec.aiTitle === 'string' && rec.aiTitle) {
          this.title = rec.aiTitle;
          this.sessionSeq = ++this.seq;
        }
        break;
      case 'api-request':
        this.llm.onApiRequest(rec, ts);
        break;
      case 'assistant':
        this.llm.onAssistant(rec, ts, line, this.prevTs);
        break;
      default:
        break; // other kinds are handled by later tasks or skipped
    }
    if (ts !== null) {
      this.prevTs = ts;
      this.firstTs ??= ts;
      this.lastTs = this.lastTs === null ? ts : Math.max(this.lastTs, ts);
    }
  }

  /** @returns {import('../../model/types.js').RunSpan} */
  #sessionSpan(children) {
    const project = this.cwd ? lastSegment(this.cwd) : '';
    const start = this.firstTs ?? 0;
    const end = this.lastTs ?? start;
    const now = this.now ?? Date.now();
    const running = now - end < DEFAULT_RUNNING_MS && now >= end;
    const status = children.some((s) => s.status === 'running') || running ? 'running' : 'ok';
    return {
      id: this.sessionId ?? '',
      parentId: null,
      sessionId: this.sessionId ?? '',
      source: 'claude-code',
      kind: 'session',
      name: this.title ?? (project || 'Untitled session'),
      status,
      start,
      end: status === 'running' ? null : end,
      ref: { fileId: this.fileId, line: 1 },
      lastActivity: end,
      seq: Math.max(this.sessionSeq, ...children.map((s) => s.seq), 0),
    };
  }

  /**
   * @returns {{ session: { id: string|null, title?: string, project: string, cwd?: string, branch?: string },
   *   spans: import('../../model/types.js').RunSpan[] }}
   */
  snapshot() {
    const children = this.llm.spans();
    return {
      session: {
        id: this.sessionId,
        ...(this.title !== undefined ? { title: this.title } : {}),
        project: this.cwd ? lastSegment(this.cwd) : '',
        ...(this.cwd !== undefined ? { cwd: this.cwd } : {}),
        ...(this.branch !== undefined ? { branch: this.branch } : {}),
      },
      spans: [this.#sessionSpan(children), ...children],
    };
  }
}

/** Parse a whole file's text in one go. */
export function parseSessionText(text, opts) {
  const s = new ClaudeCodeSession(opts);
  s.push(text);
  return s.snapshot();
}
