// Talking to the local server: JSON fetches, server-sent events, merging of span changes by seq.
export class ApiError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function getJson(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

export const fetchSessions = async () => (await getJson('/api/sessions')).sessions;
export const fetchSession = (id) => getJson(`/api/sessions/${encodeURIComponent(id)}`);

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
  es.onerror = () => onError?.();
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
