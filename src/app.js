// Assembles the app: config -> index -> server -> watcher. Used by bin/cli.js.
// The console gets the address and error kinds only, never record contents.
import { createIndex } from './index/index.js';
import { createRedactor } from './model/redact.js';
import { createApiHandler } from './server/api.js';
import { startServer } from './server/http.js';
import { createWatcher } from './live/watch.js';
import { loadPrices } from './cost.js';
import { MSG } from './strings.js';

/**
 * @param {{ config: object, roots: {claude: object[], codex: object[]}, port?: number, source?: string,
 *   since?: string, redact?: 'basic'|'strict', prices?: string, session?: string,
 *   webDir?: string, usePolling?: boolean }} opts
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startApp({ config, roots, port = 0, source, since, redact, prices, session, webDir, usePolling }) {
  const pricer = loadPrices({ file: prices, config: config.prices });
  const index = createIndex({ roots, source, since, watcherNamePatterns: config.watcherNamePatterns, pricer });
  const redactor = createRedactor({ mode: redact ?? 'off' });
  const api = createApiHandler({ index, roots, redactor });

  // Served only when web/ has no index.html yet, so "/" never looks broken.
  const handler = async (req, res) => {
    if (await api(req, res)) return true;
    if ((req.method === 'GET' || req.method === 'HEAD') && new URL(req.url, 'http://127.0.0.1').pathname === '/') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : `${MSG.noWebUi}\n`);
      return true;
    }
    return false;
  };

  const srv = await startServer({ port, handler, ...(webDir ? { webDir } : {}) });
  const watcher = createWatcher({
    roots: [...roots.claude, ...roots.codex].map((r) => r.path),
    store: index.store,
    onBatch: api.live.onBatch,
    usePolling,
  });
  watcher.start();

  const url = new URL(srv.url);
  if (session) url.searchParams.set('s', session);

  let closing = null;
  const close = () => {
    closing ??= (async () => {
      watcher.stop();
      api.live.close();
      await srv.close();
    })();
    return closing;
  };
  return { url: url.href, port: srv.port, close };
}
