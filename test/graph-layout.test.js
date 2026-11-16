import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph, CARD_W, CARD_W_DENSE, WATCH_W, GAP_X, GAP_Y, NARROW_MAX, INDENT, LIST_GAP, GRID_MIN } from '../web/graph-layout.js';

// Synthetic agent spans only.
const root = (extra = {}) => ({ id: 'r', parentId: null, kind: 'agent', start: 0, callCount: 7, task: 't', ...extra });
const kids = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, parentId: 'r', kind: 'agent', start: i + 1, callCount: 5, task: 't', ...extra }));
const byId = (res) => new Map(res.cards.map((c) => [c.id, c]));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlap(res) {
  for (let i = 0; i < res.cards.length; i++)
    for (let j = i + 1; j < res.cards.length; j++)
      assert.ok(!overlap(res.cards[i], res.cards[j]), `${res.cards[i].id} overlaps ${res.cards[j].id}`);
}
function assertInside(res, width) {
  for (const c of res.cards) assert.ok(c.x >= 0 && c.x + c.w <= width + 1e-9, `${c.id} outside 0..${width}`);
}
// Horizontal edge segments must not cross any card.
function assertEdgesClear(res) {
  for (const e of res.edges) {
    for (const s of e.segments) {
      if (s.y1 !== s.y2) continue;
      const [lo, hi] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
      for (const c of res.cards) {
        if (s.y1 > c.y && s.y1 < c.y + c.h && hi > c.x && lo < c.x + c.w) assert.fail(`edge to ${e.to} crosses ${c.id}`);
      }
    }
  }
}

test('empty input gives an empty layout', () => {
  const r = layoutGraph([], { width: 1000 });
  assert.deepEqual(r.cards, []);
  assert.deepEqual(r.edges, []);
  assert.equal(r.height, 0);
});

test('one child: orchestrator top centre, child centred below, 40px between levels', () => {
  const r = layoutGraph([root(), ...kids(1)], { width: 1000 });
  const m = byId(r);
  assert.equal(m.get('r').y, 0);
  assert.equal(m.get('r').x, (1000 - CARD_W) / 2);
  assert.equal(m.get('c0').x, (1000 - CARD_W) / 2);
  assert.equal(m.get('c0').y, m.get('r').h + GAP_Y);
  assert.equal(r.edges.length, 1);
  assertNoOverlap(r);
});

test('four children fit one row at 1440 minus nothing, centred, 18px apart', () => {
  const r = layoutGraph([root(), ...kids(4)], { width: 4 * CARD_W + 3 * GAP_X });
  const cs = ['c0', 'c1', 'c2', 'c3'].map((id) => byId(r).get(id));
  assert.equal(new Set(cs.map((c) => c.y)).size, 1);
  for (let i = 1; i < 4; i++) assert.equal(cs[i].x - (cs[i - 1].x + cs[i - 1].w), GAP_X);
  assert.equal(cs[0].x, 0);
});

test('1440 viewport: 4 children share a row (spec 3.1)', () => {
  const r = layoutGraph([root(), ...kids(4)], { width: 1440 - 320 - 48 });
  assert.equal(new Set(['c0', 'c1', 'c2', 'c3'].map((id) => byId(r).get(id).y)).size, 1);
});

test('twelve children wrap to more rows, no overlap, all inside, dense', () => {
  const r = layoutGraph([root(), ...kids(12)], { width: 1000 });
  assert.equal(r.dense, true);
  assert.equal(r.cardWidth, CARD_W_DENSE);
  const ys = new Set(kids(12).map((k) => byId(r).get(k.id).y));
  assert.ok(ys.size >= 3);
  assertNoOverlap(r);
  assertInside(r, 1000);
  assertEdgesClear(r);
});

test('wrapped row spacing is 40px and elbow sits in the gap above the child row', () => {
  const r = layoutGraph([root(), ...kids(6)], { width: 800 });
  const m = byId(r);
  const rows = [...new Set(kids(6).map((k) => m.get(k.id).y))].sort((a, b) => a - b);
  assert.ok(rows.length >= 2);
  const firstRowBottom = Math.max(...kids(6).filter((k) => m.get(k.id).y === rows[0]).map((k) => m.get(k.id).y + m.get(k.id).h));
  assert.equal(rows[1] - firstRowBottom, GAP_Y);
  for (const e of r.edges) {
    const child = m.get(e.to);
    const horiz = e.segments.filter((s) => s.y1 === s.y2 && s.x1 !== s.x2);
    for (const h of horiz) assert.equal(h.y1, child.y - GAP_Y / 2);
  }
  assertEdgesClear(r);
});

test('exactly 8 visible cards stay normal, 9 become dense (216px, no task, 3 calls)', () => {
  const eight = layoutGraph([root(), ...kids(7)], { width: 1200 });
  assert.equal(eight.dense, false);
  assert.equal(eight.cards[0].w, CARD_W);
  assert.equal(eight.cards[0].showTask, true);
  assert.equal(eight.cards[0].shownCalls, 5);
  const nine = layoutGraph([root(), ...kids(8)], { width: 1200 });
  assert.equal(nine.dense, true);
  assert.ok(nine.cards.every((c) => c.w === CARD_W_DENSE && c.showTask === false && c.shownCalls <= 3));
  assert.ok(nine.cards[0].h < eight.cards[0].h);
});

test('hidden agents are not counted and drop out with their subtree', () => {
  const spans = [root(), ...kids(9)];
  const r = layoutGraph(spans, { width: 1200, hidden: new Set(['c0', 'c1', 'c2']) });
  assert.equal(r.dense, false);
  assert.equal(r.cards.length, 7);
  assert.ok(!r.cards.some((c) => c.id === 'c0'));
  assert.ok(!r.edges.some((e) => e.to === 'c0'));
});

test('grandchild is a normal card on the next level, edge joins its own parent', () => {
  const spans = [root(), ...kids(2), { id: 'g', parentId: 'c1', kind: 'agent', start: 9, callCount: 2, task: 't' }];
  const r = layoutGraph(spans, { width: 1000 });
  const m = byId(r);
  assert.equal(m.get('g').w, CARD_W);
  assert.ok(m.get('g').y > m.get('c1').y + m.get('c1').h);
  assert.equal(m.get('g').depth, 2);
  const e = r.edges.find((x) => x.to === 'g');
  assert.equal(e.from, 'c1');
  assert.equal(e.dashed, false);
  assertEdgesClear(r);
});

test('watcher sits beside the orchestrator with a dashed straight line', () => {
  const spans = [root(), { id: 'w', parentId: 'r', kind: 'agent', role: 'watcher', start: 0.5, callCount: 3, task: 't' }, ...kids(2)];
  const r = layoutGraph(spans, { width: 1000 });
  const m = byId(r);
  assert.equal(m.get('w').y, m.get('r').y);
  assert.equal(m.get('w').w, WATCH_W);
  assert.ok(m.get('w').x > m.get('r').x + m.get('r').w);
  assert.equal(m.get('r').x, (1000 - CARD_W) / 2);
  const e = r.edges.find((x) => x.to === 'w');
  assert.equal(e.dashed, true);
  assert.equal(e.kind, 'watch');
  assert.equal(e.segments.length, 1);
  assert.equal(e.segments[0].y1, e.segments[0].y2);
  assert.ok(r.cards.filter((c) => c.depth === 1).length === 2);
  assertNoOverlap(r);
  assertEdgesClear(r);
});

test('folded card is shorter and keeps its place in the flow', () => {
  const plain = layoutGraph([root(), ...kids(2)], { width: 1000 });
  const folded = layoutGraph([root(), ...kids(2)], { width: 1000, folded: new Set(['r']) });
  assert.ok(byId(folded).get('r').h < byId(plain).get('r').h);
  assert.equal(byId(folded).get('r').folded, true);
  assert.equal(byId(folded).get('c0').y, byId(folded).get('r').h + GAP_Y);
});

test('card height follows task and call count', () => {
  const many = layoutGraph([root({ callCount: 40 })], { width: 800 }).cards[0];
  const few = layoutGraph([root({ callCount: 2 })], { width: 800 }).cards[0];
  const noTask = layoutGraph([root({ callCount: 2, task: undefined })], { width: 800 }).cards[0];
  assert.equal(many.shownCalls, 5);
  assert.equal(many.moreCalls, 35);
  assert.equal(few.moreCalls, 0);
  assert.ok(many.h > few.h);
  assert.ok(few.h > noTask.h);
});

test('within a row: parent order first, then start order', () => {
  const spans = [
    root(),
    { id: 'a', parentId: 'r', kind: 'agent', start: 5 },
    { id: 'b', parentId: 'r', kind: 'agent', start: 2 },
    { id: 'a1', parentId: 'a', kind: 'agent', start: 9 },
    { id: 'b1', parentId: 'b', kind: 'agent', start: 8 },
    { id: 'b2', parentId: 'b', kind: 'agent', start: 7 },
  ];
  const r = layoutGraph(spans, { width: 1200 });
  const m = byId(r);
  assert.ok(m.get('b').x < m.get('a').x);
  assert.ok(m.get('b2').x < m.get('b1').x && m.get('b1').x < m.get('a1').x);
});

test('narrow width: vertical list, depth first, parent -> watcher -> children, indent 18 per depth, no edges', () => {
  const spans = [
    root(),
    ...kids(2),
    { id: 'w', parentId: 'r', kind: 'agent', role: 'watcher', start: 0.5 },
    { id: 'g', parentId: 'c0', kind: 'agent', start: 9 },
  ];
  const r = layoutGraph(spans, { width: NARROW_MAX });
  assert.equal(r.mode, 'list');
  assert.deepEqual(r.edges, []);
  assert.deepEqual(r.cards.map((c) => c.id), ['r', 'w', 'c0', 'g', 'c1']);
  const m = byId(r);
  assert.equal(m.get('r').x, 0);
  assert.equal(m.get('c0').x, 18);
  assert.equal(m.get('g').x, 36);
  assert.equal(m.get('c0').w, NARROW_MAX - 18);
  for (let i = 1; i < r.cards.length; i++) assert.ok(r.cards[i].y > r.cards[i - 1].y + r.cards[i - 1].h - 1e-9);
  assertNoOverlap(r);
});

test('390 wide is a list; 761 wide is a graph', () => {
  assert.equal(layoutGraph([root(), ...kids(2)], { width: 390 }).mode, 'list');
  assert.equal(layoutGraph([root(), ...kids(2)], { width: NARROW_MAX + 1 }).mode, 'graph');
});

test('edge path: starts at parent bottom centre, ends at child top centre, rounded elbow', () => {
  const r = layoutGraph([root(), ...kids(3)], { width: 1000 });
  const m = byId(r);
  for (const e of r.edges) {
    const p = m.get(e.from);
    const c = m.get(e.to);
    assert.deepEqual(e.start, { x: p.x + p.w / 2, y: p.y + p.h });
    assert.deepEqual(e.end, { x: c.x + c.w / 2, y: c.y });
    assert.match(e.d, /^M/);
    if (Math.abs(e.start.x - e.end.x) > 1) assert.match(e.d, /Q/);
    else assert.doesNotMatch(e.d, /Q/);
  }
});

test('multiple roots share the first row; unknown parent counts as root', () => {
  const r = layoutGraph([root(), { id: 'x', parentId: 'gone', kind: 'agent', start: 3 }], { width: 1000 });
  const m = byId(r);
  assert.equal(m.get('r').y, m.get('x').y);
  assert.equal(r.edges.length, 0);
});

test('non-agent spans are ignored and input is not mutated', () => {
  const spans = [root(), { id: 'l', parentId: 'r', kind: 'llm', start: 1 }, ...kids(1)];
  const copy = JSON.parse(JSON.stringify(spans));
  const r = layoutGraph(spans, { width: 1000 });
  assert.equal(r.cards.length, 2);
  assert.deepEqual(spans, copy);
});

test('layout is deterministic', () => {
  const spans = [root(), ...kids(12)];
  assert.deepEqual(layoutGraph(spans, { width: 900 }), layoutGraph(spans, { width: 900 }));
});

test('snapshots: fixed sizes for 1, 4, 12 children', () => {
  const sizes = [1, 4, 12].map((n) => {
    const r = layoutGraph([root(), ...kids(n)], { width: 1072 });
    return [n, r.cards.length, r.height];
  });
  assert.deepEqual(sizes, [
    [1, 2, 518],
    [4, 5, 518],
    [12, 13, 800],
  ]);
});

test('panelBeside: the detail column stacks under the graph in a narrow run column', async () => {
  const { panelBeside } = await import('../web/graph-layout.js');
  assert.equal(panelBeside(580 - 48), false);
  assert.equal(panelBeside(979 - 48), false);
  assert.equal(panelBeside(980 - 48), true);
  assert.equal(panelBeside(1072), true);
});

test('narrow width: finished one-line siblings share rows (a grid); cards with calls keep the full width', () => {
  const folded = new Set(['c0', 'c1', 'c2', 'c3', 'c4']);
  const r = layoutGraph([root(), ...kids(6)], { width: 400, folded });
  const m = byId(r);
  const k = ['c0', 'c1', 'c2', 'c3', 'c4'].map((id) => m.get(id));
  const x = INDENT;
  const w = (400 - x - LIST_GAP) / 2;
  assert.equal(m.get('c5').w, 400 - x); // not folded: full width, before the grid
  assert.ok(m.get('c5').y < k[0].y);
  assert.deepEqual(k.map((c) => c.x), [x, x + w + LIST_GAP, x, x + w + LIST_GAP, x]);
  assert.ok(k.every((c) => Math.abs(c.w - w) < 1e-9));
  assert.equal(k[0].y, k[1].y); // same row
  assert.ok(k[2].y > k[0].y && k[4].y > k[2].y);
  assert.ok(k[1].noBranch && !k[0].noBranch);
  assertNoOverlap(r);
  const one = byId(layoutGraph([root(), ...kids(3)], { width: 300, folded }));
  assert.ok(['c0', 'c1', 'c2'].every((id) => one.get(id).x === INDENT && one.get(id).w === 300 - INDENT));
  assert.ok(GRID_MIN * 2 + LIST_GAP > 300 - INDENT);
});
test('narrow width: running siblings come before finished ones, start order kept within each group', () => {
  const spans = [root(), ...kids(4)];
  spans[1].status = 'ok';
  spans[2].status = 'running';
  spans[3].status = 'ok';
  spans[4].status = 'running';
  const r = layoutGraph(spans, { width: 400 });
  assert.deepEqual(r.cards.map((c) => c.id), ['r', 'c1', 'c3', 'c0', 'c2']);
  const wide = layoutGraph(spans, { width: 1200 }); // the wide graph keeps its order
  const m = byId(wide);
  assert.ok(m.get('c0').x < m.get('c1').x);
});
