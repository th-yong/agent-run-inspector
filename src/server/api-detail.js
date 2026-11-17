// /api/spans/:id/detail. Kept apart from api.js.
import { buildDetail } from '../model/detail.js';

/**
 * @param {{ index: object, redactor: object, send: (res, status, kind, body) => boolean,
 *   port: () => number }} deps send() is the shared serializer in api.js.
 */
export function createDetailRoutes({ index, redactor, send }) {
  const owner = new Map(); // span id -> session id, learned when a session is served

  function remember(sessionId, spans) {
    for (const s of spans) owner.set(s.id, sessionId);
  }

  function findSpan(spanId, hint) {
    for (const sid of [hint, owner.get(spanId)]) {
      if (!sid) continue;
      let opened;
      try { opened = index.open(sid); } catch { continue; }
      const span = opened.spans.find((s) => s.id === spanId);
      if (span) return span;
    }
    return null;
  }

  async function handle(req, res, url) {
    const { pathname } = url;
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, 'raw', { error: 'method_not_allowed' }); }
    const m = /^\/api\/spans\/(.+)\/detail$/.exec(pathname);
    let spanId;
    try { spanId = m && decodeURIComponent(m[1]); } catch { return send(res, 400, 'raw', { error: 'bad_id' }); }
    if (!spanId) return send(res, 404, 'raw', { error: 'not_found' });
    const span = findSpan(spanId, url.searchParams.get('session'));
    if (!span) return send(res, 404, 'raw', { error: 'not_found' });
    return send(res, 200, 'detail', buildDetail(span, index.store));
  }

  const matches = (p) => p.startsWith('/api/spans/') && p.endsWith('/detail');
  return { handle, matches, remember };
}
