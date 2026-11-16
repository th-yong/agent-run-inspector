import { providerOf } from '../../model/provider.js';
import { ClaudeCodeSession } from './index.js';
import { AGENT_TOOLS } from './tools.js';
import { MSG } from '../../strings.js';

const RECENT_MS = 10 * 60 * 1000;

const str = (v) => (typeof v === 'string' && v ? v : undefined);
const isLive = (last, now) => last !== null && last !== undefined && now >= last && now - last < RECENT_MS;

export const agentSpanId = (toolUseId) => `ag:${toolUseId}`;
export const externalSpanId = (key) => `ext:${key}`;
export const orphanSpanId = (agentId) => `ag:file:${agentId}`;

/**
 * Turns Agent/Task tool_use blocks (and their results) into agent spans.
 * One collector per file; it only ever reads ids, flags, short names and timestamps,
 * never prompts or result bodies. Sub-agent files get linked through `lookup`.
 */
export class AgentCollector {
  /** @param {{ sessionId: string, fileId: string, parentId: string, depth: number, nextSeq: () => number }} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.calls = new Map(); // tool_use id -> call
    this.orphans = new Map(); // result seen before its call
    this.notes = []; // task-notification lines: { ts, text } (matched against ids only)
  }

  onAssistant(rec, ts, line) {
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string') continue;
      if (!AGENT_TOOLS.has(b.name.toLowerCase()) || this.calls.has(b.id)) continue;
      const i = b.input && typeof b.input === 'object' ? b.input : {};
      const c = {
        id: b.id,
        start: ts ?? 0,
        line,
        name: str(i.name),
        agentType: str(i.subagent_type),
        task: str(i.description),
        model: str(i.model),
        team: str(i.team_name),
        closed: false,
        seq: this.ctx.nextSeq(),
      };
      this.calls.set(b.id, c);
      const early = this.orphans.get(b.id);
      if (early) {
        this.orphans.delete(b.id);
        this.#apply(c, early);
      }
    }
  }

  onUser(rec, ts) {
    if (rec.origin?.kind === 'task-notification' && ts !== null) {
      const m = rec.message?.content;
      const text = typeof m === 'string' ? m : Array.isArray(m) ? m.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('\n') : '';
      this.notes.push({ ts, text });
      return;
    }
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    const blocks = content.filter((b) => b && b.type === 'tool_result' && typeof b.tool_use_id === 'string');
    const tur = rec.toolUseResult && typeof rec.toolUseResult === 'object' && blocks.length === 1 ? rec.toolUseResult : {};
    for (const b of blocks) {
      const res = {
        ts,
        isError: b.is_error === true,
        interrupted: rec.toolUseResult?.interrupted === true,
        status: str(tur.status),
        agentId: str(tur.agentId),
        teammateId: str(tur.teammate_id),
        teamName: str(tur.team_name),
      };
      const c = this.calls.get(b.tool_use_id);
      if (c) this.#apply(c, res);
      else this.orphans.set(b.tool_use_id, res);
    }
  }

  #apply(c, res) {
    if (c.closed) return;
    c.closed = true;
    Object.assign(c, { resultTs: res.ts, isError: res.isError, interrupted: res.interrupted, status: res.status, agentId: res.agentId, teammateId: res.teammateId, teamName: res.teamName });
    c.seq = this.ctx.nextSeq();
  }

  /** Agent ids and tool_use ids this file launched (for linking sub-agent files). */
  agentIds() {
    return [...this.calls.values()].map((c) => ({ toolUseId: c.id, agentId: c.agentId }));
  }

  /**
   * @param {{ lastTs: number | null, now: number, lookup?: AgentLookup }} clock
   * @returns {import('../../model/types.js').RunSpan[]}
   */
  spans({ lastTs, now, lookup }) {
    const out = [];
    const base = { parentId: this.ctx.parentId, sessionId: this.ctx.sessionId, source: 'claude-code', kind: 'agent' };
    // the same teammate spawned again: only the latest call keeps the ext:<key> node
    const lastSpawn = new Map();
    for (const c of this.calls.values()) if (c.status === 'teammate_spawned') lastSpawn.set(c.teammateId ?? c.id, c);
    for (const c of this.calls.values()) {
      if (c.status === 'teammate_spawned' && lastSpawn.get(c.teammateId ?? c.id) !== c) continue;
      const ref = { fileId: this.ctx.fileId, line: c.line };
      if (c.status === 'teammate_spawned') {
        const key = c.teammateId ?? c.id;
        const mate = lookup?.find(undefined, key);
        if (mate?.mate) {
          mate.claimed = true;
          const last = mate.mtime ?? mate.lastTs;
          const live = isLive(last, now);
          const end = live ? null : (mate.lastTs ?? c.start);
          const model = c.model ?? mate.model;
          out.push({
            ...base, id: externalSpanId(key), name: c.name ?? key.split('@')[0], status: live ? 'running' : 'ok',
            start: c.start, end, ref: { fileId: mate.fileId, line: 1 }, depth: this.ctx.depth + 1, role: 'worker',
            ...(c.agentType ? { agentType: c.agentType } : {}), ...(c.task ? { task: c.task } : {}),
            ...(model ? { model, provider: providerOf(model) } : {}),
            lastActivity: end ?? last ?? c.start, seq: c.seq,
          });
          continue;
        }
        const name = c.name ?? c.teammateId?.split('@')[0] ?? c.agentType ?? 'teammate';
        out.push({
          ...base, id: externalSpanId(key), name, status: 'unknown', start: c.start, end: null, ref,
          depth: this.ctx.depth + 1, role: 'worker', external: true,
          ...(c.agentType ? { agentType: c.agentType } : {}), lastActivity: c.start, seq: c.seq,
        });
        continue;
      }
      const entry = lookup?.find(c.id, c.agentId);
      if (entry) entry.claimed = true;
      const meta = entry?.meta ?? {};
      const note = this.notes.find((n) => n.ts >= c.start && (n.text.includes(c.id) || (entry && n.text.includes(entry.agentId))));
      const fileLast = entry ? (entry.mtime ?? entry.lastTs ?? null) : null;
      let status;
      let end = null;
      if (meta.stoppedByUser === true) { status = 'cancelled'; end = entry.lastTs ?? c.resultTs ?? c.start; }
      else if (meta.finished === true) { status = 'ok'; end = entry.lastTs ?? c.resultTs ?? c.start; }
      else if (note) { status = 'ok'; end = note.ts; }
      else if (entry) { status = isLive(fileLast, now) ? 'running' : 'unknown'; }
      else if (c.closed && c.status !== 'async_launched' && c.status !== 'teammate_spawned') {
        if (c.interrupted) status = 'cancelled';
        else if (c.isError) status = 'error';
        else status = 'ok';
        end = c.resultTs ?? c.start;
      } else status = isLive(lastTs, now) ? 'running' : 'unknown';
      const model = meta.model ?? c.model ?? entry?.model;
      const lastActivity = end ?? fileLast ?? c.resultTs ?? c.start;
      out.push({
        ...base,
        id: agentSpanId(c.id),
        name: c.name ?? str(meta.name) ?? c.agentType ?? 'Agent',
        status, start: c.start, end, ref,
        depth: Number.isFinite(meta.spawnDepth) ? meta.spawnDepth : this.ctx.depth + 1,
        role: 'worker',
        ...(status === 'error' ? { error: { message: MSG.agentFailed } } : {}),
        ...((c.agentType ?? str(meta.agentType)) ? { agentType: c.agentType ?? str(meta.agentType) } : {}),
        ...((c.task ?? str(meta.description)) ? { task: c.task ?? str(meta.description) } : {}),
        ...(model ? { model, provider: providerOf(model) } : {}),
        lastActivity, seq: c.seq,
      });
    }
    return out;
  }
}

/**
 * @typedef {object} AgentEntry
 * @property {string} agentId @property {object} meta @property {number|null} lastTs
 * @property {number} [mtime] @property {string} [model] @property {boolean} [claimed]
 */
export class AgentLookup {
  constructor() {
    this.byToolUse = new Map();
    this.byAgent = new Map();
    this.entries = [];
  }
  add(entry) {
    this.entries.push(entry);
    if (str(entry.meta?.toolUseId)) this.byToolUse.set(entry.meta.toolUseId, entry);
    this.byAgent.set(entry.agentId, entry);
  }
  find(toolUseId, agentId) {
    return this.byToolUse.get(toolUseId) ?? (agentId ? this.byAgent.get(agentId) : undefined);
  }
}

/**
 * Parse a main file plus its `subagents/` files into one span tree.
 * @param {{ main: { fileId: string, text: string },
 *   subagents?: { fileId: string, agentId: string, text: string, meta?: object, mtime?: number, mate?: boolean }[],
 *   (mate: an agent-team teammate's own session file, agentId = its `name@team`)
 *   now?: number }} input
 */
export function buildSessionTree({ main, subagents = [], now }) {
  const clock = now ?? Date.now();
  const mainSession = new ClaudeCodeSession({ fileId: main.fileId, now: clock });
  mainSession.push(main.text);
  const sid = mainSession.sessionId ?? '';
  const rootId = `${sid}:main`;

  const lookup = new AgentLookup();
  const parsed = [];
  const lastMate = new Map(subagents.filter((f) => f.mate).map((f) => [f.agentId, f]));
  for (const f of subagents) {
    const meta = f.meta && typeof f.meta === 'object' ? f.meta : {};
    // a teammate file hangs under the lead's teammate_spawned span (ext:<name@team>); an older file of a
    // respawned teammate gets its own node under the root instead
    const spanId = f.mate ? (lastMate.get(f.agentId) === f ? externalSpanId(f.agentId) : orphanSpanId(`${f.agentId}~${f.fileId}`))
      : str(meta.toolUseId) ? agentSpanId(meta.toolUseId) : orphanSpanId(f.agentId);
    const depth = Number.isFinite(meta.spawnDepth) ? meta.spawnDepth : 1;
    const s = new ClaudeCodeSession({ fileId: f.fileId, sessionId: sid, parentId: spanId, depth, now: clock });
    s.push(f.text);
    const lastLlm = s.llm.lastModel();
    const entry = { agentId: f.agentId, meta, lastTs: s.lastTs, firstTs: s.firstTs, mtime: f.mtime, model: lastLlm, fileId: f.fileId, ...(f.mate ? { mate: true } : {}) };
    lookup.add(entry);
    parsed.push({ f, s, entry, spanId, depth });
  }

  // children first, so the root's status can account for running agents
  const sessions = [mainSession, ...parsed.map((p) => p.s)];
  const children = sessions.flatMap((s) => s.childSpans(lookup));
  for (const p of parsed) {
    if (p.entry.claimed) continue;
    const m = p.entry.meta;
    const last = p.entry.mtime ?? p.entry.lastTs;
    let status; let end = null;
    if (m.stoppedByUser === true) { status = 'cancelled'; end = p.entry.lastTs; }
    else if (m.finished === true) { status = 'ok'; end = p.entry.lastTs; }
    else status = isLive(last, clock) ? 'running' : 'unknown';
    const model = m.model ?? p.entry.model;
    children.push({
      id: p.spanId, parentId: rootId, sessionId: sid, source: 'claude-code', kind: 'agent',
      name: str(m.name) ?? str(m.agentType) ?? (p.f.mate ? p.f.agentId.split('@')[0] : 'Agent'), status,
      start: p.entry.firstTs ?? 0, end, ref: { fileId: p.f.fileId, line: 1 }, depth: p.depth, role: 'worker',
      ...(str(m.agentType) ? { agentType: m.agentType } : {}),
      ...(str(m.description) ? { task: m.description } : {}),
      ...(model ? { model, provider: providerOf(model) } : {}),
      lastActivity: end ?? last ?? p.entry.firstTs ?? 0, seq: 0,
    });
  }
  return mainSession.snapshot({ children });
}
