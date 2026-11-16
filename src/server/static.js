import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

// Served without the cookie: browsers fetch the web app manifest and its icons without credentials.
// They hold nothing about the logs.
export const PUBLIC_FILES = ['manifest.webmanifest', 'icon-32.png', 'icon-192.png', 'icon-512.png'];

// The only files the server will ever hand out, keyed by request path.
// No path is ever built from the request: unknown paths are simply 404.
// Add a name here when a new web/ module is added.
export const WEB_FILES = [
  'index.html',
  'app.css',
  'app.js',
  'agent-panel.js',
  'api.js',
  'call-detail.js',
  'card.js',
  'format.js',
  'graph-layout.js',
  'mini.js',
  'groups.js',
  'graph.js',
  'icons.js',
  'live-follow.js',
  'redact-toggle.js',
  'run-header.js',
  'session-list.js',
  'state.js',
  'strings.js',
  'timeline-group.js',
  'timeline-scale.js',
  'timeline.js',
];

// The tab icon is /icon-32.png (public); /favicon.ico is not served (it arrives cross-site and cookie-less).

function lookup(pathname, files) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  return files.includes(name) ? name : null;
}

// Returns true when it answered the request.
export async function serveStatic(req, res, webDir, files = WEB_FILES) {
  const name = lookup(new URL(req.url, 'http://127.0.0.1').pathname, files);
  if (!name) return false;
  let data;
  try {
    data = await readFile(join(webDir, name));
  } catch {
    return false;
  }
  const ext = name.slice(name.lastIndexOf('.'));
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', data.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}
