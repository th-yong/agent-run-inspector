// Cost (spec section 7): reported value (Claude Code cost-state) -> price table -> unknown.
// The built-in table is prices.json (USD per 1M tokens, dated, with source URLs). A user file
// (--prices) or the config file's `prices` overrides it field by field. Models not in the table
// get tokens only (usd null); nothing is guessed.
import { readFileSync } from 'node:fs';

const RATES = ['input', 'output', 'cacheRead', 'cacheWrite'];
// A model id also matches a longer id that only adds a dated snapshot ("-2026-01-01", "-20260101")
// or a context tag ("[1m]"). Sibling models ("gpt-5.5-mini" vs "gpt-5.5") never match.
const SNAPSHOT = /^(-\d[\w.-]*|\[[^\]]*\])$/;
const BUILTIN = new URL('../prices.json', import.meta.url);

function fail(message) {
  return Object.assign(new Error(message), { code: 'EPRICES' });
}

function checkEntry(id, e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw fail(`Bad price entry for ${id}`);
  for (const k of RATES) {
    if (k in e && e[k] !== null && !(Number.isFinite(e[k]) && e[k] >= 0)) throw fail(`Bad price for ${id}.${k}`);
  }
}

/** @param {{models?: object}} base @param {object} [overrides] id -> partial entry */
export function createPricer(base, overrides = {}) {
  const models = new Map();
  const put = (id, e) => { checkEntry(id, e); models.set(id, { ...models.get(id), ...e }); };
  for (const [id, e] of Object.entries(base?.models ?? {})) put(id, e);
  for (const [id, e] of Object.entries(overrides ?? {})) put(id, e);

  function find(model) {
    if (typeof model !== 'string' || !model) return null;
    const exact = models.get(model);
    if (exact) return exact;
    let best = null;
    for (const id of models.keys()) {
      if (model.startsWith(id) && SNAPSHOT.test(model.slice(id.length)) && (best === null || id.length > best.length)) best = id;
    }
    return best === null ? null : models.get(best);
  }

  function cost(model, tokens) {
    const e = find(model);
    if (!e) return { usd: null, basis: 'unknown' };
    const t = tokens ?? {};
    let usd = 0;
    for (const k of RATES) {
      const n = Number.isFinite(t[k]) ? t[k] : 0;
      if (n === 0) continue;
      if (!Number.isFinite(e[k])) return { usd: null, basis: 'unknown' }; // tokens used with no published rate
      usd += (n * e[k]) / 1e6;
    }
    return { usd, basis: 'priced' };
  }

  return { find, cost };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw fail(`Cannot read price file ${file}: ${err.code ?? 'invalid JSON'}`);
  }
}

/** A user table is either {models:{id:entry}} (like prices.json) or a plain {id:entry} map. */
function overridesOf(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw fail('Price file must be a JSON object');
  return obj.models && typeof obj.models === 'object' ? obj.models : obj;
}

/** Built-in table, then config `prices`, then the --prices file (later wins). */
export function loadPrices({ file, config } = {}) {
  const merged = { ...overridesOf(config ?? {}) };
  if (file) {
    for (const [id, e] of Object.entries(overridesOf(readJson(file)))) merged[id] = { ...merged[id], ...e };
  }
  return createPricer(readJson(BUILTIN), merged);
}

/** Sets span.cost on every llm span (sub-agents included: they never have a reported value). */
export function applyCosts(spans, pricer) {
  for (const s of spans) if (s.kind === 'llm') s.cost = pricer.cost(s.model, s.tokens);
  return spans;
}

/** Session cost the recording itself reports (Claude Code `cost-state`), or null. */
export function reportedUsdOf(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (Number.isFinite(rec.totalCostUSD)) return rec.totalCostUSD;
  const per = Object.values(rec.modelUsage ?? {}).map((u) => u?.costUSD);
  return per.length && per.every(Number.isFinite) ? per.reduce((a, b) => a + b, 0) : null;
}
