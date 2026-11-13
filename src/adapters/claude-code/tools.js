import { toolBrandOf, isShellTool } from '../../model/tool-brand.js';
import { toolCategoryOf } from '../../model/tool-category.js';
import { MSG } from '../../strings.js';

// Sub-agent launches become agent spans (T11), not tool spans.
export const AGENT_TOOLS = new Set(['agent', 'task']);

/**
 * Pairs tool_use / server_tool_use blocks with their results (tool_use_id) into tool spans.
 * Result bodies are never read: only the ids, flags and timestamps.
 */
export class ToolCollector {
  /**
   * @param {{ sessionId: string, fileId: string, parentId: string, nextSeq: () => number }} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.tools = new Map(); // tool_use id -> record
    this.orphans = new Map(); // result seen before its call
  }

  /** Called for assistant lines: opens tools and picks up server tool results. */
  onAssistant(rec, ts, line) {
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!b || typeof b !== 'object' || typeof b.id !== 'string' && typeof b.tool_use_id !== 'string') continue;
      if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        this.#open(b, ts, line);
      } else if (typeof b.type === 'string' && b.type.endsWith('_tool_result')) {
        this.#close(b.tool_use_id, ts, { isError: false, interrupted: false });
      }
    }
  }

  /** Called for user lines: tool_result blocks close their tools. */
  onUser(rec, ts) {
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    const interrupted = rec.toolUseResult?.interrupted === true;
    for (const b of content) {
      if (!b || b.type !== 'tool_result') continue;
      this.#close(b.tool_use_id, ts, { isError: b.is_error === true, interrupted });
    }
  }

  #open(b, ts, line) {
    if (typeof b.id !== 'string' || typeof b.name !== 'string') return;
    if (AGENT_TOOLS.has(b.name.toLowerCase())) return;
    if (this.tools.has(b.id)) return; // repeated lines of one message.id
    const command = isShellTool(b.name) && typeof b.input?.command === 'string' ? b.input.command : undefined;
    const t = { id: b.id, name: b.name, command, start: ts, line, closed: false, seq: this.ctx.nextSeq() };
    this.tools.set(b.id, t);
    const early = this.orphans.get(b.id);
    if (early) {
      this.orphans.delete(b.id);
      this.#apply(t, early.ts, early.res);
    }
  }

  #close(id, ts, res) {
    if (typeof id !== 'string') return;
    const t = this.tools.get(id);
    if (t) this.#apply(t, ts, res);
    else this.orphans.set(id, { ts, res });
  }

  #apply(t, ts, res) {
    if (t.closed) return;
    t.closed = true;
    t.end = ts;
    t.isError = res.isError;
    t.interrupted = res.interrupted;
    t.seq = this.ctx.nextSeq();
  }

  /**
   * @param {{ lastTs: number | null, now: number }} clock lastTs = newest line time of the file
   * @returns {import('../../model/types.js').RunSpan[]}
   */
  spans({ lastTs, now }) {
    const live = lastTs !== null && now >= lastTs && now - lastTs < 10 * 60 * 1000;
    const out = [];
    for (const t of this.tools.values()) {
      const start = t.start ?? t.end ?? 0;
      const open = !t.closed;
      let status;
      if (open) status = live ? 'running' : 'unknown';
      else if (t.interrupted) status = 'cancelled';
      else if (t.isError) status = 'error';
      else status = 'ok';
      const end = open ? null : (t.end ?? start);
      const isError = status === 'error';
      const brand = toolBrandOf({ name: t.name, command: t.command, isError });
      out.push({
        id: `tool:${t.id}`,
        parentId: this.ctx.parentId,
        sessionId: this.ctx.sessionId,
        source: 'claude-code',
        kind: 'tool',
        name: t.name,
        status,
        start,
        end,
        ...(isError ? { error: { message: MSG.toolFailed } } : {}),
        ref: { fileId: this.ctx.fileId, line: t.line },
        toolCategory: toolCategoryOf({ name: t.name, command: t.command }),
        ...(brand ? { toolBrand: brand } : {}),
        ...(t.command !== undefined ? { command: t.command } : {}),
        lastActivity: end ?? start,
        seq: t.seq,
      });
    }
    return out;
  }
}
