// Finds session files under the registered roots and groups them into sessions.
// It reads only directory listings, stat data and the first few KB of Codex rollouts
// (to learn which thread a rollout belongs to). Entries hold fileIds, never paths.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createFileStore } from '../files.js';
import { OrcaDispatches, workerOf, DISPATCH_MARKS, WORKER_MARK, WORKER_HEAD_MARKS } from '../adapters/claude-code/orca.js';

export const HEAD_BYTES = 16 * 1024;
export const TAIL_BYTES = 16 * 1024;
const HEAD_MAX = 512 * 1024;

const UUID_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** '24h' / '7d' (or a number of ms) -> ms; null when not given. */
export function parseSince(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && v > 0) return v;
  const m = /^([1-9]\d*)([hd])$/.exec(String(v));
  if (!m) throw new Error(`Invalid --since value: ${v}`);
  return Number(m[1]) * (m[2] === 'h' ? 3600e3 : 86400e3);
}

function parseLines(text) {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      if (o && typeof o === 'object') out.push(o);
    } catch {
      // cut or damaged line
    }
  }
  return out;
}

/** Complete lines from the start of a file. Widens the window until the first line fits. */
export function readHead(store, fileId, size, bytes = HEAD_BYTES) {
  let n = bytes;
  for (;;) {
    const buf = store.readRange(fileId, 0, n);
    const text = buf.toString('utf8');
    const cut = n < size;
    if (!cut) return parseLines(text);
    const nl = text.lastIndexOf('\n');
    if (nl !== -1) return parseLines(text.slice(0, nl));
    if (n >= HEAD_MAX) return [];
    n *= 4;
  }
}

/** Head and tail lines; one read when the file is small. */
export function readEnds(store, fileId, size) {
  if (size > HEAD_BYTES + TAIL_BYTES) return { head: readHead(store, fileId, size), tail: readTail(store, fileId, size) };
  const lines = parseLines(store.readRange(fileId, 0, size).toString('utf8'));
  return { head: lines, tail: lines };
}

/** Complete lines from the end of a file (the first, possibly partial, line is dropped). */
export function readTail(store, fileId, size, bytes = TAIL_BYTES) {
  const start = Math.max(0, size - bytes);
  const text = store.readRange(fileId, start, size - start).toString('utf8');
  if (start === 0) return parseLines(text);
  const nl = text.indexOf('\n');
  return nl === -1 ? [] : parseLines(text.slice(nl + 1));
}

export const TITLE_SCAN_BYTES = 256 * 1024;
const TITLE_MARK = Buffer.from('"type":"ai-title"');

/**
 * The newest Claude Code title (ai-title) within the last `bytes` of a file, or undefined.
 * Long tool output can push the title out of the head and tail windows; it is rewritten often,
 * so the last one is near the end. A raw byte search: only the matching line is parsed.
 */
export function findLastTitle(store, fileId, size, bytes = TITLE_SCAN_BYTES) {
  const start = Math.max(0, size - bytes);
  const buf = store.readRange(fileId, start, size - start);
  for (let at = buf.lastIndexOf(TITLE_MARK); at !== -1; at = at > 0 ? buf.lastIndexOf(TITLE_MARK, at - 1) : -1) {
    const from = buf.lastIndexOf(10, at) + 1; // 10 = "\n"
    if (from === 0 && start > 0) return undefined; // the line starts before the window
    const nl = buf.indexOf(10, at);
    try {
      const r = JSON.parse(buf.subarray(from, nl === -1 ? buf.length : nl).toString('utf8'));
      if (r?.type === 'ai-title' && typeof r.aiTitle === 'string' && r.aiTitle) return r.aiTitle;
    } catch { /* cut line, or the text appears inside another record */ }
  }
  return undefined;
}

function walk(dir, visit) {
  let list;
  try {
    list = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of list) {
    if (d.isSymbolicLink()) continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, visit);
    else if (d.isFile()) visit(p, d.name);
  }
}

// Short folder names for the "which folder" mark; distinct per root, never a full path.
export function rootLabels(paths) {
  const parts = paths.map((p) => {
    const segs = p.split(/[\\/]+/).filter(Boolean);
    if (['projects', 'sessions'].includes(segs.at(-1)) && segs.length > 1) segs.pop();
    return segs;
  });
  for (let depth = 1; depth <= 4; depth++) {
    const labels = parts.map((s) => s.slice(-depth).join('/'));
    if (new Set(labels).size === labels.length) return labels;
  }
  return parts.map((s, i) => `${s.at(-1) ?? 'root'}#${i + 1}`);
}

// store.add already proved the path is a regular file inside a root.
function statOf(path, fileId) {
  const { size, mtimeMs } = statSync(path);
  return { fileId, size, mtimeMs };
}

// Agent-team teammates are logged as their own top-level session file; their head lines carry
// `teamName` + `agentName`. Returns `name@team` (the lead's teammate_id) or null.
function mateKey(store, file, cache) {
  const k = `cc:${file.fileId}`;
  if (cache.has(k)) return cache.get(k);
  const head = readHead(store, file.fileId, file.size);
  const r = head.find((x) => typeof x.teamName === 'string' && typeof x.agentName === 'string');
  const key = r ? `${r.agentName}@${r.teamName}` : null;
  if (key || file.size > HEAD_BYTES) cache.set(k, key); // a young file may not have the line yet
  return key;
}

// teammate_ids a lead file has spawned; reads only bytes appended since the last call.
const MARK = Buffer.from('"teammate_id":"');
const QUOTE = 0x22;
export const SCAN_CHUNK = 8 * 1024 * 1024;

export function spawnedIds(store, file, cache) {
  const k = `ids:${file.fileId}`;
  let c = cache.get(k);
  if (!c || file.size < c.offset) c = { offset: 0, ids: new Set() };
  // Searched as bytes, chunk by chunk: lead files can be tens of MB. Only complete lines are consumed.
  let size = SCAN_CHUNK;
  while (file.size > c.offset) {
    const buf = store.readRange(file.fileId, c.offset, Math.min(size, file.size - c.offset));
    const end = buf.lastIndexOf(0x0a) + 1;
    if (end === 0) {
      if (c.offset + buf.length >= file.size) break; // unfinished last line: wait for its newline
      size *= 2; // one line longer than the chunk
      continue;
    }
    size = SCAN_CHUNK;
    for (let i = buf.indexOf(MARK); i !== -1 && i < end; i = buf.indexOf(MARK, i + 1)) {
      const from = i + MARK.length;
      const to = buf.indexOf(QUOTE, from);
      if (to !== -1 && to < end) c.ids.add(buf.toString('utf8', from, to));
    }
    c.offset += end;
  }
  cache.set(k, c);
  return c.ids;
}

// Moves teammate entries under the lead that spawned them (as subs). A teammate run in a worktree
// logs under that worktree's folder (`<lead folder>--claude-worktrees-...`), so a lead is looked for
// in the teammate's folder and in folders whose name prefixes it; only those leads are read.
// ponytail: prefix match only; a teammate whose cwd is not under the lead's cwd stays unlinked.
function linkTeammates(list, store, cache) {
  const mates = [];
  const leads = [];
  for (const e of list) {
    const key = mateKey(store, e.main, cache);
    if (key) mates.push({ e, key });
    else leads.push(e);
  }
  if (!mates.length) return list;
  const mateDirs = new Set(mates.map((m) => m.e.dir));
  const owner = new Map(); // key -> newest lead that spawned it, per lead folder
  for (const l of leads) {
    if (![...mateDirs].some((d) => d.startsWith(l.dir))) continue;
    for (const id of spawnedIds(store, l.main, cache)) {
      if (!owner.has(id)) owner.set(id, []);
      owner.get(id).push(l);
    }
  }
  const out = [...leads];
  mates.sort((a, b) => a.e.main.mtimeMs - b.e.main.mtimeMs); // newest last: it wins the lookup
  for (const { e, key } of mates) {
    const lead = (owner.get(key) ?? [])
      .filter((l) => e.dir.startsWith(l.dir))
      .reduce((a, b) => (!a || b.main.mtimeMs > a.main.mtimeMs ? b : a), null);
    if (!lead) { out.push(e); continue; }
    lead.subs.push({ ...e.main, agentId: key, metaFileId: null, mate: true });
    lead.lastWrite = Math.max(lead.lastWrite, e.lastWrite);
  }
  return out;
}

// An Orca worker's task id (and start time), from its file's first user record: Orca's dispatch prompt,
// often ~60 KB in, after attachment records. Only the first user record counts: a later quote of the prompt
// is not a worker. Most files settle within the first 16 KB; a file is read again only when it grew.
const WORKER_SCAN = 256 * 1024;
const ORCA_HEAD = 8 * 1024;
const USER_MARK = Buffer.from('"type":"user"');
function firstUser(buf) {
  for (let at = 0; at < buf.length;) {
    const nl = buf.indexOf(10, at);
    if (nl === -1) break; // the line may still be being written
    const line = buf.subarray(at, nl);
    at = nl + 1;
    if (!line.includes(USER_MARK)) continue;
    let r = null;
    try { r = JSON.parse(line.toString('utf8')); } catch { /* not a record */ }
    if (r?.type !== 'user') continue;
    const w = line.includes(WORKER_MARK) ? workerOf(r) : undefined;
    const t = Date.parse(r.timestamp);
    // the worker's folder names it when its coordinator's result did not
    const folder = typeof r.cwd === 'string' ? r.cwd.split(/[\\/]/).filter(Boolean).at(-1) : undefined;
    return { found: true, key: w ? { ...w, folder, ts: Number.isFinite(t) ? t : 0 } : null };
  }
  return { found: false, key: null };
}
function workerKey(store, file, cache) {
  const k = `ow:${file.fileId}`;
  const hit = cache.get(k);
  if (hit && (hit.settled || hit.size === file.size)) return hit.key;
  // Orca starts its workers itself (not the claude CLI), and the first records say so: any other file is
  // settled from a small head with a byte search, no line walk
  const head = store.readRange(file.fileId, 0, Math.min(file.size, ORCA_HEAD));
  let res = { found: false, key: null };
  let n = head.length;
  if (WORKER_HEAD_MARKS.some((m) => head.includes(m))) {
    n = Math.min(file.size, WORKER_SCAN);
    const buf = n > head.length ? store.readRange(file.fileId, 0, n) : head;
    res = buf.includes(WORKER_MARK) ? firstUser(buf) : { found: n >= WORKER_SCAN, key: null };
  }
  const orca = WORKER_HEAD_MARKS.some((m) => head.includes(m));
  const settled = res.found || n >= WORKER_SCAN || (!orca && n < file.size);
  cache.set(k, { size: file.size, key: res.key, settled });
  return res.key;
}

// Orca task ids a file started (worker-start results), with when; reads only bytes appended since the last call.
export function dispatchedTasks(store, file, cache) {
  const k = `od:${file.fileId}`;
  let c = cache.get(k);
  if (!c || file.size < c.offset) c = { offset: 0, d: new OrcaDispatches() };
  let size = SCAN_CHUNK;
  while (file.size > c.offset) {
    const buf = store.readRange(file.fileId, c.offset, Math.min(size, file.size - c.offset));
    const end = buf.lastIndexOf(0x0a) + 1;
    if (end === 0) {
      if (c.offset + buf.length >= file.size) break;
      size *= 2;
      continue;
    }
    size = SCAN_CHUNK;
    // only lines holding a mark are parsed: a worker-start call, or a result naming a task
    const hits = new Set();
    for (const m of DISPATCH_MARKS) for (let i = buf.indexOf(m); i !== -1 && i < end; i = buf.indexOf(m, i + 1)) hits.add(buf.lastIndexOf(10, i) + 1);
    for (const from of [...hits].sort((a, b) => a - b)) {
      let r = null;
      try { r = JSON.parse(buf.toString('utf8', from, buf.indexOf(10, from))); } catch { /* cut line */ }
      const t = typeof r?.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
      if (r?.type === 'assistant') c.d.onAssistant(r, Number.isFinite(t) ? t : null, 0);
      else if (r?.type === 'user') c.d.onUser(r);
    }
    c.offset += end;
  }
  cache.set(k, c);
  return c.d.tasks;
}

// Moves Orca worker entries under the session that started them (as subs, like teammates). A task named
// by two sessions goes to the earlier worker-start.
function linkOrcaWorkers(list, store, cache) {
  const workers = [];
  const rest = [];
  for (const e of list) {
    const key = workerKey(store, e.main, cache);
    if (key) workers.push({ e, key });
    else rest.push(e);
  }
  if (!workers.length) return list;
  const owner = new Map(); // task or dispatch id -> { lead, start }
  // a coordinator writes after its workers start: older sessions are not read
  const since = Math.min(...workers.map((w) => w.key.ts));
  for (const l of rest) {
    if (l.lastWrite < since) continue;
    for (const [task, call] of dispatchedTasks(store, l.main, cache)) {
      const o = owner.get(task);
      if (!o || call.start < o.start) owner.set(task, { lead: l, start: call.start });
    }
  }
  for (const { e, key: { task, dispatch, folder } } of workers) {
    const key = owner.has(task) ? task : dispatch;
    const o = owner.get(key);
    if (!o) { rest.push(e); continue; }
    // the worker's own sub-agents come along (linked to its Agent calls by tool_use id)
    o.lead.subs.push({ ...e.main, agentId: key, metaFileId: null, mate: true, name: folder }, ...e.subs);
    o.lead.lastWrite = Math.max(o.lead.lastWrite, e.lastWrite);
  }
  return rest;
}

function scanClaude(roots, store, accept, cache = new Map()) {
  const found = [];
  const labels = roots.length > 1 ? rootLabels(roots.map((r) => r.path)) : [];
  roots.forEach((root, ri) => {
    let projects = [];
    try {
      projects = readdirSync(root.path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const proj of projects) {
      if (proj.isSymbolicLink() || !proj.isDirectory()) continue;
      const pdir = join(root.path, proj.name);
      let names = [];
      try {
        names = readdirSync(pdir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of names) {
        if (!f.isFile() || f.isSymbolicLink() || !f.name.endsWith('.jsonl')) continue;
        const sid = f.name.slice(0, -'.jsonl'.length);
        let main;
        try {
          const p = join(pdir, f.name);
          main = statOf(p, store.add(p));
        } catch {
          continue;
        }
        const subs = [];
        const sdir = join(pdir, sid, 'subagents');
        walk(sdir, (p, name) => {
          if (dirname(p) !== sdir || !/^agent-.+\.jsonl$/.test(name)) return;
          try {
            const sub = { ...statOf(p, store.add(p)), agentId: name.slice('agent-'.length, -'.jsonl'.length), metaFileId: null };
            try {
              sub.metaFileId = store.add(p.replace(/\.jsonl$/, '.meta.json'));
            } catch {
              // no meta file
            }
            subs.push(sub);
          } catch {
            // skip unreadable
          }
        });
        subs.sort((a, b) => (a.agentId < b.agentId ? -1 : 1));
        const lastWrite = Math.max(main.mtimeMs, ...subs.map((s) => s.mtimeMs));
        found.push({
          id: sid, source: 'claude-code', main, subs, lastWrite, project: proj.name, dir: `${ri}/${proj.name}`,
          ...(labels.length ? { origin: labels[ri] } : {}),
        });
      }
    }
  });
  return linkOrcaWorkers(linkTeammates(found, store, cache), store, cache).filter((e) => accept(e.lastWrite));
}

function codexHead(store, file, cache) {
  const hit = cache.get(file.fileId);
  if (hit) return hit;
  const first = readHead(store, file.fileId, file.size)[0];
  const p = first?.type === 'session_meta' ? first.payload : null;
  const info = typeof p?.id === 'string'
    ? { id: p.id, parent: p.parent_thread_id ?? p.source?.subagent?.thread_spawn?.parent_thread_id ?? null }
    : { id: null, parent: null };
  cache.set(file.fileId, info);
  return info;
}

function scanCodex(roots, store, accept, cache) {
  const labels = roots.length > 1 ? rootLabels(roots.map((r) => r.path)) : [];
  const files = [];
  roots.forEach((root, ri) => {
    walk(root.path, (p, name) => {
      if (!/^rollout-.*\.jsonl$/.test(name)) return;
      try {
        const f = statOf(p, store.add(p));
        const m = UUID_END.exec(name);
        files.push({ ...f, nameId: m ? m[1] : null, origin: labels[ri] });
      } catch {
        // skip unreadable
      }
    });
  });
  const nodes = files.map((f) => ({ ...f, ...codexHead(store, f, cache), kids: [] }));
  const byThread = new Map();
  for (const n of nodes) if (n.id && !byThread.has(n.id)) byThread.set(n.id, n);
  const tops = [];
  for (const n of nodes) {
    const parent = n.parent && n.parent !== n.id ? byThread.get(n.parent) : null;
    if (parent) parent.kids.push(n);
    else tops.push(n);
  }
  const out = [];
  for (const t of tops) {
    const seen = new Set([t]);
    const children = [];
    const stack = [...t.kids];
    while (stack.length) {
      const k = stack.shift();
      if (seen.has(k)) continue;
      seen.add(k);
      children.push({ fileId: k.fileId, size: k.size, mtimeMs: k.mtimeMs });
      stack.push(...k.kids);
    }
    const lastWrite = Math.max(t.mtimeMs, ...children.map((c) => c.mtimeMs));
    if (!accept(lastWrite)) continue;
    out.push({
      id: t.id ? `cx:${t.id}` : `cx:unknown:${t.fileId}`,
      source: 'codex', unknown: !t.id,
      main: { fileId: t.fileId, size: t.size, mtimeMs: t.mtimeMs },
      children, lastWrite,
      ...(t.origin ? { origin: t.origin } : {}),
    });
  }
  return out;
}

/**
 * @param {{ roots: { claude?: {path:string}[], codex?: {path:string}[] }, source?: string,
 *   since?: string|number, now?: number, store: ReturnType<typeof createFileStore>, headCache?: Map }} o
 * @returns {object[]} entries (fileIds only), newest write first
 */
export function scanRoots({ roots, source = 'all', since, now = Date.now(), store, headCache = new Map() }) {
  const sinceMs = parseSince(since);
  const accept = (t) => sinceMs === null || t >= now - sinceMs;
  const want = (s) => source === 'all' || source === s;
  const out = [];
  if (want('claude')) out.push(...scanClaude(roots.claude ?? [], store, accept, headCache));
  if (want('codex')) out.push(...scanCodex(roots.codex ?? [], store, accept, headCache));
  // the same session id found under two roots: keep the newer one
  const best = new Map();
  for (const e of out) if (!best.has(e.id) || best.get(e.id).lastWrite < e.lastWrite) best.set(e.id, e);
  return [...best.values()].sort((a, b) => b.lastWrite - a.lastWrite || (a.id < b.id ? -1 : 1));
}

