// Codex LLM calls from token accounting lines (spec 5.3, 11-3, 11-6).
//
// Decisions:
// - One `event_msg/token_count` = one response (llm span). end = that line's time.
// - `info.total_token_usage` is cumulative, so it is never summed. We read
//   `info.last_token_usage`. A line whose cumulative total equals the previous
//   one is a repeat and is dropped.
// - `info: null` (old versions) carries no usage and is skipped.
// - `cached_input_tokens` is part of `input_tokens` (input >= cached held in
//   the real-record scan), so Tokens.input = input - cached (clamped at 0) and
//   cacheRead = cached.
// - 0.166 writes a `token_usage_record` per response next to the token_count.
//   Once one is seen, the record is the only source: later token_count lines
//   are ignored, otherwise every response would count twice. Records are
//   deduplicated by response_id.
// - start = time of the nearest preceding user input / tool output line. If no
//   such line came since the last response, the last response's end, else the
//   session start. It is always an approximation (startApprox).
// - Codex gives no stop reason, so a counted response is status 'ok'.
// - reasoning_output_tokens are part of output_tokens (includedInOutput).
import { providerOf } from '../../model/provider.js';

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Codex usage object -> Tokens. */
export function mapUsage(u) {
  const input = num(u.input_tokens);
  const cached = num(u.cached_input_tokens);
  const tokens = {
    input: Math.max(0, input - cached),
    output: num(u.output_tokens),
    cacheRead: cached,
    cacheWrite: num(u.cache_write_input_tokens),
  };
  if (Number.isFinite(u.reasoning_output_tokens) && u.reasoning_output_tokens > 0) {
    tokens.reasoning = u.reasoning_output_tokens;
    tokens.includedInOutput = true;
  }
  return tokens;
}

const isUsage = (u) => u && typeof u === 'object' && !Array.isArray(u);

export function createLlmTracker({ sessionId, fileId, parentId, startTs }) {
  const calls = [];
  const seenResponses = new Set();
  let recordMode = false;
  let lastInput = null;   // ts of latest input/tool-output line not yet used as a start
  let lastEnd = null;
  let lastTotal = null;   // JSON of the previous cumulative total

  function add({ id, line, ts, usage, model }) {
    const start = Math.min(lastInput ?? lastEnd ?? startTs, ts);
    lastInput = null;
    lastEnd = ts;
    const span = {
      id, parentId, sessionId, source: 'codex', kind: 'llm',
      name: model ?? 'unknown model', status: 'ok', start, end: ts, startApprox: true,
      ref: { fileId, line }, tokens: mapUsage(usage), lastActivity: ts,
    };
    if (model) { span.model = model; span.provider = providerOf(model); }
    calls.push(span);
    return span;
  }

  /** A user message or tool output: the next response starts here. */
  function onInput(ts) { lastInput = ts; }

  /** @returns {object|null} the new span, or null if the line is not a response. */
  function onTokenCount(line, ts, payload, model) {
    if (recordMode) return null;
    const info = payload.info;
    if (!info || typeof info !== 'object') return null;
    const total = JSON.stringify(info.total_token_usage ?? null);
    if (info.total_token_usage != null && total === lastTotal) return null;
    if (info.total_token_usage != null) lastTotal = total;
    if (!isUsage(info.last_token_usage)) return null;
    return add({ id: `cx:${sessionId}:llm:L${line}`, line, ts, usage: info.last_token_usage, model });
  }

  function onRecord(line, ts, payload, model) {
    recordMode = true;
    if (!isUsage(payload?.usage)) return null;
    const rid = typeof payload.response_id === 'string' ? payload.response_id : `L${line}`;
    if (seenResponses.has(rid)) return null;
    seenResponses.add(rid);
    return add({ id: `cx:${sessionId}:llm:${rid}`, line, ts, usage: payload.usage, model });
  }

  return { onInput, onTokenCount, onRecord, spans: () => calls };
}
