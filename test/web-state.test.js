import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, toSearch } from '../web/state.js';

test('parseState reads every address field and defaults the tab to graph', () => {
  assert.deepEqual(parseState(''), { s: null, tab: 'graph', sel: null, open: null, gsel: null, gopen: null, hide: false, theme: null, mini: false });
  assert.deepEqual(
    parseState('?s=abc&tab=timeline&sel=a1&open=c9&gsel=g1&gopen=c3&theme=dark'),
    { s: 'abc', tab: 'timeline', sel: 'a1', open: 'c9', gsel: 'g1', gopen: 'c3', hide: false, theme: 'dark', mini: false },
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
  assert.deepEqual(st, { s: id, tab: 'timeline', sel: 'a 1', open: null, gsel: null, gopen: null, hide: false, theme: 'light', mini: false });
});

test('hide round-trips as ?hide=1 and is left out when off', () => {
  assert.equal(parseState('?hide=1').hide, true);
  assert.equal(parseState('?hide=0').hide, false);
  assert.equal(toSearch({ s: 'x', tab: 'graph', hide: true }), '?s=x&hide=1');
  assert.equal(toSearch({ s: 'x', tab: 'graph', hide: false }), '?s=x');
});

test('view=mini round-trips', () => {
  const st = parseState('?view=mini&s=x');
  assert.equal(st.mini, true);
  assert.equal(toSearch(st), '?s=x&view=mini');
  assert.equal(parseState('?view=other').mini, false);
});
