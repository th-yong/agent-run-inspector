// Per-span subtree totals with an incremental cache (spec section 4: the server sums the span tree).
// Only finished llm spans add tokens; a span change re-sums only its ancestors.
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'modelCalls', 'toolCalls', 'errors', 'agents', 'usd', 'priced', 'unknown'];
const num = (n) => (Number.isFinite(n) ? n : 0);
const zero = () => Object.fromEntries(FIELDS.map((f) => [f, 0]));

function own(s) {
  const o = zero();
  if (s.kind === 'llm') {
    o.modelCalls = 1;
    if (s.end !== null && s.tokens) {
      o.input = num(s.tokens.input); o.output = num(s.tokens.output);
      o.cacheRead = num(s.tokens.cacheRead); o.cacheWrite = num(s.tokens.cacheWrite);
    }
    if (s.end !== null && s.cost) {
      if (Number.isFinite(s.cost.usd)) { o.usd = s.cost.usd; o.priced = 1; } else o.unknown = 1;
    }
  } else if (s.kind === 'tool') o.toolCalls = 1;
  else if (s.kind === 'agent' && !s.external) o.agents = 1;
  if (s.kind !== 'session' && s.status === 'error') o.errors = 1;
  return o;
}
const add = (t, d, k = 1) => { for (const f of FIELDS) t[f] += k * d[f]; };

export class TotalsTree {
  #spans = new Map();
  #sub = new Map();
  #kids = new Map();

  #chain(parentId, fn) {
    const seen = new Set();
    for (let p = parentId; p != null && this.#sub.has(p) && !seen.has(p); p = this.#spans.get(p).parentId) {
      seen.add(p); fn(this.#sub.get(p));
    }
  }

  /** Insert or replace a span. */
  upsert(span) {
    const id = span.id;
    const prev = this.#spans.get(id);
    const oldSub = this.#sub.get(id) ?? zero();
    const sub = own(span);
    for (const k of this.#kids.get(id) ?? []) add(sub, this.#sub.get(k));
    if (prev && prev.parentId !== span.parentId) {
      this.#chain(prev.parentId, (t) => add(t, oldSub, -1));
      this.#kids.get(prev.parentId)?.delete(id);
      this.#spans.set(id, span); this.#sub.set(id, sub);
      this.#chain(span.parentId, (t) => add(t, sub));
    } else {
      const delta = zero(); add(delta, sub); add(delta, oldSub, -1);
      this.#spans.set(id, span); this.#sub.set(id, sub);
      this.#chain(span.parentId, (t) => add(t, delta));
    }
    if (span.parentId != null) {
      if (!this.#kids.has(span.parentId)) this.#kids.set(span.parentId, new Set());
      this.#kids.get(span.parentId).add(id);
    }
  }

  /** Totals for a span and everything under it, or null for an unknown id. */
  of(id, reportedUsd = null) {
    const s = this.#spans.get(id);
    if (!s) return null;
    const { usd, priced, unknown, ...rest } = this.#sub.get(id);
    const out = { durationMs: s.end === null ? null : Math.max(0, s.end - s.start), ...rest };
    if (Number.isFinite(reportedUsd)) return { ...out, usd: reportedUsd, basis: 'reported', partial: false };
    // Rounded so incremental and full sums agree despite float drift.
    return { ...out, usd: priced > 0 ? Math.round(usd * 1e9) / 1e9 : null, basis: priced > 0 ? 'priced' : 'unknown', partial: unknown > 0 && priced > 0 };
  }

  /** Whole run (the session span) plus one entry per agent span. */
  snapshot({ reportedUsd = null } = {}) {
    const byAgent = {};
    let total = null;
    for (const [id, s] of this.#spans) {
      if (s.kind === 'agent') byAgent[id] = this.of(id);
      else if (s.kind === 'session') total = this.of(id, reportedUsd);
    }
    return { total, byAgent };
  }
}

export function computeTotals(spans, opts) {
  const t = new TotalsTree();
  for (const s of spans) t.upsert(s);
  return t.snapshot(opts);
}
