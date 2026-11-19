// One session-summary shape for both tools (spec SessionSummary).
//  - quickSummary: from stat data plus the first/last few KB only (list screen).
//  - fullSummary: from a fully parsed span tree (after the session is opened).
// Differences between the adapters are absorbed here:
//  CC session span id is the raw session id, Codex's is `cx:<thread>`; Codex has no title,
//  no markers and no `role` on the root; CC `turns` are duration points, Codex's are bands;
//  Codex sub-agent links may be inferred (linkApprox / startApprox).
import { basename } from 'node:path';
import { HEAD_BYTES, TAIL_BYTES, TITLE_SCAN_BYTES, findLastTitle, readEnds, readHead, readTail } from './scan.js';
import { createCodexParser } from '../adapters/codex/index.js';
import { linkCodexAgents } from '../adapters/codex/agents.js';
import { AgentCollector, buildSessionTree } from '../adapters/claude-code/agents.js';
import { ENDS_TURN, isLocalCommand, shutdownSignal } from '../adapters/claude-code/index.js';
import { BackgroundTasks } from '../adapters/claude-code/tools.js';
import { mapUsage } from '../adapters/codex/llm.js';
import { MSG } from '../strings.js';

export const RUNNING_MS = 10 * 60 * 1000;
const lastSeg = (p) => (typeof p === 'string' ? basename(p.replace(/[\\/]+$/, '')) : '');
const ts = (o) => {
  const t = typeof o?.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  return Number.isFinite(t) ? t : null;
};
const num = (v) => (Number.isFinite(v) ? v : 0);
const lastOf = (arr, pred) => {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return undefined;
};
const emptyTotals = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: null });

function base(entry, extra) {
  return {
    id: entry.id, source: entry.source, project: '', start: 0, end: null, lastWrite: entry.lastWrite,
    status: 'unknown', agentCount: 1, callCount: 0, errorCount: 0, totals: emptyTotals(), models: [],
    inferredLinks: 0, detail: false,
    ...(entry.origin ? { origin: entry.origin } : {}),
    ...extra,
  };
}

// A sub-agent's meta file says when it is done (`finished` / `stoppedByUser`); a small JSON read.
function subFinished(store, sub) {
  const m = readMeta(store, sub);
  return m.finished === true || m.stoppedByUser === true;
}

// The record that says whether a Claude Code thread is mid-turn, and whether that turn ended.
const turnRec = (tail) => lastOf(tail, (r) => (r.type === 'user' && !isLocalCommand(r)) || r.type === 'assistant' || (r.type === 'system' && r.subtype === 'turn_duration'));
const ended = (r) => r?.type === 'system' || (r?.type === 'assistant' && ENDS_TURN.has(r.message?.stop_reason));

// Teammates the lead stopped (TaskStop) or heard shut down, from the lead's tail: name -> time.
function stoppedMates(tail) {
  const c = new AgentCollector({ nextSeq: () => 0 });
  for (const r of tail) {
    if (r.type === 'assistant') c.onAssistant(r, ts(r), 0);
    else if (r.type === 'user') c.onUser(r, ts(r));
  }
  return c.stopped;
}

// A teammate is done when its turn ended, it shut down (see shutdownSignal), or the lead stopped it
// after its last message.
function mateDone(store, sub, stopped) {
  const { tail } = readEnds(store, sub.fileId, sub.size);
  const r = turnRec(tail);
  if (ended(r)) return true;
  if (stopped.get(sub.agentId.split('@')[0]) >= (ts(r) ?? Infinity)) return true;
  let down = false;
  for (const x of tail) down = shutdownSignal(x) ?? down;
  return down;
}

function quickClaude(entry, store, now) {
  const { head, tail } = readEnds(store, entry.main.fileId, entry.main.size);
  let cwd; let branch; let first = null;
  for (const r of head) {
    if (typeof r.cwd === 'string' && r.cwd) cwd ??= r.cwd;
    if (typeof r.gitBranch === 'string' && r.gitBranch) branch ??= r.gitBranch;
    first ??= ts(r);
  }
  // A title outside both windows (long tool output around it) is found by a byte search of the end.
  const title = lastOf([...head, ...tail], (r) => r.type === 'ai-title' && r.aiTitle)?.aiTitle
    ?? (entry.main.size > HEAD_BYTES + TAIL_BYTES ? findLastTitle(store, entry.main.fileId, entry.main.size) : undefined);
  const lastTs = lastOf(tail, (r) => ts(r) !== null);
  const last = lastTs ? ts(lastTs) : entry.main.mtimeMs;
  const cost = lastOf(tail, (r) => r.type === 'cost-state');
  const totals = emptyTotals();
  const models = [];
  if (cost) {
    for (const [m, u] of Object.entries(cost.modelUsage ?? {})) {
      models.push(m);
      totals.input += num(u?.inputTokens);
      totals.output += num(u?.outputTokens);
      totals.cacheRead += num(u?.cacheReadInputTokens);
      totals.cacheWrite += num(u?.cacheCreationInputTokens);
    }
    if (Number.isFinite(cost.totalCostUSD)) totals.usd = cost.totalCostUSD;
  } else {
    // No cost-state: the list still needs model names (provider icons), so take them from the tail's assistant lines.
    for (const r of tail) {
      const m = r.type === 'assistant' ? r.message?.model : null;
      if (typeof m === 'string' && m && !m.startsWith('<') && !models.includes(m)) models.push(m);
    }
  }
  const recent = (t) => now - t < RUNNING_MS && now >= t;
  // The main thread's last turn ended (a final answer or system/turn_duration last): it waits for the user.
  // No turn record at all: done when the tail holds only command records (a file /clear started); otherwise
  // the tail may just sit inside one huge record, so keep the old reading (not ended).
  const lastTurn = turnRec(tail);
  const turnEnded = lastTurn ? ended(lastTurn) : tail.some(isLocalCommand);
  // ...but a sub-agent or teammate still writing keeps the run going (same rule as the full parse).
  const stopped = entry.subs.some((s) => s.mate) ? stoppedMates(tail) : new Map();
  const childRunning = entry.subs.some((s) => recent(s.mtimeMs) && (s.mate ? !mateDone(store, s, stopped) : !subFinished(store, s)));
  // A recently ended turn may still wait on a background task: look further back than the tail for its launch
  // (only then, so the list stays cheap).
  // ponytail: a launch more than 256 KB before the end is missed and the run shows as done, as before.
  const bg = new BackgroundTasks();
  if (turnEnded && recent(last) && !childRunning) {
    for (const r of readTail(store, entry.main.fileId, entry.main.size, TITLE_SCAN_BYTES)) if (r.type === 'assistant') bg.onAssistant(r); else if (r.type === 'user') bg.onUser(r);
  }
  const running = (recent(last) && (!turnEnded || bg.open.size > 0)) || childRunning;
  return base(entry, {
    ...(title ? { title } : {}),
    project: lastSeg(cwd) || entry.project || '',
    ...(cwd ? { cwd } : {}),
    ...(branch ? { branch } : {}),
    start: first ?? entry.main.mtimeMs,
    end: running ? null : last,
    status: running ? 'running' : 'ok',
    ...(running && turnEnded ? { background: true } : {}),
    agentCount: 1 + entry.subs.length,
    totals, models,
  });
}

function quickCodex(entry, store, now) {
  if (entry.unknown) {
    const t = ts(readHead(store, entry.main.fileId, entry.main.size)[0]) ?? 0;
    return base(entry, { project: '', start: t, end: null, status: 'unknown', agentCount: 0, title: MSG.unknownFormat });
  }
  const { head, tail } = readEnds(store, entry.main.fileId, entry.main.size);
  const meta = head[0].payload;
  const startRaw = Date.parse(meta.timestamp);
  const start = Number.isFinite(startRaw) ? startRaw : ts(head[0]) ?? 0;
  const lastRec = lastOf(tail.length ? tail : head, (r) => ts(r) !== null);
  const last = lastRec ? ts(lastRec) : start;
  const models = [];
  for (const r of [...head, ...tail]) {
    const m = r.type === 'turn_context' ? r.payload?.model : null;
    if (typeof m === 'string' && !models.includes(m)) models.push(m);
  }
  const turnEv = lastOf(tail, (r) => r.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(r.payload?.type));
  const running = now - last <= RUNNING_MS;
  let status = 'unknown';
  if (running) status = 'running';
  else if (turnEv?.payload.type === 'task_complete') status = 'ok';
  else if (turnEv?.payload.type === 'turn_aborted') status = 'cancelled';
  const totals = emptyTotals();
  const usage = lastOf(tail, (r) => r.payload?.type === 'token_count' && r.payload.info?.total_token_usage);
  if (usage) {
    const t = mapUsage(usage.payload.info.total_token_usage);
    totals.input = t.input; totals.output = t.output; totals.cacheRead = t.cacheRead; totals.cacheWrite = t.cacheWrite;
  }
  return base(entry, {
    project: lastSeg(meta.cwd),
    ...(meta.cwd ? { cwd: meta.cwd } : {}),
    ...(meta.git?.branch ? { branch: meta.git.branch } : {}),
    start,
    end: running ? null : last,
    status,
    agentCount: 1 + entry.children.length,
    totals, models,
  });
}

export function quickSummary(entry, store, now) {
  return entry.source === 'claude-code' ? quickClaude(entry, store, now) : quickCodex(entry, store, now);
}

function readText(store, fileId, size) {
  return store.readRange(fileId, 0, size).toString('utf8');
}

function readMeta(store, sub) {
  if (sub.metaFileId === null) return {};
  try {
    return JSON.parse(readText(store, sub.metaFileId, store.stat(sub.metaFileId).size));
  } catch {
    return {};
  }
}

function normTurns(source, turns) {
  if (source === 'claude-code') {
    return turns.map((t) => ({ start: t.ts - t.durationMs, end: t.ts, status: 'ok', approx: true }));
  }
  return turns.map((t) => ({ start: t.start, end: t.end, status: t.status, ...(t.model ? { model: t.model } : {}), approx: false }));
}

/** Full parse of one session (and its sub-agent files) into spans + summary. */
export function openEntry(entry, store, now) {
  let spans; let markers = []; let turns = []; let meta = {};
  if (entry.source === 'claude-code') {
    const subagents = entry.subs.map((s) => ({
      fileId: String(s.fileId), agentId: s.agentId, text: readText(store, s.fileId, s.size),
      meta: readMeta(store, s), mtime: s.mtimeMs, ...(s.mate ? { mate: true } : {}),
    }));
    const snap = buildSessionTree({
      main: { fileId: String(entry.main.fileId), text: readText(store, entry.main.fileId, entry.main.size) },
      subagents, now,
    });
    spans = snap.spans; markers = snap.markers; turns = normTurns(entry.source, snap.turns);
    meta = snap.session;
  } else {
    const mk = (f) => {
      const p = createCodexParser({ fileId: String(f.fileId), now: () => now });
      const text = readText(store, f.fileId, f.size);
      let n = 0;
      for (const l of text.split('\n')) {
        if (!l) continue;
        n++;
        let o = null;
        try { o = JSON.parse(l); } catch { /* cut line */ }
        if (o) p.push(n, o);
      }
      return p;
    };
    const root = mk(entry.main);
    const pool = entry.children.map(mk);
    spans = linkCodexAgents(root, pool).spans;
    turns = normTurns(entry.source, root.turns());
    const m = root.meta();
    meta = m ? { cwd: m.cwd, branch: m.branch, project: lastSeg(m.cwd) } : { title: MSG.unknownFormat };
  }
  return { summary: fullSummary(entry, spans, meta), spans, markers, turns };
}

export function fullSummary(entry, spans, meta) {
  const session = spans.find((s) => s.kind === 'session');
  const totals = emptyTotals();
  const models = [];
  let calls = 0; let errors = 0; let agents = 0; let inferred = 0;
  let usd = 0; let usdKnown = true; let llmCount = 0;
  for (const s of spans) {
    if (s.kind === 'agent') {
      if (!s.external) agents++;
      if (s.linkApprox) inferred++;
    }
    if (s.kind === 'llm' || s.kind === 'tool') calls++;
    if (s.kind !== 'session' && s.status === 'error') errors++;
    if (s.kind === 'llm') {
      llmCount++;
      if (s.model && !s.model.startsWith('<') && !models.includes(s.model)) models.push(s.model);
      if (s.end !== null && s.tokens) {
        totals.input += num(s.tokens.input);
        totals.output += num(s.tokens.output);
        totals.cacheRead += num(s.tokens.cacheRead);
        totals.cacheWrite += num(s.tokens.cacheWrite);
      }
      if (Number.isFinite(s.cost?.usd)) usd += s.cost.usd;
      else usdKnown = false;
    }
  }
  totals.usd = llmCount > 0 && usdKnown ? usd : null;
  const title = meta.title;
  return base(entry, {
    ...(title ? { title } : {}),
    project: meta.project ?? '',
    ...(meta.cwd ? { cwd: meta.cwd } : {}),
    ...(meta.branch ? { branch: meta.branch } : {}),
    start: session?.start ?? 0,
    end: session?.end ?? null,
    status: session?.status ?? 'unknown',
    ...(session?.background ? { background: true } : {}),
    agentCount: agents, callCount: calls, errorCount: errors,
    totals, models, inferredLinks: inferred, detail: true,
  });
}
