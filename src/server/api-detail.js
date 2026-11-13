// /api/spans/:id/detail and /api/redact. Kept apart from api.js so the two features merge cleanly.
import { buildDetail } from '../model/detail.js';
import { MODES } from '../model/redact.js';

const MAX_BODY = 1024;

function readBody(req) {
  return new Promise((resolve) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { resolve(null); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

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
    if (pathname === '/api/redact') {
      if (req.method === 'GET') return send(res, 200, 'raw', { mode: redactor.mode(), floor: redactor.floor() });
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, 'raw', { error: 'method_not_allowed' }); }
      // A browser always sends Origin on POST; a missing one means not our page.
      if (req.headers.origin === undefined) return send(res, 403, 'raw', { error: 'forbidden' });
      const body = await readBody(req);
      if (!body) return send(res, 400, 'raw', { error: 'bad_request' });
      if (!MODES.includes(body.mode)) return send(res, 400, 'raw', { error: 'bad_request' });
      if (!redactor.set(body.mode)) return send(res, 403, 'raw', { error: 'below_start_level' });
      return send(res, 200, 'raw', { mode: redactor.mode(), floor: redactor.floor() });
    }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, 'raw', { error: 'method_not_allowed' }); }
    const m = /^\/api\/spans\/(.+)\/detail$/.exec(pathname);
    let spanId;
    try { spanId = m && decodeURIComponent(m[1]); } catch { return send(res, 400, 'raw', { error: 'bad_id' }); }
    if (!spanId) return send(res, 404, 'raw', { error: 'not_found' });
    const span = findSpan(spanId, url.searchParams.get('session'));
    if (!span) return send(res, 404, 'raw', { error: 'not_found' });
    return send(res, 200, 'detail', buildDetail(span, index.store));
  }

  const matches = (p) => p === '/api/redact' || (p.startsWith('/api/spans/') && p.endsWith('/detail'));
  return { handle, matches, remember };
}
