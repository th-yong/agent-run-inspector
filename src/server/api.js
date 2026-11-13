// JSON API for the session views. Plug into startServer({ handler }).
// Sessions and spans are addressed by opaque ids only; no response carries a record-file path.
const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
  return true;
};
const fail = (res, status, error) => json(res, status, { error });

/**
 * @param {{ index: { list(): object[], open(id: string): object },
 *   roots: { claude?: {path:string, origin?:string}[], codex?: {path:string, origin?:string}[] } }} opts
 * @returns {(req, res) => Promise<boolean>}
 */
export function createApiHandler({ index, roots = {} }) {
  const rootsBody = () => ({
    roots: [
      ...(roots.claude ?? []).map((r) => ({ source: 'claude-code', path: r.path, origin: r.origin ?? 'default' })),
      ...(roots.codex ?? []).map((r) => ({ source: 'codex', path: r.path, origin: r.origin ?? 'default' })),
    ],
  });

  return async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (pathname !== '/api/roots' && pathname !== '/api/sessions' && !pathname.startsWith('/api/sessions/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return fail(res, 405, 'method_not_allowed');
    }
    if (pathname === '/api/roots') return json(res, 200, rootsBody());
    if (pathname === '/api/sessions') return json(res, 200, { sessions: index.list() });

    let id;
    try { id = decodeURIComponent(pathname.slice('/api/sessions/'.length)); } catch { return fail(res, 400, 'bad_id'); }
    if (!id || id.includes('/')) return fail(res, 404, 'not_found');
    let opened;
    try {
      opened = index.open(id);
    } catch (err) {
      if (err?.code !== 'ARI_UNKNOWN_SESSION') throw err;
      index.list(); // the id may be newer than the last listing
      try { opened = index.open(id); } catch (e) {
        if (e?.code === 'ARI_UNKNOWN_SESSION') return fail(res, 404, 'not_found');
        throw e;
      }
    }
    const { summary, spans, markers, turns } = opened;
    return json(res, 200, { summary, spans, markers, turns, totals: null }); // totals: T17
  };
}
