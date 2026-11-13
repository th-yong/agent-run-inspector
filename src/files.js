import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const CHUNK = 64 * 1024;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function realOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function inside(root, real) {
  const rel = relative(root, real);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Read-only access to run-log files under registered roots. Files are known only by an
// opaque numeric fileId; callers never get a path back and nothing here writes.
export function createFileStore(roots) {
  const realRoots = roots.map((r) => realOrNull(resolve(r))).filter(Boolean);
  const files = []; // fileId -> { real, starts: number[], scanned: number }
  const byPath = new Map();

  function add(path) {
    const real = realOrNull(resolve(path));
    if (!real) throw fail('ARI_NOT_FILE', 'Not a readable file');
    if (!realRoots.some((r) => inside(r, real))) throw fail('ARI_OUTSIDE_ROOT', 'File is outside the registered log folders');
    let isFile = false;
    try {
      isFile = statSync(real).isFile();
    } catch {
      // handled below
    }
    if (!isFile) throw fail('ARI_NOT_FILE', 'Not a readable file');
    if (byPath.has(real)) return byPath.get(real);
    const id = files.length;
    files.push({ real, starts: [0], scanned: 0 });
    byPath.set(real, id);
    return id;
  }

  function entry(fileId) {
    const e = Number.isInteger(fileId) ? files[fileId] : undefined;
    if (!e) throw fail('ARI_UNKNOWN_FILE', 'Unknown fileId');
    return e;
  }

  // Opens the stored real path again and re-checks it is still inside a root.
  function open(e) {
    const real = realOrNull(e.real);
    if (!real || !realRoots.some((r) => inside(r, real))) throw fail('ARI_OUTSIDE_ROOT', 'File is outside the registered log folders');
    const fd = openSync(real, constants.O_RDONLY);
    return { fd, size: fstatSync(fd).size };
  }

  // Extends the line-start index over bytes appended since the last scan.
  function scan(e, fd, size) {
    if (size < e.scanned) {
      e.starts = [0];
      e.scanned = 0;
    }
    const buf = Buffer.alloc(CHUNK);
    while (e.scanned < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - e.scanned), e.scanned);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 0x0a) e.starts.push(e.scanned + i + 1);
      e.scanned += n;
    }
  }

  // 1-based line number. Returns null past the end. An unfinished last line is returned as is.
  function readLineAt(fileId, line) {
    const e = entry(fileId);
    if (!Number.isInteger(line) || line < 1) return null;
    const { fd, size } = open(e);
    try {
      scan(e, fd, size);
      const start = e.starts[line - 1];
      if (start === undefined || start >= size) return null;
      let end = e.starts[line] === undefined ? size : e.starts[line] - 1;
      const out = Buffer.alloc(end - start);
      readSync(fd, out, 0, out.length, start);
      let text = out.toString('utf8');
      if (text.endsWith('\r')) text = text.slice(0, -1);
      return text;
    } finally {
      closeSync(fd);
    }
  }

  // Number of lines, counting an unfinished last line.
  function lineCount(fileId) {
    const e = entry(fileId);
    const { fd, size } = open(e);
    try {
      scan(e, fd, size);
      return e.starts[e.starts.length - 1] >= size ? e.starts.length - 1 : e.starts.length;
    } finally {
      closeSync(fd);
    }
  }

  return { add, readLineAt, lineCount };
}
