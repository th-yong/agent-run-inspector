// Call detail: re-read the original line(s) when a call is opened and cut a preview (max 2 KB).
// Bodies never live in RunSpan. Redaction is applied later by redact.js, not here.
const MAX_BYTES = 2048;
const MAX_SCAN = 500; // lines to look ahead for a tool result

/** Cut `text` to at most `max` UTF-8 bytes without splitting a character. */
export function cutUtf8(text, max = MAX_BYTES) {
  if (Buffer.byteLength(text) <= max) return { text, truncated: false };
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > max) break;
    bytes += n;
    end += ch.length;
  }
  return { text: text.slice(0, end), truncated: true };
}

/** { text, length, truncated, keys? } for a string, or null when there is nothing. */
export function preview(value, keys) {
  if (value === undefined || value === null) return null;
  const full = typeof value === 'string' ? value : JSON.stringify(value);
  if (full === undefined) return null;
  const cut = cutUtf8(full);
  return { text: cut.text, length: full.length, truncated: cut.truncated, ...(keys ? { keys } : {}) };
}

/** The span's fileId is a string (spec); the file store wants an integer. Unify here. */
export function fileIdOf(span) {
  const raw = span?.ref?.fileId;
  const s = typeof raw === 'number' ? String(raw) : raw;
  return typeof s === 'string' && /^\d+$/.test(s) ? Number(s) : null;
}

function parse(line) {
  if (typeof line !== 'string') return null;
  try {
    const o = JSON.parse(line);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

const blocks = (o) => {
  const c = o?.message?.content;
  return Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : [];
};

const textOf = (c) => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
  return undefined;
};

const inputPreview = (input) => {
  if (input && typeof input === 'object' && !Array.isArray(input)) return preview(input, Object.keys(input));
  return preview(input);
};

// Look at lines after `from` until `match` returns a value.
function scanForward(store, fileId, from, match) {
  let total;
  try { total = store.lineCount(fileId); } catch { return undefined; }
  const last = Math.min(total, from + MAX_SCAN);
  for (let n = from + 1; n <= last; n++) {
    const o = parse(store.readLineAt(fileId, n));
    const hit = o && match(o);
    if (hit !== undefined && hit !== null && hit !== false) return hit;
  }
  return undefined;
}

function claudeInOut(span, store, fileId, o) {
  const bs = blocks(o);
  if (span.kind === 'llm') {
    const text = bs.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    return { input: null, output: text ? preview(text) : null };
  }
  const toolId = span.kind === 'tool' && span.id.startsWith('tool:') ? span.id.slice(5) : null;
  const use = bs.find((b) => b.type === 'tool_use' && (toolId ? b.id === toolId : b.name === 'Agent' || b.name === 'Task'));
  if (!use) return { input: null, output: null };
  const result = toolId
    ? scanForward(store, fileId, span.ref.line, (r) => blocks(r).find((b) => b.type === 'tool_result' && b.tool_use_id === use.id))
    : undefined;
  return { input: inputPreview(use.input), output: result ? preview(textOf(result.content)) : null };
}

function codexInOut(span, store, fileId, o) {
  const p = o.payload;
  if (span.kind !== 'tool' || !p || (p.type !== 'function_call' && p.type !== 'custom_tool_call')) return { input: null, output: null };
  let args = p.arguments ?? p.input;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { /* keep the raw string */ }
  }
  const out = scanForward(store, fileId, span.ref.line, (r) => {
    const q = r.payload;
    return q && (q.type === 'function_call_output' || q.type === 'custom_tool_call_output') && q.call_id === p.call_id ? q : undefined;
  });
  const body = out?.output;
  return { input: inputPreview(args), output: preview(typeof body === 'string' ? body : textOf(body) ?? body) };
}

/**
 * @param {import('./types.js').RunSpan} span
 * @param {{ readLineAt(id: number, line: number): string|null, lineCount(id: number): number, name(id: number): string }} store
 * @returns unredacted detail
 */
export function buildDetail(span, store) {
  const fileId = fileIdOf(span);
  const line = span.ref?.line;
  let input = null; let output = null; let file = null;
  if (fileId !== null) {
    try {
      file = store.name(fileId);
      const o = parse(store.readLineAt(fileId, line));
      if (o) {
        const r = span.source === 'codex' ? codexInOut(span, store, fileId, o) : claudeInOut(span, store, fileId, o);
        input = r.input; output = r.output;
      }
    } catch {
      // file gone or outside the folders: show the span without bodies
    }
  }
  return {
    id: span.id,
    kind: span.kind,
    name: span.name,
    ...(span.model ? { model: span.model } : {}),
    status: span.status,
    start: span.start,
    end: span.end,
    durationMs: span.end === null ? null : span.end - span.start,
    ...(span.tokens ? { tokens: span.tokens } : {}),
    ...(span.cost ? { cost: span.cost } : {}),
    ...(span.error ? { error: span.error } : {}),
    input,
    output,
    source: { file, line: line ?? null },
  };
}
