// Call detail block: kind, name, times, five token kinds, cost with its basis, status, error, input/output previews
// (cut by the server at 2 KB, length only in redact mode) and the original file name:line with a copy button.
// Standalone so the timeline (T34) can reuse it: createCallDetail().update({ span, sessionId }).
// Pure helpers are exported for tests; `document` is touched only inside createCallDetail().
import { S } from './strings.js';
import { fmtDuration, fmtTokens, fmtUsd } from './format.js';
import { fetchSpanDetail } from './api.js';

const known = (n) => typeof n === 'number' && Number.isFinite(n);
const DASH = '—';

/** What to draw for a preview from the server: nothing, a hidden notice (length only) or text. */
export function previewView(p) {
  if (!p) return { kind: 'none' };
  if (p.hidden) return { kind: 'hidden', length: p.length ?? 0, keys: Array.isArray(p.keys) ? p.keys : null };
  return { kind: 'text', text: String(p.text ?? ''), length: p.length ?? 0, truncated: Boolean(p.truncated), keys: Array.isArray(p.keys) ? p.keys : null };
}

/** The five token kinds in a fixed order; unknown values show a dash. */
export function tokenRows(tokens) {
  const v = (n) => (known(n) ? fmtTokens(n) : DASH);
  return [
    { label: S.call.input, value: v(tokens?.input) },
    { label: S.call.output, value: v(tokens?.output) },
    { label: S.call.cacheRead, value: v(tokens?.cacheRead) },
    { label: S.call.cacheWrite, value: v(tokens?.cacheWrite) },
    { label: S.call.reasoning, value: v(tokens?.reasoning) },
  ];
}

export function costView(cost) {
  if (!cost || !known(cost.usd)) return { text: DASH, basis: S.totals.basis.unknown };
  return { text: fmtUsd(cost.usd), basis: S.totals.basis[cost.basis] ?? S.totals.basis.unknown };
}

/** "file.jsonl:42" for the copy button; null when the file is unknown. */
export function sourceRefText(source) {
  if (!source?.file) return null;
  return known(source.line) ? `${source.file}:${source.line}` : source.file;
}

export function clockText(ms) {
  if (!known(ms)) return DASH;
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ---------------- DOM ----------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function previewBlock(title, hint, p, { pending }) {
  const box = el('div', 'cd-pv');
  const h = el('h4');
  h.append(el('span', '', title), el('span', '', hint ?? ''));
  box.append(h);
  const v = previewView(p);
  if (v.kind === 'text') {
    const pre = el('pre', '', v.text);
    pre.tabIndex = 0; // scrollable region reachable by keyboard
    box.append(pre);
    if (v.truncated) box.append(el('div', 'cd-note', S.call.truncated(v.length)));
  } else if (v.kind === 'hidden') {
    box.append(el('div', 'cd-hidden', S.call.hiddenBody(v.length)));
    if (v.keys?.length) box.append(el('div', 'cd-note', `${S.call.hiddenKeys}: ${v.keys.join(', ')}`));
  } else {
    box.append(el('div', 'cd-hidden', pending ? S.call.notFinished : S.call.noPreview));
  }
  return box;
}

/**
 * createCallDetail({ load }) -> { el, update({ span, sessionId }), destroy() }
 * The facts come from the span (so they follow live changes); previews, error and source come from the
 * server once per version of the span. `load(spanId, sessionId)` defaults to GET /api/spans/:id/detail.
 */
export function createCallDetail({ load = fetchSpanDetail } = {}) {
  const root = el('div', 'cd');
  root.setAttribute('role', 'region');
  let key = '';
  let ticket = 0;
  let detail = null;
  let failed = false;
  let loading = false;
  let last = null;
  let copyTimer = 0;

  function facts(span) {
    const dl = el('dl', 'cd-facts');
    const add = (label, value, cls) => {
      dl.append(el('dt', '', label));
      const dd = el('dd', cls ?? 'num');
      if (value instanceof Node) dd.append(value); else dd.textContent = value;
      dl.append(dd);
    };
    const llm = span.kind === 'llm';
    const running = span.status === 'running' || !known(span.end);
    add(S.call.kind, llm ? S.call.llm : S.call.tool, '');
    add(S.call.name, span.name ?? DASH);
    if (llm && span.model && span.model !== span.name) add(S.call.model, span.model);
    const status = el('span', span.status === 'error' ? 'cd-err' : span.status === 'running' ? 'cd-run' : '', S.status[span.status] ?? S.status.unknown);
    add(S.call.status, status, '');
    add(S.call.started, clockText(span.start));
    add(S.call.ended, running ? S.call.stillRunning : clockText(span.end));
    add(S.call.duration, known(span.end) ? fmtDuration(span.end - span.start) : `${fmtDuration(Date.now() - span.start)} ${S.call.elapsed}`);
    if (llm) {
      for (const r of tokenRows(span.tokens)) add(r.label, r.value);
      const c = costView(span.cost);
      const v = el('span', '', c.text);
      if (c.text !== DASH) v.append(el('span', 'cd-basis', c.basis));
      add(S.call.cost, v);
    } else {
      add(S.panel.tokens, S.call.notCounted, '');
    }
    return dl;
  }

  function render() {
    if (!last) return;
    const { span } = last;
    const err = detail?.error ?? span.error;
    const parts = [facts(span)];
    const side = el('div', 'cd-side');
    if (err) {
      const box = el('div', 'cd-errbox');
      box.append(el('b', '', S.call.error), ` · ${err.message ?? ''}`);
      side.append(box);
    }
    if (loading && !detail) side.append(el('div', 'cd-note', S.call.loading));
    else if (failed && !detail) side.append(el('div', 'cd-note', S.call.loadFailed));
    else if (detail) {
      const running = span.status === 'running' || !known(span.end);
      const inp = detail.input;
      side.append(previewBlock(S.call.inputPreview, inp?.hidden ? '' : S.call.max2k, inp, { pending: false }));
      side.append(previewBlock(S.call.outputPreview, '', detail.output, { pending: running }));
      const ref = sourceRefText(detail.source);
      if (ref) {
        const row = el('div', 'cd-ref');
        row.append(el('span', '', `${S.call.source}: `), el('code', '', ref));
        const btn = el('button', 'cd-copy', S.call.copy);
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          let ok = true;
          try { await navigator.clipboard.writeText(ref); } catch { ok = false; }
          btn.textContent = ok ? S.call.copied : S.call.copyFailed;
          clearTimeout(copyTimer);
          copyTimer = setTimeout(() => { btn.textContent = S.call.copy; }, 1500);
        });
        row.append(btn);
        side.append(row);
      }
    }
    parts.push(side);
    root.replaceChildren(...parts);
  }

  return {
    el: root,
    update({ span, sessionId }) {
      last = { span, sessionId };
      const next = `${span.id}|${span.seq ?? ''}|${span.status}|${span.end ?? ''}`;
      if (next === key) return;
      const sameCall = key.split('|')[0] === span.id;
      key = next;
      if (!sameCall) { detail = null; failed = false; }
      loading = true;
      const mine = ++ticket;
      render();
      load(span.id, sessionId).then(
        (d) => { if (mine === ticket) { detail = d; failed = false; loading = false; render(); } },
        () => { if (mine === ticket) { failed = true; loading = false; render(); } },
      );
    },
    destroy() { ticket++; clearTimeout(copyTimer); },
  };
}
