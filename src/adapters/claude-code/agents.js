import { providerOf } from '../../model/provider.js';
import { ClaudeCodeSession } from './index.js';
import { AGENT_TOOLS } from './tools.js';
import { OrcaDispatches } from './orca.js';
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
    this.stopCalls = new Map(); // TaskStop tool_use id -> task_id
    this.stopped = new Map(); // teammate name -> when the lead stopped it or learned it shut down
    this.orca = new OrcaDispatches(); // Orca workers this file started (keyed by task id, like teammates)
  }

  #stop(name, ts) {
    if (name && ts !== null) this.stopped.set(name, Math.max(ts, this.stopped.get(name) ?? ts));
  }

  onAssistant(rec, ts, line) {
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    this.orca.onAssistant(rec, ts, line);
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string') continue;
      if (b.name === 'TaskStop') { const t = str(b.input?.task_id); if (t) this.stopCalls.set(b.id, t); continue; }
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
    const known = this.orca.tasks.size;
    this.orca.onUser(rec);
    for (const c of [...this.orca.tasks.values()].slice(known)) c.seq ??= this.ctx.nextSeq();
    // teammate messages relayed to the lead: "<name> has shut down." / the teammate approving its shutdown
    if (typeof content === 'string' && content.includes('teammate-message')) {
      for (const m of content.matchAll(/"type":"teammate_terminated","message":"([^"]+?) has shut down\./g)) this.#stop(m[1], ts);
      for (const m of content.matchAll(/"type":"shutdown_approved"[^}]*?"from":"([^"]+)"/g)) this.#stop(m[1], ts);
    }
    if (!Array.isArray(content)) return;
    for (const b of content) {
      const task = b?.type === 'tool_result' ? this.stopCalls.get(b.tool_use_id) : undefined;
      if (!task) continue;
      // stopped now, or already not running ("not running (status: completed)", "No task found")
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      if (!b.is_error || /not running|No task found/.test(text)) this.#stop(task, ts);
    }
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
        out.push(this.#mateSpan(key, c, c.name ?? c.teammateId?.split('@')[0] ?? c.agentType ?? 'teammate', { lookup, now, base, ref }));
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
    for (const [task, c] of this.orca.tasks) {
      out.push(this.#mateSpan(task, c, c.name ?? c.folder ?? task, { lookup, now, base, ref: { fileId: this.ctx.fileId, line: c.line }, orca: true }));
    }
    return out;
  }

  // A teammate or Orca worker: another session file, linked by `key` (name@team / task id). Found: a full
  // agent node over that file; not found: a bare external node.
  #mateSpan(key, c, fallbackName, { lookup, now, base, ref, orca }) {
    const mate = lookup?.find(undefined, key);
    const extra = { ...(c.agentType ? { agentType: c.agentType } : {}), ...(orca ? { orca: true } : {}) };
    if (mate?.mate) {
      mate.claimed = true;
      const last = mate.mtime ?? mate.lastTs;
      // done once its turn ended, it shut down, or the lead stopped it after this spawn
      const stoppedAt = this.stopped.get(key.split('@')[0]);
      const live = isLive(last, now) && !mate.turnEnded && !mate.shutDown && !(stoppedAt >= c.start);
      const end = live ? null : (mate.lastTs ?? c.start);
      const model = c.model ?? mate.model;
      return {
        ...base, id: externalSpanId(key), name: c.name ?? (orca ? mate.title ?? c.folder ?? str(mate.meta?.name) : undefined) ?? key.split('@')[0], status: live ? 'running' : 'ok',
        start: c.start, end, ref: { fileId: mate.fileId, line: 1 }, depth: this.ctx.depth + 1, role: 'worker',
        ...extra, ...(c.task ? { task: c.task } : {}),
        ...(model ? { model, provider: providerOf(model) } : {}),
        lastActivity: end ?? last ?? c.start, seq: c.seq,
      };
    }
    return {
      ...base, id: externalSpanId(key), name: fallbackName, status: 'unknown', start: c.start, end: null, ref,
      depth: this.ctx.depth + 1, role: 'worker', external: true, ...extra, lastActivity: c.start, seq: c.seq,
    };
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
    const entry = { agentId: f.agentId, meta, title: s.title, lastTs: s.lastTs, firstTs: s.firstTs, mtime: f.mtime, model: lastLlm, fileId: f.fileId, ...(f.mate ? { mate: true, turnEnded: s.turnEnded, shutDown: s.shutDown } : {}) };
    lookup.add(entry);
    parsed.push({ f, s, entry, spanId, depth });
  }

  // children first, so the root's status can account for running agents
  const sessions = [mainSession, ...parsed.map((p) => p.s)];
  const children = sessions.flatMap((s) => s.childSpans(lookup));
  // a stopped teammate's file is still fresh, but a call it left open will never finish
  const doneMates = new Set(children.filter((c) => c.id.startsWith('ext:') && c.status !== 'running').map((c) => c.id));
  for (const c of children) if (c.status === 'running' && doneMates.has(c.parentId)) c.status = 'unknown';
  // A run with a `parent` (Orca's one-call branch-name helper) has no card of its own: its calls go on the parent's
  const into = new Map(parsed.filter((p) => p.f.parent && !p.entry.claimed).map((p) => [p.spanId, externalSpanId(p.f.parent)]));
  for (const c of children) if (into.has(c.parentId)) c.parentId = into.get(c.parentId);
  for (const p of parsed) {
    if (p.entry.claimed || into.has(p.spanId)) continue;
    const m = p.entry.meta;
    const last = p.entry.mtime ?? p.entry.lastTs;
    let status; let end = null;
    if (m.stoppedByUser === true) { status = 'cancelled'; end = p.entry.lastTs; }
    else if (m.finished === true) { status = 'ok'; end = p.entry.lastTs; }
    else status = isLive(last, clock) ? 'running' : 'unknown';
    const model = m.model ?? p.entry.model;
    children.push({
      id: p.spanId, parentId: p.f.parent ? externalSpanId(p.f.parent) : rootId, sessionId: sid, source: 'claude-code', kind: 'agent',
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
