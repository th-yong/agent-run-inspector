// Follows appended lines of run-log files through the file store (read-only).
// Per file it keeps: size, mtime, inode, the byte offset just past the last complete line, and the
// number of lines handed out. An unfinished last line is simply not consumed: the offset stays
// before it, so the next poll re-reads it once the newline has arrived.
// If the file got smaller or its inode changed, reading restarts from byte 0 and the callback is
// told with `reset: true` (the consumer must drop its parser state for that file).

// spec §11-7 (cc-file-rotation, real logs, counts only): 14 of 397 main files contain a
// compact_boundary, none changes sessionId afterwards and no sessionId spans two files, so
// compaction does not rotate files. The reset path stays as a safeguard.

export const TAIL_MAX_AGE_MS = 24 * 3600e3;
const READ_CHUNK = 1024 * 1024;

/**
 * @param {{ store: { stat(id:number):{size:number,mtimeMs:number,ino?:number}, readRange(id:number,o:number,l:number):Buffer },
 *   onLines?: (fileId:number, ev:{ lines:string[], firstLine:number, reset:boolean }) => void,
 *   maxAgeMs?: number, now?: () => number }} opts
 */
export function createTail({ store, onLines, maxAgeMs = TAIL_MAX_AGE_MS, now = Date.now }) {
  let handler = onLines ?? (() => {});
  const files = new Map(); // fileId -> { size, mtimeMs, ino, offset, lineNo }

  function setHandler(fn) {
    handler = fn;
  }

  /** Starts following a file. Returns false when it was not modified within `maxAgeMs`. */
  function track(fileId, { offset = 0, lineNo = 0 } = {}) {
    if (files.has(fileId)) return true;
    const st = store.stat(fileId);
    if (now() - st.mtimeMs > maxAgeMs) return false;
    files.set(fileId, { size: -1, mtimeMs: -1, ino: st.ino, offset, lineNo });
    return true;
  }

  function untrack(fileId) {
    files.delete(fileId);
  }

  const tracked = () => [...files.keys()];

  /** Reads what was appended since the last poll. Returns the number of lines emitted. */
  function poll(fileId) {
    const f = files.get(fileId);
    if (!f) return 0;
    let st;
    try {
      st = store.stat(fileId);
    } catch {
      return 0; // gone for now; a later poll may find it again
    }
    let reset = false;
    if (st.size < f.offset || (f.ino !== undefined && st.ino !== undefined && st.ino !== f.ino)) {
      reset = true;
      f.offset = 0;
      f.lineNo = 0;
    } else if (st.size === f.size && st.mtimeMs === f.mtimeMs) {
      return 0;
    }
    f.size = st.size;
    f.mtimeMs = st.mtimeMs;
    f.ino = st.ino;

    const lines = [];
    let carry = Buffer.alloc(0);
    let pos = f.offset;
    while (pos < st.size) {
      const buf = store.readRange(fileId, pos, Math.min(READ_CHUNK, st.size - pos));
      if (!buf.length) break;
      pos += buf.length;
      let data = carry.length ? Buffer.concat([carry, buf]) : buf;
      let start = 0;
      let nl;
      while ((nl = data.indexOf(0x0a, start)) !== -1) {
        let text = data.toString('utf8', start, nl);
        if (text.endsWith('\r')) text = text.slice(0, -1);
        lines.push(text);
        f.offset += nl + 1 - start;
        start = nl + 1;
      }
      carry = data.subarray(start);
    }
    if (!lines.length && !reset) return 0;
    const firstLine = f.lineNo + 1;
    f.lineNo += lines.length;
    handler(fileId, { lines, firstLine, reset });
    return lines.length;
  }

  function pollAll() {
    let n = 0;
    for (const id of files.keys()) n += poll(id);
    return n;
  }

  return { track, untrack, tracked, poll, pollAll, setHandler };
}
