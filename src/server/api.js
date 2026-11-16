// JSON API for the session views. Plug into startServer({ handler }).
// Sessions and spans are addressed by opaque ids only; no response carries a record-file path.
import { computeTotals } from '../model/totals.js';
import { createRedactor } from '../model/redact.js';
import { createDetailRoutes } from './api-detail.js';
import { createLiveHub } from '../live/sse.js';

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
 * The menu bar's view of one opened session: per agent its name, status, tool-call count and the tool
 * it is in now. Names only; no task, command or message text.
 */
export function briefAgents(spans) {
  const agents = new Map();
  for (const s of spans) {
    if (s.kind === 'agent') agents.set(s.id, { id: s.id, name: s.name, role: s.role, depth: s.depth ?? 0, status: s.status, start: s.start, end: s.end, calls: 0, now: null, nowStart: 0 });
  }
  for (const s of spans) {
    const a = s.kind === 'tool' ? agents.get(s.parentId) : null;
    if (!a) continue;
    a.calls += 1;
    if (s.status === 'running' && s.start >= a.nowStart) { a.now = s.name; a.nowStart = s.start; }
  }
  return [...agents.values()].sort((x, y) => x.depth - y.depth || x.start - y.start);
}

/**
 * @param {{ index: { list(): object[], open(id: string): object },
 *   roots: { claude?: {path:string, origin?:string}[], codex?: {path:string, origin?:string}[] } }} opts
 * @returns {(req, res) => Promise<boolean>}
 */
export function createApiHandler({ index, roots = {}, meta = { version: null, latest: null }, redactor = createRedactor(), pingMs, live = createLiveHub({ index, redactor, pingMs }) }) {
  // Every response is serialized here, so redaction cannot be skipped by a route.
  const send = (res, status, kind, body) => json(res, status, redactor.apply(kind, body));
  const detail = createDetailRoutes({ index, redactor, send });
  const rootsBody = () => ({
    roots: [
      ...(roots.claude ?? []).map((r) => ({ source: 'claude-code', path: r.path, origin: r.origin ?? 'default' })),
      ...(roots.codex ?? []).map((r) => ({ source: 'codex', path: r.path, origin: r.origin ?? 'default' })),
    ],
  });

  const openSession = (id) => {
    try { return index.open(id); } catch (err) {
      if (err?.code !== 'ARI_UNKNOWN_SESSION') throw err;
    }
    index.list(); // the id may be newer than the last listing
    try { return index.open(id); } catch (e) {
      if (e?.code === 'ARI_UNKNOWN_SESSION') return null;
      throw e;
    }
  };

  async function handler(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const { pathname } = url;
    if (detail.matches(pathname)) return detail.handle(req, res, url);
    if (pathname === '/api/meta' && req.method === 'GET') return send(res, 200, 'meta', { version: meta.version, latest: meta.latest });
    if (pathname === '/api/live' && req.method === 'GET') { // running sessions with their agents (menu bar)
      const sessions = index.list().filter((x) => x.status === 'running')
        .map((x) => { const o = openSession(x.id); return o && { ...o.summary, agents: briefAgents(o.spans) }; })
        .filter(Boolean)
        .sort((a, b) => b.lastWrite - a.lastWrite);
      return send(res, 200, 'sessions', { sessions });
    }
    if (pathname !== '/api/roots' && pathname !== '/api/sessions' && !pathname.startsWith('/api/sessions/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return fail(res, 405, 'method_not_allowed');
    }
    if (req.method === 'HEAD' && pathname.endsWith('/stream')) return fail(res, 405, 'method_not_allowed');
    if (pathname === '/api/roots') return send(res, 200, 'roots', rootsBody());
    if (pathname === '/api/sessions') return send(res, 200, 'sessions', { sessions: index.list() });
    if (pathname === '/api/sessions/stream') return live.streamList(req, res);

    const rest = pathname.slice('/api/sessions/'.length);
    const streaming = rest.endsWith('/stream');
    let id;
    try { id = decodeURIComponent(streaming ? rest.slice(0, -'/stream'.length) : rest); } catch { return fail(res, 400, 'bad_id'); }
    if (!id || id.includes('/')) return fail(res, 404, 'not_found');
    const opened = openSession(id);
    if (!opened) return fail(res, 404, 'not_found');
    if (streaming) return live.streamSession(req, res, id, opened);
    const { summary, markers, turns } = opened;
    detail.remember(summary.id, opened.spans);
    const { seq, spans } = live.track(id, opened);
    return send(res, 200, 'session', { summary, spans, markers, turns, seq, totals: computeTotals(opened.spans, { reportedUsd: opened.reportedUsd }) });
  }
  return Object.assign(handler, { live });
}
