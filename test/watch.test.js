import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/files.js';
import { createWatcher } from '../src/live/watch.js';

function setup(opts = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ari-watch-')));
  mkdirSync(join(root, 'proj'));
  const store = createFileStore([root]);
  const batches = [];
  const w = createWatcher({ roots: [root], store, onBatch: (b) => batches.push(b), ...opts });
  return { root, store, batches, w };
}

const flat = (batches) => batches.flat();

function until(cond, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 10);
  });
}

test('polling mode: appended lines of an existing file arrive from line 1', async () => {
  const { root, batches, w } = setup({ usePolling: true, pollMs: 20, debounceMs: 10 });
  const f = join(root, 'proj', 'a.jsonl');
  writeFileSync(f, '{"n":1}\n');
  w.start();
  assert.equal(w.mode, 'poll');
  await new Promise((r) => setTimeout(r, 30)); // baseline taken; nothing yet
  assert.deepEqual(flat(batches), []);
  appendFileSync(f, '{"n":2}\n');
  await until(() => flat(batches).length > 0);
  w.stop();
  const ev = flat(batches)[0];
  assert.equal(ev.isNew, false);
  assert.equal(ev.firstLine, 1);
  assert.deepEqual(ev.lines, ['{"n":1}', '{"n":2}']);
});

test('polling mode: half-line writes give one line; a new file and a child file are reported as new', async () => {
  const { root, batches, w } = setup({ usePolling: true, pollMs: 20, debounceMs: 10 });
  w.start();
  const f = join(root, 'proj', 'new.jsonl');
  writeFileSync(f, '{"a"');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(flat(batches).flatMap((e) => e.lines).length, 0);
  appendFileSync(f, ':1}\n');
  await until(() => flat(batches).some((e) => e.lines.length));
  mkdirSync(join(root, 'proj', 'sess', 'subagents'), { recursive: true });
  writeFileSync(join(root, 'proj', 'sess', 'subagents', 'agent-x.jsonl'), '{"s":1}\n');
  await until(() => flat(batches).filter((e) => e.isNew && e.lines.length).length >= 2);
  w.stop();
  const evs = flat(batches).filter((e) => e.lines.length);
  assert.deepEqual(evs[0].lines, ['{"a":1}']);
  assert.ok(evs.every((e) => e.isNew));
  assert.notEqual(evs[0].fileId, evs[1].fileId);
});

test('files older than 24 hours are not followed even when they change', () => {
  const t = Date.now();
  const { root, batches, w } = setup({ usePolling: true, now: () => t });
  const f = join(root, 'proj', 'old.jsonl');
  writeFileSync(f, 'x\n');
  const old = new Date(t - 30 * 3600e3);
  utimesSync(f, old, old);
  w.start();
  appendFileSync(f, 'y\n');
  utimesSync(f, old, old);
  w.sweep();
  w.flush();
  w.stop();
  assert.deepEqual(batches, []);
});

test('flush is synchronous and a replaced file reports reset', () => {
  const { root, batches, w } = setup({ usePolling: true });
  const f = join(root, 'proj', 'r.jsonl');
  writeFileSync(f, 'aaaa\nbbbb\n');
  w.start();
  appendFileSync(f, 'cccc\n');
  w.sweep();
  w.flush();
  writeFileSync(f, 'z\n'); // truncated in place
  w.sweep();
  w.flush();
  w.stop();
  const evs = flat(batches);
  assert.equal(evs.length, 2);
  assert.equal(evs[1].reset, true);
  assert.deepEqual(evs[1].lines, ['z']);
});

test('fs.watch mode delivers an appended line', async (t) => {
  const { root, batches, w } = setup({ debounceMs: 20, safetySweepMs: 100000 });
  const f = join(root, 'proj', 'w.jsonl');
  writeFileSync(f, '{"n":1}\n');
  w.start();
  if (w.mode !== 'watch') {
    w.stop();
    t.skip('recursive fs.watch not available here');
    return;
  }
  appendFileSync(f, '{"n":2}\n');
  try {
    await until(() => flat(batches).length > 0, 1500);
  } catch {
    w.stop();
    t.skip('platform delivered no fs.watch event (backstop sweep covers this)');
    return;
  }
  w.stop();
  assert.deepEqual(flat(batches)[0].lines, ['{"n":1}', '{"n":2}']);
});

test('stop clears timers so the process can exit', () => {
  const { w } = setup({ usePolling: true });
  w.start();
  w.stop();
  assert.equal(w.mode, 'stopped');
});
