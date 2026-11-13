// Talking to the local server: JSON fetches, server-sent events, merging of span changes by seq.
export class ApiError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

// A 401 means the server was restarted (new token): the cookie of this tab no longer matches.
let authLostHandler = () => {};
let authLost = false;
export const onAuthLost = (fn) => { authLostHandler = fn; };
function lost() {
  if (authLost) return;
  authLost = true;
  authLostHandler();
}

async function getJson(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (res.status === 401) lost();
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

export const fetchSessions = async () => (await getJson('/api/sessions')).sessions;
export const fetchRoots = async () => (await getJson('/api/roots')).roots;
export const fetchSession = (id) => getJson(`/api/sessions/${encodeURIComponent(id)}`);
export const fetchSpanDetail = (spanId, sessionId) =>
  getJson(`/api/spans/${encodeURIComponent(spanId)}/detail${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''}`);

/** A newer (higher seq) span replaces the stored one; stale or repeated events are ignored. Returns true if applied. */
export function mergeSpan(spans, span) {
  const prev = spans.get(span.id);
  if (prev && (prev.seq ?? 0) >= (span.seq ?? 0)) return false;
  spans.set(span.id, span);
  return true;
}

/** Returns a new list with the summary replaced by id, or appended. */
export function upsertSession(list, summary) {
  const i = list.findIndex((s) => s.id === summary.id);
  if (i < 0) return [...list, summary];
  const next = list.slice();
  next[i] = summary;
  return next;
}

// Opens an EventSource. `onOpen` fires on every (re)connect, `onError` when the connection drops.
// The browser reconnects by itself and sends Last-Event-ID; the server answers {"type":"resync"}
// when it cannot fill the gap.
function stream(path, { onEvent, onOpen, onError }) {
  const es = new EventSource(path);
  es.onopen = () => onOpen?.();
  es.onerror = () => {
    onError?.();
    // An event stream does not say why it failed; ask a plain request whether the cookie is still good.
    fetch('/api/redact', { headers: { accept: 'application/json' } }).then((r) => { if (r.status === 401) { es.close(); lost(); } }, () => {});
  };
  es.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    onEvent(data);
  };
  return () => es.close();
}

/**
 * Session-list stream. Events can be missed while disconnected, so the full list is loaded on
 * every connect and reconnect (`onList`) and again on `resync`. Returns a stop function.
 */
export function watchList({ onList, onSession, onStatus }) {
  const reload = async () => {
    try { onList(await fetchSessions()); } catch { onStatus?.('list-error'); }
  };
  return stream('/api/sessions/stream', {
    onOpen: () => { onStatus?.('connected'); reload(); },
    onError: () => onStatus?.('reconnecting'),
    onEvent: (ev) => {
      if (ev.type === 'resync') reload();
      else if (ev.type === 'session' && ev.summary) onSession(ev.summary);
    },
  });
}

/** Per-session stream; `onReset` is called on connect and resync so the caller reloads the full session. */
export function watchSession(id, { onSpan, onTotals, onReset, onStatus }) {
  return stream(`/api/sessions/${encodeURIComponent(id)}/stream`, {
    onOpen: () => { onStatus?.('connected'); onReset?.(); },
    onError: () => onStatus?.('reconnecting'),
    onEvent: (ev) => {
      if (ev.type === 'resync') onReset?.();
      else if (ev.type === 'span' && ev.span) onSpan?.(ev.span);
      else if (ev.type === 'totals') onTotals?.(ev.totals);
    },
  });
}

/** Most calls kept in the browser for one run. A tab left open for days would otherwise grow without end. */
export const MAX_CALLS = 5000;

/**
 * Drops the oldest finished calls beyond `max`. Agents and calls still running stay; the totals come from the
 * server, so they do not change. Returns how many were dropped.
 */
export function trimSpans(spans, max = MAX_CALLS) {
  const calls = [];
  for (const s of spans.values()) if (s.kind === 'llm' || s.kind === 'tool') calls.push(s);
  const extra = calls.length - max;
  if (extra <= 0) return 0;
  const old = calls.filter((s) => s.end != null).sort((a, b) => (a.end - b.end) || (a.start - b.start));
  let n = 0;
  for (const s of old.slice(0, extra)) { spans.delete(s.id); n++; }
  return n;
}
