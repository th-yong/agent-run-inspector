// Watches the registered log folders and turns file changes into batches of new lines.
// Primary signal: fs.watch(recursive), collected for 200 ms. fs.watch can miss events (macOS and
// Linux both), so a slow sweep (stat of every recent .jsonl) always runs as a backstop; if
// fs.watch is unsupported or errors, or `usePolling` is set, the sweep runs fast (2 s) instead.
// New files (including sub-agent / child rollouts) are registered in the file store and followed
// from line 1; mapping a file to its parent session is the index's job (call index.list() after
// a batch: it groups children by folder / thread id).
import { readdirSync, statSync, watch as fsWatch } from 'node:fs';
import { join } from 'node:path';
import { createTail, TAIL_MAX_AGE_MS } from './tail.js';

export const DEBOUNCE_MS = 200;
export const POLL_MS = 2000;
export const SAFETY_SWEEP_MS = 10000;

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
    else if (d.isFile() && d.name.endsWith('.jsonl')) visit(p);
  }
}

/**
 * onBatch receives events: `{ fileId, isNew, reset, firstLine, lines }`. `isNew` = the file did not
 * exist when the watcher started (or was never seen). `firstLine === 1` means "from the start of the file".
 * @param {{ roots: string[], store: object, onBatch: (events: object[]) => void,
 *   usePolling?: boolean, debounceMs?: number, pollMs?: number, safetySweepMs?: number,
 *   maxAgeMs?: number, now?: () => number, onError?: (kind: string) => void }} opts
 */
export function createWatcher({
  roots,
  store,
  onBatch,
  usePolling = false,
  debounceMs = DEBOUNCE_MS,
  pollMs = POLL_MS,
  safetySweepMs = SAFETY_SWEEP_MS,
  maxAgeMs = TAIL_MAX_AGE_MS,
  now = Date.now,
  onError = () => {},
}) {
  let events = [];
  const tail = createTail({
    store,
    maxAgeMs,
    now,
    onLines: (fileId, ev) => events.push({ fileId, isNew: newIds.has(fileId), ...ev }),
  });
  const seen = new Map(); // path -> "size:mtime:ino" at last sweep
  const known = new Set(); // paths present at start
  const newIds = new Set();
  const dirty = new Set();
  const watchers = [];
  let mode = 'stopped';
  let debounce = null;
  let sweepTimer = null;

  function stamp(path) {
    try {
      const st = statSync(path);
      return st.isFile() ? { key: `${st.size}:${st.mtimeMs}:${st.ino}`, mtimeMs: st.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  // Looks at every recent .jsonl; marks the ones that differ from the last look as dirty.
  function sweep({ baseline = false } = {}) {
    for (const root of roots) {
      walk(root, (p) => {
        const s = stamp(p);
        if (!s) return;
        if (baseline) {
          known.add(p);
          seen.set(p, s.key);
          return;
        }
        if (now() - s.mtimeMs > maxAgeMs) return;
        if (seen.get(p) !== s.key) {
          seen.set(p, s.key);
          dirty.add(p);
        }
      });
    }
  }

  function handlePath(p) {
    let fileId;
    try {
      fileId = store.add(p);
    } catch {
      return; // not a regular file inside a root (gone, symlink out, ...)
    }
    if (!known.has(p)) {
      newIds.add(fileId);
      known.add(p);
    }
    tail.track(fileId); // false when older than 24 h: not followed
    tail.poll(fileId);
    if (newIds.has(fileId) && !events.some((e) => e.fileId === fileId)) {
      events.push({ fileId, isNew: true, reset: false, firstLine: 1, lines: [] });
    }
  }

  /** Processes everything marked dirty and delivers one batch. Synchronous. */
  function flush() {
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
    const paths = [...dirty];
    dirty.clear();
    for (const p of paths) {
      if (!p.endsWith('.jsonl')) continue;
      const s = stamp(p);
      if (s) seen.set(p, s.key);
      handlePath(p);
    }
    // Followed files can also have grown without an event.
    tail.pollAll();
    const out = events;
    events = [];
    if (out.length) {
      try {
        onBatch(out);
      } catch {
        onError('batch-handler');
      }
    }
    return out;
  }

  function schedule() {
    if (debounce) return;
    debounce = setTimeout(flush, debounceMs);
    debounce.unref?.();
  }

  function startSweepTimer(ms) {
    sweepTimer = setInterval(() => {
      sweep();
      if (dirty.size) schedule();
    }, ms);
    sweepTimer.unref?.();
  }

  function fallBackToPolling(kind) {
    onError(kind);
    for (const w of watchers.splice(0)) {
      try {
        w.close();
      } catch {
        // already closed
      }
    }
    if (sweepTimer) clearInterval(sweepTimer);
    mode = 'poll';
    startSweepTimer(pollMs);
  }

  function start() {
    if (mode !== 'stopped') return;
    sweep({ baseline: true });
    if (usePolling) {
      mode = 'poll';
      startSweepTimer(pollMs);
      return;
    }
    mode = 'watch';
    for (const root of roots) {
      try {
        const w = fsWatch(root, { recursive: true, persistent: false }, (_type, name) => {
          if (name === null || name === undefined) {
            sweep();
          } else if (String(name).endsWith('.jsonl')) {
            dirty.add(join(root, String(name)));
          } else {
            return;
          }
          schedule();
        });
        w.on('error', () => fallBackToPolling('watch-error'));
        watchers.push(w);
      } catch {
        fallBackToPolling('watch-unsupported');
        return;
      }
    }
    startSweepTimer(safetySweepMs);
  }

  function stop() {
    for (const w of watchers.splice(0)) {
      try {
        w.close();
      } catch {
        // already closed
      }
    }
    if (debounce) clearTimeout(debounce);
    if (sweepTimer) clearInterval(sweepTimer);
    debounce = null;
    sweepTimer = null;
    mode = 'stopped';
  }

  return { start, stop, flush, sweep, tail, get mode() { return mode; } };
}
