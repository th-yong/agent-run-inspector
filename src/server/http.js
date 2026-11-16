import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  newToken, hasValidCookie, setCookieHeader, hostAllowed, originAllowed, tokenMatches,
} from './auth.js';
import { serveStatic } from './static.js';

const HOST = '127.0.0.1'; // fixed on purpose: not configurable
const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web', import.meta.url));

const CSP = "default-src 'self'; img-src 'self' data:; connect-src 'self'";

function plain(res, status, text, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(text + '\n');
}

// startServer({ port = 0, webDir, handler, token, cookieMaxAge }) -> { server, port, token, url, close }
// A given `token` and `cookieMaxAge` are for service mode (a fixed token that survives restarts);
// by default each start makes a new token and a session cookie.
// `handler(req, res)` is called for authenticated requests that are not static files;
// return true if it answered. Anything else is a 404.
export async function startServer({ port = 0, webDir = DEFAULT_WEB_DIR, handler, token = newToken(), cookieMaxAge } = {}) {
  let boundPort = 0;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!hostAllowed(req.headers.host, boundPort)) return plain(res, 403, 'Forbidden');
      if (!originAllowed(req.headers.origin, boundPort)) return plain(res, 403, 'Forbidden');

      const url = new URL(req.url, `http://127.0.0.1:${boundPort}`);
      if (url.pathname === '/favicon.ico') {
        res.statusCode = 204;
        return res.end();
      }

      if (url.searchParams.has('t')) {
        if (!tokenMatches(url.searchParams.get('t'), token)) return plain(res, 401, 'Unauthorized');
        url.searchParams.delete('t');
        res.statusCode = 302;
        res.setHeader('Set-Cookie', setCookieHeader(boundPort, token, cookieMaxAge));
        res.setHeader('Location', url.pathname + url.search);
        res.setHeader('Cache-Control', 'no-store');
        return res.end();
      }

      if (!hasValidCookie(req, boundPort, token)) return plain(res, 401, 'Unauthorized');

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (await serveStatic(req, res, webDir)) return;
      }
      if (handler && (await handler(req, res)) === true) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      }
      return plain(res, 404, 'Not Found');
    } catch {
      if (!res.headersSent) plain(res, 500, 'Internal Server Error');
      else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port }, resolve);
  });
  boundPort = server.address().port;

  return {
    server,
    port: boundPort,
    token,
    url: `http://127.0.0.1:${boundPort}/?t=${token}`,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
