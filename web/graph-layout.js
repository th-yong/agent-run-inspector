// Pure layout for the graph tab (spec 3.1). No DOM: agent spans + container width in,
// card boxes and edge paths out. Callers draw; this only measures and places.

export const CARD_W = 248;
export const CARD_W_DENSE = 216;
export const WATCH_W = 224;
export const GAP_X = 18; // between cards in a row
export const GAP_Y = 40; // between rows and levels
export const WATCH_GAP = 56; // orchestrator -> watcher
export const DENSE_OVER = 8; // more visible cards than this -> dense
export const DETAIL_W = 360;
export const NARROW_MAX = 760;
// The detail column sits beside the cards only when the run column is at least this wide (it leaves 620px for cards);
// below that it stacks under the graph. Keep in step with the @container query in app.css.
export const PANEL_BESIDE_MIN = 980;
export const SCROLL_PAD = 48; // .g-scroll side padding, both sides
/** True when the detail column fits beside a canvas of this width. */
export const panelBeside = (canvasWidth) => canvasWidth + SCROLL_PAD >= PANEL_BESIDE_MIN;
export const INDENT = 18; // list mode, per depth
export const LIST_GAP = 8;
export const GRID_MIN = 150; // list mode: finished (one-line) sibling cards share a row when two fit this wide
export const RECENT_CALLS = 5;
export const RECENT_CALLS_DENSE = 3;

// Card height parts (px), kept in step with the card CSS.
const H_FRAME = 22; // padding 10 + 10, border 1 + 1
const H_HEAD = 24;
const H_TASK = 30;
const H_CALLS_TOP = 7;
const H_CALL_ROW = 24;
const H_MORE = 18;
const H_FOOT = 27;
export const H_FOLDED = 64;

const ELBOW_R = 9;

const isWatcher = (n) => n.role === 'watcher';

function cardMetrics(n, dense, folded) {
  const w = isWatcher(n) ? (dense ? CARD_W_DENSE : WATCH_W) : dense ? CARD_W_DENSE : CARD_W;
  if (folded) return { w, h: H_FOLDED, showTask: false, shownCalls: 0, moreCalls: 0 };
  const limit = dense ? RECENT_CALLS_DENSE : RECENT_CALLS;
  const total = Math.max(0, n.callCount ?? 0);
  const shownCalls = Math.min(total, limit);
  const moreCalls = total - shownCalls;
  const showTask = !dense && n.task != null && n.task !== '';
  const h =
    H_FRAME + H_HEAD + (showTask ? H_TASK : 0) + H_CALLS_TOP + shownCalls * H_CALL_ROW + (moreCalls > 0 ? H_MORE : 0) + H_FOOT;
  return { w, h, showTask, shownCalls, moreCalls };
}

function byStart(a, b) {
  return a.start - b.start || a.order - b.order;
}

// Build the agent tree. Hidden agents drop out together with their subtree.
function buildTree(spans, hidden) {
  const agents = spans.filter((s) => s.kind === 'agent');
  const nodes = new Map();
  agents.forEach((s, order) => nodes.set(s.id, { ...s, order, kids: [], watchers: [], depth: 0 }));
  const roots = [];
  for (const n of nodes.values()) {
    const p = n.parentId != null && n.parentId !== n.id ? nodes.get(n.parentId) : null;
    if (!p) roots.push(n);
    else if (isWatcher(n)) p.watchers.push(n);
    else p.kids.push(n);
  }
  const seen = new Set();
  const visible = [];
  const walk = (n, depth) => {
    if (seen.has(n.id) || hidden.has(n.id)) return;
    seen.add(n.id);
    n.depth = depth;
    visible.push(n);
    n.kids = n.kids.filter((k) => !hidden.has(k.id)).sort(byStart);
    n.watchers = n.watchers.filter((k) => !hidden.has(k.id)).sort(byStart);
    for (const k of n.kids) walk(k, depth + 1);
    for (const k of n.watchers) walk(k, depth); // a watcher shares its parent's level
  };
  roots.sort(byStart);
  for (const r of roots) walk(r, 0);
  return { roots, visible };
}

function elbow(x1, y1, x2, y2) {
  const my = y2 - GAP_Y / 2;
  if (Math.abs(x2 - x1) < 1) {
    return { d: `M${x1},${y1} V${y2}`, segments: [{ x1, y1, x2: x1, y2 }] };
  }
  const r = Math.min(ELBOW_R, Math.abs(x2 - x1) / 2, (y2 - y1) / 4);
  const s = x2 > x1 ? 1 : -1;
  return {
    d: `M${x1},${y1} V${my - r} Q${x1},${my} ${x1 + s * r},${my} H${x2 - s * r} Q${x2},${my} ${x2},${my + r} V${y2}`,
    // Straight pieces only (the rounded corners stay inside the gap row).
    segments: [
      { x1, y1, x2: x1, y2: my },
      { x1: x1 + s * r, y1: my, x2: x2 - s * r, y2: my },
      { x1: x2, y1: my, x2, y2 },
    ],
  };
}

function normalizeOpts(opts) {
  const o = opts ?? {};
  return {
    width: Math.max(0, Math.floor(o.width ?? 0)),
    detailOpen: !!o.detailOpen,
    hidden: o.hidden instanceof Set ? o.hidden : new Set(o.hidden ?? []),
    folded: o.folded instanceof Set ? o.folded : new Set(o.folded ?? []),
  };
}

/**
 * layoutGraph(spans, { width, detailOpen, hidden, folded })
 *  spans: RunSpan[] (only kind 'agent' is used; fields id, parentId, role, start, task, callCount)
 *  width: container width in px. <= 760 gives a vertical list (childless siblings in a grid); otherwise the graph.
 *  detailOpen: the 360px detail panel is open (graph mode: layout width - 360).
 *  hidden: Set of agent ids to leave out (their subtree goes too).
 *  folded: Set of agent ids drawn as the one-line folded card.
 */
export function layoutGraph(spans, opts) {
  const o = normalizeOpts(opts);
  const list = o.width <= NARROW_MAX;
  const width = list ? o.width : o.width - (o.detailOpen ? DETAIL_W : 0);
  const { roots, visible } = buildTree(spans, o.hidden);
  const dense = visible.length > DENSE_OVER;
  const base = { mode: list ? 'list' : 'graph', width, dense, cardWidth: dense ? CARD_W_DENSE : CARD_W };

  const metrics = new Map(visible.map((n) => [n.id, cardMetrics(n, dense, o.folded.has(n.id))]));
  const mk = (n, x, y, w) => {
    const m = metrics.get(n.id);
    return {
      id: n.id,
      parentId: n.parentId ?? null,
      depth: n.depth,
      role: n.role ?? null,
      x,
      y,
      w: w ?? m.w,
      h: m.h,
      folded: o.folded.has(n.id),
      showTask: m.showTask,
      shownCalls: m.shownCalls,
      moreCalls: m.moreCalls,
    };
  };

  if (visible.length === 0) return { ...base, cards: [], edges: [], height: 0 };

  if (list) return { ...base, ...layoutList(roots, mk, metrics, width) };
  return { ...base, ...layoutLevels(roots, mk, metrics, width) };
}

function layoutList(roots, mk, metrics, width) {
  const cards = [];
  let y = 0;
  const xAt = (depth) => Math.min(depth * INDENT, Math.max(0, width - 1));
  const walk = (n, depth) => {
    const x = xAt(depth);
    const c = mk(n, x, y, Math.max(1, width - x));
    c.indent = depth;
    cards.push(c);
    y += c.h + LIST_GAP;
    let leaves = []; // consecutive siblings without children: laid out as a grid
    const flush = () => {
      if (leaves.length) grid(leaves, depth + 1);
      leaves = [];
    };
    // running agents first (stable: start order within each group), so what is working is on top
    const kids = [...n.watchers, ...n.kids].sort((a, b) => (b.status === 'running') - (a.status === 'running'));
    for (const k of kids) {
      if (k.watchers.length || k.kids.length) { flush(); walk(k, depth + 1); } else leaves.push(k);
    }
    flush();
  };
  // Many agents would make one long column; finished siblings with no children (one-line cards) fill
  // rows instead. Cards that show calls keep the full width.
  const grid = (nodes, depth) => {
    const full = nodes.filter((k) => !mk(k, 0, 0).folded);
    if (full.length) { for (const k of full) grid1(k, depth); nodes = nodes.filter((k) => !full.includes(k)); }
    if (!nodes.length) return;
    const x = xAt(depth);
    const avail = Math.max(1, width - x);
    const cols = Math.max(1, Math.min(nodes.length, Math.floor((avail + LIST_GAP) / (GRID_MIN + LIST_GAP))));
    const w = cols === 1 ? avail : (avail - (cols - 1) * LIST_GAP) / cols;
    for (let i = 0; i < nodes.length; i += cols) {
      let rowH = 0;
      nodes.slice(i, i + cols).forEach((k, j) => {
        const c = mk(k, x + j * (w + LIST_GAP), y, w);
        c.indent = depth;
        if (j > 0) c.noBranch = true; // the └ mark belongs to the first card of a row
        cards.push(c);
        rowH = Math.max(rowH, c.h);
      });
      y += rowH + LIST_GAP;
    }
  };
  const grid1 = (k, depth) => {
    const x = xAt(depth);
    const c = mk(k, x, y, Math.max(1, width - x));
    c.indent = depth;
    cards.push(c);
    y += c.h + LIST_GAP;
  };
  for (const r of roots) if (metrics.has(r.id)) walk(r, 0);
  return { cards, edges: [], height: Math.max(0, y - LIST_GAP) };
}

// Greedy wrap of items (with .w) into rows no wider than width.
function wrapRows(items, width) {
  const rows = [];
  let row = null;
  let rowW = 0;
  for (const it of items) {
    if (row && rowW + GAP_X + it.w <= width) {
      row.push(it);
      rowW += GAP_X + it.w;
    } else {
      row = [it];
      rows.push(row);
      rowW = it.w;
    }
  }
  return rows;
}

function layoutLevels(roots, mk, metrics, width) {
  const cards = new Map();
  const edges = [];
  const placed = [];

  // Level order: parents in row order, each followed by the children of its watchers.
  let level = roots.filter((n) => metrics.has(n.id));
  let y = 0;
  while (level.length) {
    const fallback = []; // watchers that do not fit beside their parent
    const rows = wrapRows(
      level.map((n) => ({ n, w: metrics.get(n.id).w })),
      width,
    );
    // x pass
    const laid = rows.map((row) => {
      const rowW = row.reduce((s, it) => s + it.w, 0) + GAP_X * (row.length - 1);
      let x0 = Math.max(0, (width - rowW) / 2);
      // Watchers sit right of their parent; shift the row left if they would overflow.
      let overflow = 0;
      let cx = x0;
      for (const it of row) {
        let right = cx + it.w;
        for (const w of it.n.watchers) right += (right === cx + it.w ? WATCH_GAP : GAP_X) + metrics.get(w.id).w;
        if (it.n.watchers.length) overflow = Math.max(overflow, right - width);
        cx += it.w + GAP_X;
      }
      // Only the last item's watchers can push past the edge without hitting a neighbour; keep it simple and
      // require the whole row to fit when shifted.
      if (overflow > 0 && x0 - overflow >= 0 && row.every((it, i) => i === row.length - 1 || !it.n.watchers.length)) x0 -= overflow;
      let x = x0;
      return row.map((it) => {
        const item = { n: it.n, x, w: it.w, watchers: [] };
        let right = x + it.w;
        for (const w of it.n.watchers) {
          const ww = metrics.get(w.id).w;
          const wx = right + (item.watchers.length ? GAP_X : WATCH_GAP);
          const next = row[row.indexOf(it) + 1];
          if (wx + ww <= width && !next) {
            item.watchers.push({ n: w, x: wx, w: ww });
            right = wx + ww;
          } else fallback.push({ n: w, parent: it.n, w: ww });
        }
        x += it.w + GAP_X;
        return item;
      });
    });
    // Watchers that did not fit: their own rows after this level's rows.
    const fbRows = wrapRows(fallback, width).map((row) => {
      const rowW = row.reduce((s, it) => s + it.w, 0) + GAP_X * (row.length - 1);
      let x = Math.max(0, (width - rowW) / 2);
      return row.map((it) => {
        const item = { n: it.n, x, w: it.w, watchers: [], fallbackOf: it.parent };
        x += it.w + GAP_X;
        return item;
      });
    });

    const nextLevel = [];
    for (const row of [...laid, ...fbRows]) {
      const rowTop = y;
      let rowH = 0;
      for (const item of row) {
        const c = mk(item.n, item.x, rowTop, item.w);
        cards.set(item.n.id, c);
        placed.push(c);
        rowH = Math.max(rowH, c.h);
        for (const w of item.watchers) {
          const wc = mk(w.n, w.x, rowTop, w.w);
          cards.set(w.n.id, wc);
          placed.push(wc);
          rowH = Math.max(rowH, wc.h);
        }
        item.rowTop = rowTop;
      }
      y += rowH + GAP_Y;
      for (const item of row) {
        if (!item.fallbackOf) {
          nextLevel.push(...item.n.kids);
          for (const w of item.watchers) nextLevel.push(...w.n.kids);
        } else nextLevel.push(...item.n.kids);
      }
    }
    // Watchers that fell back keep their own children order after their parent's; good enough (rare).
    level = nextLevel.filter((n) => metrics.has(n.id));
  }

  // Edges once every box is known.
  for (const c of placed) {
    if (c.parentId == null || !cards.has(c.parentId)) continue;
    const p = cards.get(c.parentId);
    if (c.role === 'watcher') {
      if (c.y === p.y && c.x >= p.x + p.w) {
        const ey = p.y + 22;
        edges.push({
          from: p.id,
          to: c.id,
          kind: 'watch',
          dashed: true,
          start: { x: p.x + p.w, y: ey },
          end: { x: c.x, y: ey },
          d: `M${p.x + p.w},${ey} H${c.x}`,
          segments: [{ x1: p.x + p.w, y1: ey, x2: c.x, y2: ey }],
        });
        continue;
      }
      const start = { x: p.x + p.w / 2, y: p.y + p.h };
      const end = { x: c.x + c.w / 2, y: c.y };
      edges.push({ from: p.id, to: c.id, kind: 'watch', dashed: true, start, end, ...elbow(start.x, start.y, end.x, end.y) });
      continue;
    }
    const start = { x: p.x + p.w / 2, y: p.y + p.h };
    const end = { x: c.x + c.w / 2, y: c.y };
    edges.push({ from: p.id, to: c.id, kind: 'flow', dashed: false, start, end, ...elbow(start.x, start.y, end.x, end.y) });
  }

  const height = placed.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  return { cards: placed, edges, height };
}
