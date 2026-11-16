import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => readFileSync(root(p), 'utf8');
const en = read('README.md');
const ko = read('README.ko.md');

// Lines outside fenced code blocks.
function prose(text) {
  let inCode = false;
  const out = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    else if (!inCode) out.push(line);
  }
  return out;
}
const headings = (text) => prose(text).filter((l) => /^#{1,3} /.test(l)).map((l) => l.match(/^#+/)[0].length);
const fences = (text) => (text.match(/^```/gm) ?? []).length / 2;
const images = (text) => text.match(/!\[[^\]]*\]\(([^)]+)\)/g)?.map((m) => m.match(/\(([^)]+)\)/)[1]) ?? [];
const npxLines = (text) => text.split('\n').filter((l) => /^\s*npx /.test(l));
const tables = (text) => prose(text).filter((l) => l.startsWith('|') && !/^\|[-| :]+\|$/.test(l)).length;

test('both READMEs link to each other on the first line', () => {
  assert.match(en.split('\n')[0], /English \| \[한국어\]\(README\.ko\.md\)/);
  assert.match(ko.split('\n')[0], /\[English\]\(README\.md\) \| 한국어/);
});

test('heading levels and order match', () => {
  assert.ok(headings(en).length >= 12);
  assert.deepEqual(headings(ko), headings(en));
});

test('code blocks, tables, images and npx lines match', () => {
  assert.equal(fences(ko), fences(en));
  assert.equal(tables(ko), tables(en));
  assert.deepEqual(images(ko), images(en));
  assert.ok(images(en).includes('docs/demo.gif'));
  assert.deepEqual(npxLines(ko), npxLines(en));
  assert.ok(npxLines(en).some((l) => l.trim() === 'npx agent-run-inspector'));
});

test('option tables list every flag that --help prints', () => {
  const help = execFileSync(process.execPath, [root('bin/cli.js'), '--help'], { encoding: 'utf8' });
  const flags = [...help.matchAll(/^\s{2}(-[^\s]+(?:, --[^\s]+)?|--[^\s]+)/gm)].map((m) => m[1]);
  assert.ok(flags.length >= 10);
  for (const f of flags) {
    for (const name of f.split(', ')) {
      const bare = name.replace(/[=<].*$/, '');
      assert.ok(en.includes(bare), `README.md misses ${bare}`);
      assert.ok(ko.includes(bare), `README.ko.md misses ${bare}`);
    }
  }
});

test('README files are in the package file list', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.files.includes('README.md') && pkg.files.includes('README.ko.md'));
});
