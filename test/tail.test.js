import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, truncateSync, renameSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/files.js';
import { createTail } from '../src/live/tail.js';
import { ClaudeCodeSession } from '../src/adapters/claude-code/index.js';

function setup(opts = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ari-tail-')));
  const store = createFileStore([root]);
  const got = [];
  const tail = createTail({ store, onLines: (id, ev) => got.push({ id, ...ev }), ...opts });
  const path = join(root, 'a.jsonl');
  return { root, store, tail, got, path };
}

const texts = (got) => got.flatMap((g) => g.lines);

test('writing half a line emits nothing until the newline arrives', () => {
  const { store, tail, got, path } = setup();
  writeFileSync(path, '{"a":');
  const id = store.add(path);
  tail.track(id);
  tail.poll(id);
  assert.deepEqual(texts(got), []);
  appendFileSync(path, '1}\n{"b"');
  tail.poll(id);
  assert.deepEqual(texts(got), ['{"a":1}']);
  assert.equal(got[0].firstLine, 1);
  appendFileSync(path, ':2}\n');
  tail.poll(id);
  assert.deepEqual(texts(got), ['{"a":1}', '{"b":2}']);
  assert.equal(got[1].firstLine, 2);
});

test('a multi-byte character split across writes survives', () => {
  const { store, tail, got, path } = setup();
  const bytes = Buffer.from('가나\n');
  writeFileSync(path, bytes.subarray(0, 4));
  const id = store.add(path);
  tail.track(id);
  tail.poll(id);
  appendFileSync(path, bytes.subarray(4));
  tail.poll(id);
  assert.deepEqual(texts(got), ['가나']);
});

test('unchanged file is not read again', () => {
  const { store, tail, got, path } = setup();
  writeFileSync(path, 'x\n');
  const id = store.add(path);
  tail.track(id);
  tail.poll(id);
  tail.poll(id);
  assert.equal(got.length, 1);
});

test('truncation restarts from the beginning with reset', () => {
  const { store, tail, got, path } = setup();
  writeFileSync(path, 'one\ntwo\nthree\n');
  const id = store.add(path);
  tail.track(id);
  tail.poll(id);
  truncateSync(path, 0);
  writeFileSync(path, 'new\n');
  tail.poll(id);
  const last = got.at(-1);
  assert.equal(last.reset, true);
  assert.equal(last.firstLine, 1);
  assert.deepEqual(last.lines, ['new']);
});

test('replacing the file (new inode, even if larger) restarts from the beginning', () => {
  const { root, store, tail, got, path } = setup();
  writeFileSync(path, 'old\n');
  const id = store.add(path);
  tail.track(id);
  tail.poll(id);
  writeFileSync(join(root, 'tmp'), 'brand new content\nsecond\n');
  renameSync(join(root, 'tmp'), path);
  tail.poll(id);
  const last = got.at(-1);
  assert.equal(last.reset, true);
  assert.deepEqual(last.lines, ['brand new content', 'second']);
});

test('track can resume from a known offset and line number', () => {
  const { store, tail, got, path } = setup();
  writeFileSync(path, 'a\nb\nc\n');
  const id = store.add(path);
  tail.track(id, { offset: 4, lineNo: 2 });
  tail.poll(id);
  assert.deepEqual(texts(got), ['c']);
  assert.equal(got[0].firstLine, 3);
});

test('only files changed in the last 24 hours are tracked', () => {
  const t = Date.now();
  const { store, tail, path } = setup({ now: () => t });
  writeFileSync(path, 'x\n');
  const id = store.add(path);
  const old = new Date(t - 25 * 3600e3);
  utimesSync(path, old, old);
  assert.equal(tail.track(id), false);
  const fresh = new Date(t - 3600e3);
  utimesSync(path, fresh, fresh);
  assert.equal(tail.track(id), true);
});

test('CRLF is stripped and a blank line keeps its number', () => {
  const { store, tail, got, path } = setup();
  writeFileSync(path, 'a\r\n\nb\n');
  const id = store.add(path);
  tail.track(id);
  tail.poll(id);
  assert.deepEqual(texts(got), ['a', '', 'b']);
});

test('feeding the Claude Code parser half-lines at a time equals feeding the whole file', () => {
  const lines = [
    { type: 'user', sessionId: 's1', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/x/proj', message: { role: 'user', content: 'hi' } },
    { type: 'ai-title', sessionId: 's1', aiTitle: 'Title' },
    { type: 'user', sessionId: 's1', timestamp: '2026-01-01T00:00:05.000Z', message: { role: 'user', content: 'again' } },
  ].map((o) => JSON.stringify(o));
  const whole = new ClaudeCodeSession({ fileId: '0', sessionId: 's1', now: 0 });
  whole.push(lines.join('\n') + '\n');

  const { store, tail, path } = setup();
  const live = new ClaudeCodeSession({ fileId: '0', sessionId: 's1', now: 0 });
  tail.setHandler((id, ev) => {
    if (ev.reset) throw new Error('unexpected reset');
    live.push(ev.lines.join('\n') + '\n');
  });
  writeFileSync(path, '');
  const id = store.add(path);
  tail.track(id);
  const all = lines.join('\n') + '\n';
  for (let i = 0; i < all.length; i += 7) {
    appendFileSync(path, all.slice(i, i + 7));
    tail.poll(id);
  }
  assert.deepEqual(live.snapshot(), whole.snapshot());
});
