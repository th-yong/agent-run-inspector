import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('app.css braces are balanced', () => {
  assert.equal((css.match(/{/g) ?? []).length, (css.match(/}/g) ?? []).length);
});

test('every @media / @keyframes / @container block starts at the top level (a missing } would nest the rest)', () => {
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    else if (css[i] === '@' && /^@(media|keyframes|container)/.test(css.slice(i, i + 12))) assert.equal(depth, 0, `nested at: ${css.slice(i, i + 50)}`);
  }
});
