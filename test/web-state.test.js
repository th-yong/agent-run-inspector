import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, toSearch } from '../web/state.js';

test('parseState reads every address field and defaults the tab to graph', () => {
  assert.deepEqual(parseState(''), { s: null, tab: 'graph', sel: null, open: null, gsel: null, gopen: null, theme: null });
  assert.deepEqual(
    parseState('?s=abc&tab=timeline&sel=a1&open=c9&gsel=g1&gopen=c3&theme=dark'),
    { s: 'abc', tab: 'timeline', sel: 'a1', open: 'c9', gsel: 'g1', gopen: 'c3', theme: 'dark' },
  );
});

test('parseState ignores unknown tab and theme values', () => {
  const st = parseState('?tab=bogus&theme=purple&s=');
  assert.equal(st.tab, 'graph');
  assert.equal(st.theme, null);
  assert.equal(st.s, null);
});

test('toSearch drops defaults and round-trips, including ids that need encoding', () => {
  assert.equal(toSearch(parseState('')), '');
  assert.equal(toSearch({ s: 'x', tab: 'graph' }), '?s=x');
  const id = 'codex:2026/01/rollout a&b.jsonl';
  const st = parseState(toSearch({ s: id, tab: 'timeline', sel: 'a 1', theme: 'light' }));
  assert.deepEqual(st, { s: id, tab: 'timeline', sel: 'a 1', open: null, gsel: null, gopen: null, theme: 'light' });
});
