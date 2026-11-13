import { providerOf } from '../../model/provider.js';

const SYNTHETIC_MODEL = '<synthetic>';

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Claude Code `usage` (or one `usage.iterations[]` entry) -> Tokens.
 * Cache writes are the 5m + 1h split when present, else the flat total.
 * Thinking tokens are already part of `output_tokens`, hence includedInOutput.
 * @returns {import('../../model/types.js').Tokens}
 */
export function mapUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const split = u.cache_creation;
  const cacheWrite =
    split && typeof split === 'object'
      ? num(split.ephemeral_5m_input_tokens) + num(split.ephemeral_1h_input_tokens)
      : num(u.cache_creation_input_tokens);
  const tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite,
  };
  const thinking = u.output_tokens_details?.thinking_tokens;
  if (Number.isFinite(thinking) && thinking > 0) {
    tokens.reasoning = thinking;
    tokens.includedInOutput = true;
  }
  return tokens;
}

const ZERO_TOKENS = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Groups assistant lines by `message.id` into one llm span each (usage counted once)
 * and splits advisor iterations into child llm spans.
 */
export class LlmCollector {
  /**
   * @param {{ sessionId: string, fileId: string, parentId: string, nextSeq: () => number }} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.requests = new Map(); // api-request id -> epoch ms
    this.groups = new Map(); // message.id -> group
  }

  onApiRequest(rec, ts) {
    if (typeof rec.id === 'string' && ts !== null) this.requests.set(rec.id, ts);
  }

  /**
   * @param {object} rec parsed assistant line
   * @param {number | null} ts epoch ms of this line
   * @param {number} line 1-based line number
   * @param {number | null} prevTs timestamp of the nearest earlier line that had one
   */
  onAssistant(rec, ts, line, prevTs) {
    const msg = rec.message;
    if (!msg || typeof msg.id !== 'string') return;
    let g = this.groups.get(msg.id);
    if (!g) {
      g = { id: msg.id, line, start: null, startApprox: false, end: null };
      this.groups.set(msg.id, g);
    }
    if (!g.exact) {
      const reqTs = typeof rec.requestRef === 'string' ? this.requests.get(rec.requestRef) : undefined;
      if (reqTs !== undefined) {
        g.start = reqTs;
        g.startApprox = false;
        g.exact = true;
      } else if (g.start === null) {
        g.start = prevTs ?? ts;
        g.startApprox = true;
      }
    }
    if (ts !== null) g.end = ts;
    // The last line wins; spec says repeated lines carry identical usage.
    g.msg = msg;
    g.error = rec.isApiErrorMessage === true || msg.model === SYNTHETIC_MODEL ? rec : null;
    g.seq = this.ctx.nextSeq();
  }

  /** @returns {import('../../model/types.js').RunSpan[]} */
  spans() {
    const out = [];
    for (const g of this.groups.values()) {
      const msg = g.msg;
      const start = g.start ?? g.end ?? 0;
      const end = g.end ?? start;
      const base = {
        parentId: this.ctx.parentId,
        sessionId: this.ctx.sessionId,
        source: 'claude-code',
        kind: 'llm',
        start,
        end,
        ...(g.startApprox ? { startApprox: true } : {}),
        ref: { fileId: this.ctx.fileId, line: g.line },
        lastActivity: end,
        seq: g.seq,
      };
      const id = `llm:${g.id}`;
      if (g.error) {
        const code = g.error.apiErrorStatus;
        out.push({
          ...base,
          id,
          name: SYNTHETIC_MODEL,
          status: 'error',
          model: SYNTHETIC_MODEL,
          provider: providerOf(SYNTHETIC_MODEL),
          tokens: ZERO_TOKENS(),
          error: {
            message: typeof g.error.error === 'string' && g.error.error ? g.error.error : 'API error',
            ...(code !== undefined && code !== null ? { code } : {}),
          },
        });
        continue;
      }
      const model = typeof msg.model === 'string' ? msg.model : undefined;
      out.push({
        ...base,
        id,
        name: model ?? 'unknown model',
        status: msg.stop_reason ? 'ok' : 'unknown',
        ...(model ? { model, provider: providerOf(model) } : {}),
        tokens: mapUsage(msg.usage),
      });
      const iterations = Array.isArray(msg.usage?.iterations) ? msg.usage.iterations : [];
      let n = 0;
      for (const it of iterations) {
        if (!it || it.type !== 'advisor_message') continue;
        const m = typeof it.model === 'string' ? it.model : undefined;
        out.push({
          ...base,
          id: `${id}:advisor:${n++}`,
          parentId: id,
          name: m ?? 'advisor',
          status: 'ok',
          ...(m ? { model: m, provider: providerOf(m) } : {}),
          tokens: mapUsage(it),
        });
      }
    }
    return out;
  }
}
