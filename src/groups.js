// Session groups: names the user gives to a set of sessions ("Shop API", "Blog"). Kept next to
// config.json as groups.json; the logs are never written. One session belongs to at most one group.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from './config.js';

export const groupsPath = (env = process.env) => join(dirname(configPath(env)), 'groups.json');

const MAX_GROUPS = 50;
const MAX_NAME = 40;
const MAX_SESSIONS = 1000; // per group
const ID = /^[a-z0-9-]{1,40}$/;

/** A clean { groups } document, or null when `doc` is not one. A session listed twice keeps its first group. */
export function cleanGroups(doc) {
  if (!doc || !Array.isArray(doc.groups) || doc.groups.length > MAX_GROUPS) return null;
  const seen = new Set();
  const ids = new Set();
  const groups = [];
  for (const g of doc.groups) {
    const name = typeof g?.name === 'string' ? g.name.trim() : '';
    if (!ID.test(g?.id ?? '') || ids.has(g.id) || !name || name.length > MAX_NAME) return null;
    if (!Array.isArray(g.sessions) || g.sessions.length > MAX_SESSIONS) return null;
    if (!g.sessions.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200)) return null;
    ids.add(g.id);
    groups.push({ id: g.id, name, sessions: g.sessions.filter((s) => !seen.has(s) && seen.add(s)) });
  }
  return { groups };
}

/** file: where to keep the groups; null keeps them in memory (tests). */
export function createGroupStore({ file = null } = {}) {
  let doc = { groups: [] };
  if (file) {
    try { doc = cleanGroups(JSON.parse(readFileSync(file, 'utf8'))) ?? doc; } catch { /* none yet, or unreadable: start empty */ }
  }
  return {
    get: () => doc,
    /** Returns the saved document, or null when `next` is not valid. */
    set(next) {
      const clean = cleanGroups(next);
      if (!clean) return null;
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
        renameSync(tmp, file);
      }
      doc = clean;
      return doc;
    },
  };
}
