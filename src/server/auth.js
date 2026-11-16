import { randomBytes, timingSafeEqual } from 'node:crypto';

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function cookieName(port) {
  return `ari_${port}`;
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function tokenMatches(candidate, token) {
  return typeof candidate === 'string' && same(candidate, token);
}

export function hasValidCookie(req, port, token) {
  return tokenMatches(parseCookies(req.headers.cookie)[cookieName(port)], token);
}

export function setCookieHeader(port, token, maxAge) {
  return `${cookieName(port)}=${token}; HttpOnly; SameSite=Strict; Path=/${maxAge ? `; Max-Age=${maxAge}` : ''}`;
}

export function hostAllowed(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

// A missing Origin is fine (plain navigation); a present one must be this server.
export function originAllowed(origin, port) {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
