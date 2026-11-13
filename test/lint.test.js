import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, lintAll } from '../scripts/lint.js';

const rules = (path, text) => checkSource(path, text).map((v) => v.rule);

test('flags external URL in src/ and web/ but not allowlisted ones', () => {
  assert.deepEqual(rules('src/a.js', "fetch('https://example.com/x');"), ['external-url']);
  assert.deepEqual(rules('web/a.js', "const u = 'http://cdn.test/a.js';"), ['external-url']);
  assert.deepEqual(rules('src/a.js', "const u = 'http://127.0.0.1:1234/';"), []);
  assert.deepEqual(rules('bin/a.js', "const u = 'https://example.com';"), []);
});

test('flags child_process.exec( and shell: true', () => {
  assert.deepEqual(rules('src/a.js', 'child_process.exec("ls");'), ['exec']);
  assert.deepEqual(
    rules('src/a.js', "import { exec } from 'node:child_process';\nexec('ls');"),
    ['exec'],
  );
  assert.deepEqual(rules('src/a.js', "execFile('ls', [], { shell: true });"), ['shell-true']);
  assert.deepEqual(rules('src/a.js', "execFile('ls', ['-l']);"), []);
});

test('flags inline style attribute only in web/', () => {
  assert.deepEqual(rules('web/a.js', "el.innerHTML = '<p style=\"color:red\">';"), ['inline-style']);
  assert.deepEqual(rules('src/a.js', "const s = '<p style=\"x\">';"), []);
});

test('flags Hangul literals outside strings.js, ignores comments', () => {
  assert.deepEqual(rules('web/a.js', "const t = '한글';"), ['hangul']);
  assert.deepEqual(rules('src/a.js', "const t = '한글';"), ['hangul']);
  assert.deepEqual(rules('web/strings.js', "export const t = '한글';"), []);
  assert.deepEqual(rules('src/a.js', '// 한글 comment\nconst a = 1;'), []);
  assert.deepEqual(rules('test/a.js', "const t = '한글';"), []);
});

test('the repository itself is lint-clean', () => {
  assert.deepEqual(lintAll(), []);
});
