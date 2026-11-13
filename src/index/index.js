// Session index: scan the roots, keep cheap summaries, parse a session fully only when it is opened.
import { createFileStore } from '../files.js';
import { scanRoots } from './scan.js';
import { applyRoles } from '../model/roles.js';
import { openEntry, quickSummary } from './summary.js';

const MAX_OPEN = 16;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const signature = (e) => [e.main.mtimeMs, e.main.size, ...(e.subs ?? e.children).map((c) => `${c.fileId}:${c.mtimeMs}:${c.size}`)].join('|');

/**
 * @param {{ roots: { claude?: {path:string}[], codex?: {path:string}[] }, source?: string,
 *   since?: string|number, watcherNamePatterns?: string[], now?: () => number }} opts
 */
export function createIndex({ roots, source = 'all', since, watcherNamePatterns = [], now = Date.now }) {
  const store = createFileStore([...(roots.claude ?? []), ...(roots.codex ?? [])].map((r) => r.path));
  const headCache = new Map();
  const quick = new Map(); // session id -> { sig, summary }
  const opened = new Map(); // session id -> { sig, value } in use order
  let entries = new Map();

  function list() {
    const found = scanRoots({ roots, source, since, now: now(), store, headCache });
    entries = new Map(found.map((e) => [e.id, e]));
    return found.map((e) => {
      const sig = signature(e);
      const hit = quick.get(e.id);
      if (hit && hit.sig === sig) return hit.summary;
      const summary = quickSummary(e, store, now());
      quick.set(e.id, { sig, summary });
      return summary;
    });
  }

  /** Full parse, cached until a file of the session changes. */
  function open(id) {
    const entry = entries.get(id);
    if (!entry) throw fail('ARI_UNKNOWN_SESSION', 'Unknown session');
    const sig = signature(entry);
    const hit = opened.get(id);
    if (hit && hit.sig === sig) {
      opened.delete(id);
      opened.set(id, hit);
      return hit.value;
    }
    const value = openEntry(entry, store, now());
    applyRoles(value.spans, watcherNamePatterns);
    opened.delete(id);
    opened.set(id, { sig, value });
    while (opened.size > MAX_OPEN) opened.delete(opened.keys().next().value);
    return value;
  }

  return { list, open, store };
}
