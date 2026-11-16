// Codex rollout adapter: incremental, line-at-a-time parser (T21 tail reuses it).
// Input: (lineNo, parsed line). Output: the RunSpans added or changed by that line.
// Unknown line types are skipped silently. Hangul-free: UI text lives in strings.js.
import { basename } from 'node:path';
import { MSG } from '../../strings.js';
import { createToolTracker } from './tools.js';
import { createLlmTracker } from './llm.js';

export const RECENT_MS = 10 * 60 * 1000;

const ts = (o, fallback) => {
  const t = typeof o?.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  return Number.isNaN(t) ? fallback : t;
};

/**
 * @param {{ fileId: string, now?: () => number }} opts
 */
export function createCodexParser({ fileId, now = Date.now }) {
  let sessionId = null;
  let unknownFormat = false;
  let meta = null;           // session_meta payload
  let startTs = null;
  let lastTs = 0;
  let currentModel = null;
  let currentTurn = null;    // open turn id
  const turns = new Map();   // turnId -> band
  const models = [];
  let tracker = null;
  let llm = null;
  const emitted = new Map(); // span id -> JSON of last emitted
  let first = true;
  const activities = []; // SubAgentActivity items: { kind, agentThreadId, ts }

  const sessionSpanId = () => `cx:${sessionId}`;
  const agentSpanId = () => `cx:${sessionId}:main`;
  const live = () => now() - lastTs <= RECENT_MS;
  // The last turn closed (task_complete / turn_aborted): waiting for the user, not running.
  const turnEnded = () => [...turns.values()].at(-1)?.status != null;

  function turnList() {
    const isLive = live();
    return [...turns.values()].map((t) => ({
      ...t,
      status: t.status ?? (isLive ? 'running' : 'unknown'),
    }));
  }

  // A file with no parsable line never reaches push(), so it looks like an unknown format too.
  const unknown = () => unknownFormat || !meta;

  function sessionSpan() {
    if (unknown()) {
      const id = `cx:unknown:${fileId}`;
      return {
        id, parentId: null, sessionId: id, source: 'codex', kind: 'session', name: MSG.unknownFormat,
        status: 'unknown', start: startTs ?? 0, end: null, ref: { fileId, line: 1 }, lastActivity: startTs ?? 0,
      };
    }
    const list = turnList();
    const lastTurn = list.at(-1);
    let status;
    if (live() && !turnEnded()) status = 'running';
    else if (lastTurn?.status === 'cancelled') status = 'cancelled';
    else if (lastTurn?.status === 'ok') status = 'ok';
    else status = 'unknown';
    const s = {
      id: sessionSpanId(), parentId: null, sessionId, source: 'codex', kind: 'session',
      name: meta?.cwd ? basename(meta.cwd) : MSG.codexSession,
      status, start: startTs, end: status === 'running' ? null : lastTs,
      ref: { fileId, line: 1 }, lastActivity: lastTs,
    };
    if (currentModel) s.model = currentModel;
    return s;
  }

  function agentSpan() {
    return {
      id: agentSpanId(), parentId: sessionSpanId(), sessionId, source: 'codex', kind: 'agent',
      name: currentModel ?? MSG.codexSession,
      status: live() && !turnEnded() ? 'running' : ([...turns.values()].at(-1)?.status ?? 'unknown'),
      start: startTs, end: null, ref: { fileId, line: 1 }, depth: 0, lastActivity: lastTs,
      ...(currentModel ? { model: currentModel } : {}),
    };
  }

  function allSpans() {
    if (unknown()) return [sessionSpan()];
    const isLive = live();
    const out = [sessionSpan(), agentSpan()];
    out.push(...llm.spans());
    for (const rec of tracker.records()) out.push(tracker.render(rec, isLive && !rec.closed));
    return out;
  }

  function diff(candidates) {
    const out = [];
    for (const s of candidates) {
      const j = JSON.stringify(s);
      if (emitted.get(s.id) !== j) { emitted.set(s.id, j); out.push(JSON.parse(j)); }
    }
    return out;
  }

  /** Spans added or changed by this line. */
  function push(lineNo, obj) {
    if (first) {
      first = false;
      if (obj?.type !== 'session_meta' || typeof obj.payload?.id !== 'string') {
        unknownFormat = true;
        startTs = ts(obj, 0);
        lastTs = startTs;
        return diff([sessionSpan()]);
      }
      meta = obj.payload;
      sessionId = meta.id;
      startTs = Date.parse(meta.timestamp);
      if (Number.isNaN(startTs)) startTs = ts(obj, 0);
      lastTs = startTs;
      tracker = createToolTracker({ sessionId, fileId, parentId: agentSpanId() });
      llm = createLlmTracker({ sessionId, fileId, parentId: agentSpanId(), startTs });
      return diff(allSpans());
    }
    if (unknownFormat || !obj || typeof obj !== 'object') return [];
    const t = ts(obj, lastTs);
    lastTs = Math.max(lastTs, t);
    const p = obj.payload;
    if (!p || typeof p !== 'object') return diff(allSpans());

    if (obj.type === 'turn_context') {
      if (typeof p.model === 'string') {
        currentModel = p.model;
        if (!models.includes(p.model)) models.push(p.model);
        const band = turns.get(p.turn_id);
        if (band) band.model = p.model;
      }
    } else if (obj.type === 'event_msg') {
      switch (p.type) {
        case 'task_started':
          currentTurn = p.turn_id;
          turns.set(p.turn_id, { turnId: p.turn_id, start: t, end: null, status: null });
          break;
        case 'task_complete':
        case 'turn_aborted': {
          const aborted = p.type === 'turn_aborted';
          const band = turns.get(p.turn_id);
          if (band) {
            band.end = t;
            band.status = aborted ? 'cancelled' : 'ok';
            if (aborted && typeof p.reason === 'string') band.reason = p.reason;
          }
          tracker.onTurnEnd(p.turn_id, t, aborted);
          if (currentTurn === p.turn_id) currentTurn = null;
          break;
        }
        case 'user_message':
          llm.onInput(t);
          break;
        case 'token_count':
          llm.onTokenCount(lineNo, t, p, currentModel);
          break;
        case 'item_completed':
          tracker.onItem(t, p);
          if (/^subagentactivity$/i.test(p.item?.type) && typeof p.item.agent_thread_id === 'string') {
            activities.push({ kind: p.item.kind, agentThreadId: p.item.agent_thread_id, ts: t });
          }
          break;
        default:
      }
    } else if (obj.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') llm.onInput(t);
      else if (p.type === 'function_call' || p.type === 'custom_tool_call') tracker.onCall(lineNo, t, p, currentTurn);
      else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        llm.onInput(t);
        tracker.onOutput(t, p);
      }
    } else if (obj.type === 'token_usage_record') {
      llm.onRecord(lineNo, t, p, currentModel);
    }
    return diff(allSpans());
  }

  const spawnInfo = () => meta?.source?.subagent?.thread_spawn;

  return {
    push,
    /** Current full state, in stable order. */
    spans: () => allSpans(),
    /** Turn bands for the time axis (not spans). */
    turns: turnList,
    /** spawn_agent calls of this session (agents.js pairs them with child rollouts). */
    spawns: () => (tracker ? tracker.records().filter((r) => r.name === 'spawn_agent') : []),
    activities: () => activities,
    meta: () => (unknown() ? null : {
      id: sessionId, cwd: meta.cwd, cliVersion: meta.cli_version, provider: meta.model_provider,
      branch: meta.git?.branch, models: [...models],
      parentThreadId: meta.parent_thread_id ?? spawnInfo()?.parent_thread_id,
      nickname: meta.agent_nickname ?? spawnInfo()?.agent_nickname,
      role: meta.agent_role ?? spawnInfo()?.agent_role,
    }),
  };
}

/** Feed already-parsed lines (null for an unparsable line) in order; returns the final spans. */
export function parseLines(fileId, lines, opts = {}) {
  const p = createCodexParser({ fileId, ...opts });
  lines.forEach((o, i) => p.push(i + 1, o));
  return p;
}

/** Parse rollout text; lines that are not valid JSON become null and are skipped. */
export function parseRolloutText(fileId, text, opts = {}) {
  const lines = text.split('\n').filter((l) => l.length > 0).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  });
  return parseLines(fileId, lines, opts);
}
