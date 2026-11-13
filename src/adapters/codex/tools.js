// Codex tool calls: function_call / custom_tool_call <-> *_output (call_id),
// plus the 0.166 item_completed overlay for time and status.
//
// Decisions (spec 5.3, 11-4):
// - Older versions carry no structural success signal, so a paired call is
//   status 'unknown'. Output bodies are never parsed for exit codes.
// - item_completed.item.id does not match call_id in real records (4 of 542),
//   so items are linked by time: the unclaimed call whose start is closest to
//   item.started_at_ms, within ITEM_MATCH_MS.
// - A call with no output is 'running' while the session is live and its turn
//   is still open, 'cancelled' if its turn was aborted, otherwise 'unknown'.
import { toolBrandOf } from '../../model/tool-brand.js';
import { toolCategoryOf } from '../../model/tool-category.js';

const ITEM_MATCH_MS = 2000;
// Item types that are not tool executions; they never claim a call.
const NON_TOOL_ITEMS = /^(subagentactivity|agentmessage|usermessage|reasoning|plan|contextcompaction)$/i;
const SHELL_FLAGS = new Set(['-c', '-lc', '-ic', '-ilc', '-cl']);

/** Pull a printable command out of function_call.arguments (JSON string). Output bodies are never read. */
export function commandOf(args) {
  let a = args;
  if (typeof a === 'string') {
    try { a = JSON.parse(a); } catch { return undefined; }
  }
  if (!a || typeof a !== 'object') return undefined;
  const c = a.command ?? a.cmd;
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.every((x) => typeof x === 'string') && c.length) {
    if (c.length >= 3 && SHELL_FLAGS.has(c[1])) return c[2];
    return c.join(' ');
  }
  return undefined;
}

export function createToolTracker({ sessionId, fileId, parentId }) {
  const calls = new Map(); // callId -> record
  const order = [];

  function onCall(lineNo, ts, payload, turnId) {
    const callId = payload.call_id;
    if (typeof callId !== 'string' || calls.has(callId)) return [];
    const name = typeof payload.name === 'string' ? payload.name : 'unknown';
    const rec = {
      callId, name, start: ts, line: lineNo, turnId: turnId ?? null,
      command: commandOf(payload.arguments),
      outputTs: null, closed: null, item: null, last: ts,
    };
    calls.set(callId, rec);
    order.push(rec);
    return [rec];
  }

  function onOutput(ts, payload) {
    const rec = calls.get(payload.call_id);
    if (!rec || rec.outputTs !== null) return [];
    rec.outputTs = ts;
    rec.last = Math.max(rec.last, ts);
    return [rec];
  }

  function onItem(ts, payload) {
    const item = payload.item;
    if (!item || typeof item !== 'object' || typeof item.type !== 'string' || NON_TOOL_ITEMS.test(item.type)) return [];
    const sMs = payload.started_at_ms;
    if (typeof sMs !== 'number') return [];
    let best = null;
    let bestD = Infinity;
    for (const rec of order) {
      if (rec.item) continue;
      const d = Math.abs(rec.start - sMs);
      if (d <= ITEM_MATCH_MS && d < bestD) { best = rec; bestD = d; }
    }
    if (!best) return [];
    const failed = item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0);
    const done = item.status === 'completed' && !failed;
    best.item = {
      start: sMs,
      end: typeof payload.completed_at_ms === 'number' ? payload.completed_at_ms : null,
      status: failed ? 'error' : done ? 'ok' : null,
      error: typeof item.error?.message === 'string' ? item.error.message : null,
    };
    best.last = Math.max(best.last, best.item.end ?? ts, ts);
    return [best];
  }

  /** A turn ended: pending calls of that turn stop being live. */
  function onTurnEnd(turnId, ts, aborted) {
    const changed = [];
    for (const rec of order) {
      if (rec.turnId !== turnId || rec.outputTs !== null || rec.closed) continue;
      rec.closed = { ts, aborted };
      changed.push(rec);
    }
    return changed;
  }

  function render(rec, live) {
    const start = rec.item?.start ?? rec.start;
    let end = rec.item?.end ?? rec.outputTs;
    let status = rec.item?.status;
    if (!status) {
      if (rec.outputTs !== null) status = 'unknown';
      else if (rec.closed?.aborted) status = 'cancelled';
      else if (rec.closed) status = 'unknown';
      else status = live ? 'running' : 'unknown';
    }
    if (end == null && status === 'cancelled') end = rec.closed.ts;
    const isError = status === 'error';
    const span = {
      id: `cx:${sessionId}:${rec.callId}`,
      parentId,
      sessionId,
      source: 'codex',
      kind: 'tool',
      name: rec.name,
      status,
      start,
      end: end ?? null,
      ref: { fileId, line: rec.line },
      toolCategory: toolCategoryOf({ name: rec.name, command: rec.command }),
      lastActivity: Math.max(rec.last, end ?? 0, start),
    };
    const brand = toolBrandOf({ name: rec.name, command: rec.command, isError });
    if (brand) span.toolBrand = brand;
    if (rec.command !== undefined) span.command = rec.command;
    if (rec.item?.error) span.error = { message: rec.item.error };
    return span;
  }

  return { onCall, onOutput, onItem, onTurnEnd, render, records: () => order };
}
