import { LlmCollector } from './llm.js';
import { ToolCollector } from './tools.js';
import { AgentCollector } from './agents.js';
import { providerOf } from '../../model/provider.js';
import { MSG } from '../../strings.js';

const DEFAULT_RUNNING_MS = 10 * 60 * 1000;
/** stop_reason values of an answer that hands the turn back to the user. */
export const ENDS_TURN = new Set(['end_turn', 'stop_sequence']);

/** Id of the root agent span under the session span (Codex: `cx:<sid>:main`). */
export const rootAgentId = (sessionId) => `${sessionId}:main`;

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
   * @param {{ fileId: string, sessionId?: string, parentId?: string, depth?: number, now?: number }} opts
   */
  constructor({ fileId, sessionId, parentId, depth, now } = {}) {
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
    // The last turn closed and nothing came after it: the model's final answer (stop_reason end_turn)
    // or system/turn_duration (not written for every turn).
    this.turnEnded = false;
    this.cwd = undefined;
    this.branch = undefined;
    this.sessionSeq = 0;
    this.llm = new LlmCollector({
      sessionId: this.sessionId,
      fileId: this.fileId,
      parentId: parentId ?? (this.sessionId ? rootAgentId(this.sessionId) : undefined),
      depth: depth ?? 0,
      nextSeq: () => ++this.seq,
    });
    this.tools = new ToolCollector(this.llm.ctx);
    this.agents = new AgentCollector(this.llm.ctx);
    this.markers = [];
    this.turns = [];
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
      if (this.parentIdOverride === undefined) this.llm.ctx.parentId = rootAgentId(rec.sessionId);
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
        this.turnEnded = ENDS_TURN.has(rec.message?.stop_reason);
        this.llm.onAssistant(rec, ts, line, this.prevTs);
        this.tools.onAssistant(rec, ts, line);
        this.agents.onAssistant(rec, ts, line);
        break;
      case 'user':
        this.turnEnded = false;
        this.tools.onUser(rec, ts);
        this.agents.onUser(rec, ts);
        break;
      case 'system':
        this.#system(rec, ts, line);
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

  #system(rec, ts, line) {
    if (ts === null) return;
    if (rec.subtype === 'compact_boundary') {
      const m = rec.compactMetadata ?? {};
      this.markers.push({
        kind: 'compact',
        ts,
        ...(Number.isFinite(m.preTokens) ? { preTokens: m.preTokens } : {}),
        ...(Number.isFinite(m.postTokens) ? { postTokens: m.postTokens } : {}),
        ref: { fileId: this.fileId, line },
      });
    } else if (rec.subtype === 'turn_duration' && Number.isFinite(rec.durationMs)) {
      this.turns.push({ ts, durationMs: rec.durationMs }); // reference value only
    }
    if (rec.subtype === 'turn_duration') this.turnEnded = true; // the agent waits for the user now
  }

  /** @returns {import('../../model/types.js').RunSpan[]} */
  #sessionSpan(children) {
    const project = this.cwd ? lastSegment(this.cwd) : '';
    const start = this.firstTs ?? 0;
    const end = this.lastTs ?? start;
    const now = this.now ?? Date.now();
    // Recent writes mean running, unless the last turn has ended (waiting for the user).
    const running = !this.turnEnded && now - end < DEFAULT_RUNNING_MS && now >= end;
    const status = children.some((s) => s.status === 'running') || running ? 'running' : 'ok';
    return {
      id: this.sessionId ?? '',
      parentId: null,
      sessionId: this.sessionId ?? '',
      source: 'claude-code',
      kind: 'session',
      name: this.title ?? (project || MSG.untitledSession),
      status,
      start,
      end: status === 'running' ? null : end,
      ref: { fileId: this.fileId, line: 1 },
      lastActivity: end,
      seq: Math.max(this.sessionSeq, ...children.map((s) => s.seq), 0),
    };
  }

  /** The main thread's own agent span: depth 0, parent of everything the main file does. */
  #rootAgent(session) {
    const model = this.llm.lastModel();
    return {
      id: rootAgentId(this.sessionId ?? ''),
      parentId: session.id,
      sessionId: session.sessionId,
      source: 'claude-code',
      kind: 'agent',
      name: model ?? MSG.mainAgent,
      status: session.status,
      start: session.start,
      end: session.end,
      ref: session.ref,
      depth: 0,
      role: 'orchestrator',
      ...(model ? { model, provider: providerOf(model) } : {}),
      lastActivity: session.lastActivity,
      seq: session.seq,
    };
  }

  /**
   * llm, tool and agent spans of this file (no session / root agent).
   * @param {import('./agents.js').AgentLookup} [lookup] sub-agent files, to link and to time agent spans
   */
  childSpans(lookup) {
    const now = this.now ?? Date.now();
    const clock = { lastTs: this.lastTs, now };
    return [...this.llm.spans(), ...this.tools.spans(clock), ...this.agents.spans({ ...clock, lookup })];
  }

  /**
   * @param {{ children?: import('../../model/types.js').RunSpan[] }} [opts]
   *   children: precomputed spans for the whole tree (see buildSessionTree); default = this file only
   * @returns {{ session: { id: string|null, title?: string, project: string, cwd?: string, branch?: string },
   *   spans: import('../../model/types.js').RunSpan[] }}
   */
  snapshot({ children } = {}) {
    const kids = children ?? this.childSpans();
    const session = this.#sessionSpan(kids);
    return {
      session: {
        id: this.sessionId,
        ...(this.title !== undefined ? { title: this.title } : {}),
        project: this.cwd ? lastSegment(this.cwd) : '',
        ...(this.cwd !== undefined ? { cwd: this.cwd } : {}),
        ...(this.branch !== undefined ? { branch: this.branch } : {}),
      },
      markers: this.markers.slice(),
      turns: this.turns.slice(),
      spans: [session, this.#rootAgent(session), ...kids],
    };
  }
}

/** Parse a whole file's text in one go. */
export function parseSessionText(text, opts) {
  const s = new ClaudeCodeSession(opts);
  s.push(text);
  return s.snapshot();
}
