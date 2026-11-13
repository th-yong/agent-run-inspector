// Pure helpers for the timeline tab: time -> position, ruler ticks, row order. No DOM.
import { summarizeCalls, foldCalls } from './timeline-group.js';
const known = (n) => typeof n === 'number' && Number.isFinite(n);
const STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 21_600_000, 43_200_000, 86_400_000];

export const STALE_MS = 5 * 60_000;

/** Where a bar with no end stops: now, or the last activity when the run has gone quiet (a log that stopped growing). */
export function openEnd(span, now) {
  const quiet = known(span.lastActivity) && now - span.lastActivity > STALE_MS;
  return Math.max(span.start, quiet ? span.lastActivity : now);
}

/**
 * Agents with no end that can no longer be running get one: when the session has stopped, or the agent itself is not
 * running, they end at their own last activity (else the session end). Keeps the orange "now" line off a finished run.
 * Returns a new list; spans that need no change are the same objects.
 */
export function settleAgents(spans) {
  const list = spans ?? [];
  const sess = list.find((s) => s.kind === 'session');
  const stopped = sess != null && sess.status !== 'running';
  return list.map((s) => {
    if (s.kind !== 'agent' || known(s.end)) return s;
    if (!stopped && s.status === 'running') return s;
    const end = known(s.lastActivity) ? s.lastActivity : known(sess?.end) ? sess.end : s.start;
    return { ...s, end: Math.max(s.start ?? 0, end) };
  });
}

/** Time window of the run: earliest start to latest end; running spans reach `now`. */
export function domainOf(spans, now) {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const s of spans ?? []) {
    if (s.kind === 'session' || !known(s.start)) continue;
    t0 = Math.min(t0, s.start);
    t1 = Math.max(t1, known(s.end) ? s.end : openEnd(s, now));
  }
  if (!known(t0)) return { t0: now, t1: now + 1000 };
  if (t1 - t0 < 1000) t1 = t0 + 1000;
  return { t0, t1 };
}

/** Smallest round step that gives no more than `want` ticks over `durationMs`. */
export function niceStep(durationMs, want) {
  const min = durationMs / Math.max(1, want);
  const hit = STEPS.find((s) => s >= min);
  return hit ?? Math.ceil(min / 86_400_000) * 86_400_000;
}

/** "0", "500ms", "2s", "1m 30s", "2m", "1h 30m" */
export function fmtTick(ms, step) {
  if (ms === 0) return '0';
  if (step < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${ms / 1000}s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (ms < 3_600_000) return s ? `${m}m ${s}s` : `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Ruler ticks: { ms offset from the start, pct position, label }. */
export function ticksFor({ t0, t1 }, want = 6) {
  const span = t1 - t0;
  const step = niceStep(span, want);
  const out = [];
  for (let ms = 0; ms <= span; ms += step) out.push({ ms, pct: (ms / span) * 100, label: fmtTick(ms, step) });
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Bar placement in percent of the lane. `open` = still running (the end fades out). */
export function boxOf(span, { t0, t1 }, now) {
  const total = t1 - t0;
  const open = !known(span.end);
  const end = open ? openEnd(span, now) : span.end;
  const left = clamp(((span.start - t0) / total) * 100, 0, 100);
  const right = clamp(((end - t0) / total) * 100, left, 100);
  return { left, width: right - left, open };
}

const isCall = (s) => s.kind === 'llm' || s.kind === 'tool';
const byStart = (a, b) => a.start - b.start;

/** Map agent id -> its own llm/tool spans in time order. */
export function callsByAgent(spans) {
  const m = new Map();
  for (const s of spans ?? []) {
    if (!isCall(s) || s.parentId == null) continue;
    if (!m.has(s.parentId)) m.set(s.parentId, []);
    m.get(s.parentId).push(s);
  }
  for (const list of m.values()) list.sort(byStart);
  return m;
}

/**
 * Rows in display order: an agent, and when it is expanded its sub-agents first, then one "Calls N" group row.
 * `expanded` holds agent ids, `calls:<agentId>` for an open group and `run:<firstCallId>` for an open folded run.
 * Rows: { type: 'agent' | 'group' | 'run' | 'call', span (agent for 'group'), depth, key, ... }.
 */
export function timelineRows(spans, expanded) {
  const agents = (spans ?? []).filter((s) => s.kind === 'agent');
  const ids = new Set(agents.map((a) => a.id));
  const kids = new Map();
  const roots = [];
  for (const a of agents) {
    if (a.parentId != null && a.parentId !== a.id && ids.has(a.parentId)) {
      if (!kids.has(a.parentId)) kids.set(a.parentId, []);
      kids.get(a.parentId).push(a);
    } else roots.push(a);
  }
  const calls = callsByAgent(spans);
  const rows = [];
  const seen = new Set();
  const walk = (a, depth) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    rows.push({ type: 'agent', span: a, depth, key: a.id });
    if (!expanded.has(a.id)) return;
    for (const k of (kids.get(a.id) ?? []).sort(byStart)) walk(k, depth + 1);
    const own = calls.get(a.id) ?? [];
    if (!own.length) return;
    const key = `calls:${a.id}`;
    rows.push({ type: 'group', span: a, depth: depth + 1, key, calls: own, summary: summarizeCalls(own) });
    if (!expanded.has(key)) return;
    for (const it of foldCalls(own)) {
      if (it.type === 'call') rows.push({ type: 'call', span: it.span, depth: depth + 2, key: it.span.id });
      else {
        rows.push({ type: 'run', span: it.spans[0], depth: depth + 2, key: it.key, run: it });
        if (expanded.has(it.key)) for (const c of it.spans) rows.push({ type: 'call', span: c, depth: depth + 3, key: c.id });
      }
    }
  };
  for (const r of roots.sort(byStart)) walk(r, 0);
  // A parent loop leaves no root: show those agents at the top level.
  const reach = new Set();
  const mark = (a) => { if (!reach.has(a.id)) { reach.add(a.id); (kids.get(a.id) ?? []).forEach(mark); } };
  roots.forEach(mark);
  for (const a of agents) if (!reach.has(a.id)) { mark(a); walk(a, 0); }
  return rows;
}
