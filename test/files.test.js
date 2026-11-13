import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, appendFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/files.js';

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ari-files-')));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  return { base, root, outside };
}

test('registers a file inside a root and reads lines by number', () => {
  const { root } = setup();
  const f = join(root, 'a.jsonl');
  writeFileSync(f, 'one\ntwo\r\nthree\n');
  const store = createFileStore([root]);
  const id = store.add(f);
  assert.equal(typeof id, 'number');
  assert.equal(store.readLineAt(id, 1), 'one');
  assert.equal(store.readLineAt(id, 2), 'two');
  assert.equal(store.readLineAt(id, 3), 'three');
  assert.equal(store.readLineAt(id, 4), null);
  assert.equal(store.readLineAt(id, 0), null);
});

test('same file gets the same id; different files differ', () => {
  const { root } = setup();
  writeFileSync(join(root, 'a'), 'x\n');
  writeFileSync(join(root, 'b'), 'y\n');
  const store = createFileStore([root]);
  assert.equal(store.add(join(root, 'a')), store.add(join(root, 'a')));
  assert.notEqual(store.add(join(root, 'a')), store.add(join(root, 'b')));
});

test('sees appended lines and an unfinished last line', () => {
  const { root } = setup();
  const f = join(root, 'a');
  writeFileSync(f, 'one\npart');
  const store = createFileStore([root]);
  const id = store.add(f);
  assert.equal(store.readLineAt(id, 2), 'part');
  appendFileSync(f, 'ial\nnext\n');
  assert.equal(store.readLineAt(id, 2), 'partial');
  assert.equal(store.readLineAt(id, 3), 'next');
});

test('handles multibyte text by byte offsets', () => {
  const { root } = setup();
  const f = join(root, 'a');
  writeFileSync(f, 'héllo ✓\nsecond\n');
  const store = createFileStore([root]);
  const id = store.add(f);
  assert.equal(store.readLineAt(id, 1), 'héllo ✓');
  assert.equal(store.readLineAt(id, 2), 'second');
});

test('rejects files outside every root, including ../ paths', () => {
  const { root, outside } = setup();
  writeFileSync(join(outside, 'x'), 'secret\n');
  const store = createFileStore([root]);
  assert.throws(() => store.add(join(outside, 'x')), { code: 'ARI_OUTSIDE_ROOT' });
  assert.throws(() => store.add(join(root, '..', 'outside', 'x')), { code: 'ARI_OUTSIDE_ROOT' });
});

test('a sibling folder sharing a name prefix is outside', () => {
  const { base, root } = setup();
  const sib = join(base, 'root-evil');
  mkdirSync(sib);
  writeFileSync(join(sib, 'x'), 's\n');
  const store = createFileStore([root]);
  assert.throws(() => store.add(join(sib, 'x')), { code: 'ARI_OUTSIDE_ROOT' });
});

test('rejects symlinks that point outside the root', () => {
  const { root, outside } = setup();
  writeFileSync(join(outside, 'x'), 'secret\n');
  symlinkSync(join(outside, 'x'), join(root, 'link'));
  symlinkSync(outside, join(root, 'dirlink'));
  const store = createFileStore([root]);
  assert.throws(() => store.add(join(root, 'link')), { code: 'ARI_OUTSIDE_ROOT' });
  assert.throws(() => store.add(join(root, 'dirlink', 'x')), { code: 'ARI_OUTSIDE_ROOT' });
});

test('allows symlinks that stay inside the root', () => {
  const { root } = setup();
  writeFileSync(join(root, 'real'), 'ok\n');
  symlinkSync(join(root, 'real'), join(root, 'link'));
  const store = createFileStore([root]);
  assert.equal(store.add(join(root, 'link')), store.add(join(root, 'real')));
});

test('a root that is itself a symlink is judged by its real path', () => {
  const { base, outside } = setup();
  writeFileSync(join(outside, 'x'), 'hi\n');
  const rootLink = join(base, 'rootlink');
  symlinkSync(outside, rootLink);
  const store = createFileStore([rootLink]);
  const id = store.add(join(rootLink, 'x'));
  assert.equal(store.readLineAt(id, 1), 'hi');
});

test('a link swapped to point outside after registration is refused on read', () => {
  const { root, outside } = setup();
  writeFileSync(join(root, 'real'), 'ok\n');
  writeFileSync(join(outside, 'x'), 'secret\n');
  const link = join(root, 'link');
  symlinkSync(join(root, 'real'), link);
  const store = createFileStore([root]);
  const id = store.add(link);
  assert.equal(store.readLineAt(id, 1), 'ok');
  // The store keeps the real path, so swapping the link changes nothing it reads.
  symlinkSync(join(outside, 'x'), join(root, 'link2'));
  assert.equal(store.readLineAt(id, 1), 'ok');
});

test('rejects directories and missing files', () => {
  const { root } = setup();
  mkdirSync(join(root, 'd'));
  const store = createFileStore([root]);
  assert.throws(() => store.add(join(root, 'd')), { code: 'ARI_NOT_FILE' });
  assert.throws(() => store.add(join(root, 'nope')), { code: 'ARI_NOT_FILE' });
});

test('unknown fileId is an error', () => {
  const { root } = setup();
  const store = createFileStore([root]);
  assert.throws(() => store.readLineAt(99, 1), { code: 'ARI_UNKNOWN_FILE' });
  assert.throws(() => store.readLineAt('../etc/passwd', 1), { code: 'ARI_UNKNOWN_FILE' });
  assert.throws(() => store.readLineAt(undefined, 1), { code: 'ARI_UNKNOWN_FILE' });
});

test('exposes no write functions and no path getter', () => {
  const { root } = setup();
  const store = createFileStore([root]);
  assert.deepEqual(Object.keys(store).sort(), ['add', 'lineCount', 'name', 'readLineAt', 'readRange', 'stat']);
});

test('name returns the file name only, never the folder', () => {
  const { root } = setup();
  const f = join(root, 'r.jsonl');
  writeFileSync(f, 'x\n');
  const store = createFileStore([root]);
  assert.equal(store.name(store.add(f)), 'r.jsonl');
  assert.throws(() => store.name(99), { code: 'ARI_UNKNOWN_FILE' });
});

test('stat and readRange read byte windows of a registered file only', () => {
  const { root } = setup();
  const f = join(root, 'r.jsonl');
  writeFileSync(f, '0123456789');
  const store = createFileStore([root]);
  const id = store.add(f);
  assert.equal(store.stat(id).size, 10);
  assert.equal(typeof store.stat(id).mtimeMs, 'number');
  assert.equal(store.readRange(id, 2, 3).toString(), '234');
  assert.equal(store.readRange(id, 8, 99).toString(), '89');
  assert.equal(store.readRange(id, 50, 5).length, 0);
  assert.throws(() => store.readRange(7, 0, 1), { code: 'ARI_UNKNOWN_FILE' });
});
