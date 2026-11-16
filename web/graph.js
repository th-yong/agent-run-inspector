// Graph tab: agent cards placed by layoutGraph() (web/graph-layout.js) and the edges between them.
// It redraws from the latest spans but touches only what changed (cards, call rows and edges are keyed),
// so motion (new card + edge growth, rows sliding in and folding away, finished cards folding) plays once per change.
// Pure helpers (prepareGraph, hiddenAgents, foldedAgents) are exported for tests; the DOM part runs only in createGraph().
import { S } from './strings.js';
import { layoutGraph, panelBeside } from './graph-layout.js';
import { cardInfo, callRows, createCard, updateCard } from './card.js';

export const FOLD_DELAY_MS = 1600; // a finished agent shows its Done / Failed badge this long before it folds
const FINISHED = new Set(['ok', 'error', 'cancelled']);
const isFinished = (a) => FINISHED.has(a.status) && !a.external;

/** Agent spans (with callCount = their own llm + tool calls) and each agent's calls in start order. */
export function prepareGraph(spans) {
  const calls = new Map();
  for (const s of spans ?? []) {
    if ((s.kind === 'llm' || s.kind === 'tool') && s.parentId != null) {
      if (!calls.has(s.parentId)) calls.set(s.parentId, []);
      calls.get(s.parentId).push(s);
    }
  }
  for (const list of calls.values()) list.sort((a, b) => a.start - b.start);
  const agents = (spans ?? []).filter((s) => s.kind === 'agent').map((s) => ({ ...s, callCount: calls.get(s.id)?.length ?? 0 }));
  return { agents, calls };
}

/**
 * "Hide finished agents": finished agents leave the graph with their subtree, unless something below is still running.
 * The root and the selected agent stay, and so do agents in `held` (finished a moment ago, still showing their badge).
 */
export function hiddenAgents(agents, hide, selectedId = null, held = new Set()) {
  const out = new Set();
  if (!hide) return out;
  const kids = new Map();
  for (const a of agents) {
    if (a.parentId != null) {
      if (!kids.has(a.parentId)) kids.set(a.parentId, []);
      kids.get(a.parentId).push(a);
    }
  }
  const byId = new Map(agents.map((a) => [a.id, a]));
  const alive = new Map(); // id -> itself or a descendant is running or selected
  const live = (a, seen = new Set()) => {
    if (alive.has(a.id)) return alive.get(a.id);
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    const v = a.status === 'running' || held.has(a.id) || a.id === selectedId || (kids.get(a.id) ?? []).some((k) => live(k, seen));
    alive.set(a.id, v);
    return v;
  };
  for (const a of agents) {
    const root = a.parentId == null || !byId.has(a.parentId);
    if (!root && isFinished(a) && !live(a)) out.add(a.id);
  }
  return out;
}

/** Finished agents (not the root, not the selected one, not one in `held`) are drawn as one folded line. */
export function foldedAgents(agents, hidden, selectedId = null, held = new Set()) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out = new Set();
  for (const a of agents) {
    const root = a.parentId == null || !byId.has(a.parentId);
    if (!root && !hidden.has(a.id) && isFinished(a) && a.id !== selectedId && !held.has(a.id)) out.add(a.id);
  }
  return out;
}

// ---------------- DOM ----------------
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const COMPACT_W = 232; // narrower cards cannot fit "Model response" beside the bar and time
const reduceMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * createGraph({ onSelect(id | null) }) -> { el, update(props), destroy() }
 * props: { spans, selectedId, hide, detailOpen }
 */
export function createGraph({ onSelect }) {
  const root = el('div', 'g-view');
  const scroll = el('div', 'g-scroll');
  const canvas = el('div', 'g-canvas');
  const edges = svgEl('svg', { class: 'g-edges', 'aria-hidden': 'true' });
  const empty = el('div', 'placeholder', S.graph.empty);
  empty.hidden = true;
  const hint = el('button', 'g-hint');
  hint.type = 'button';
  hint.hidden = true;
  canvas.append(edges);
  scroll.append(canvas, empty);
  root.append(scroll, hint);

  const cards = new Map(); // id -> card parts
  const branches = new Map(); // id -> the └ mark in front of an indented card (list mode only)
  const edgeEls = new Map(); // edge key -> { path, a, b }
  const ranRunning = new Set(); // agents seen running here, so only a live finish is held before folding
  const finishedAt = new Map();
  let foldTimer = 0;
  let painted = false; // the first paint is not animated
  let props = null;
  let layout = null;
  let lastWidth = 0;

  canvas.addEventListener('click', (e) => {
    const card = e.target.closest('.g-card');
    if (card) onSelect?.(card.dataset.id);
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.g-card');
    if (!card) return;
    e.preventDefault();
    onSelect?.(card.dataset.id);
  });

  const scroller = () => root.closest('.main');
  hint.addEventListener('click', () => {
    const sc = scroller();
    if (sc) sc.scrollBy({ top: Math.round(sc.clientHeight * 0.8), behavior: reduceMotion() ? 'auto' : 'smooth' });
  });

  function updateHint() {
    const sc = scroller();
    if (!sc || !layout) { hint.hidden = true; return; }
    const bottom = sc.getBoundingClientRect().bottom;
    const top = canvas.getBoundingClientRect().top;
    let below = 0;
    let running = 0;
    for (const c of layout.cards) {
      if (top + c.y > bottom - 60) {
        below++;
        if (cards.get(c.id)?.root.dataset.status === 'running') running++;
      }
    }
    hint.hidden = below === 0;
    if (below) hint.textContent = S.graph.below(below, running);
  }

  /** Keyed edges: paths move with their cards; only a new edge draws itself in. */
  function drawEdges(animate) {
    edges.setAttribute('width', String(lastWidth));
    edges.setAttribute('height', String(layout.height));
    const status = new Map([...cards].map(([id, c]) => [id, c.root.dataset.status]));
    const live = new Set();
    for (const e of layout.edges) {
      const key = `${e.kind}:${e.to}`;
      live.add(key);
      let ed = edgeEls.get(key);
      if (!ed) {
        ed = { path: svgEl('path', { pathLength: '1' }), a: null, b: null };
        if (animate) ed.path.classList.add('grow');
        edgeEls.set(key, ed);
        edges.append(ed.path);
        if (e.kind !== 'watch') {
          ed.a = svgEl('circle', { r: 3 });
          ed.b = svgEl('circle', { r: 3 });
          if (animate) ed.b.classList.add('late');
          edges.append(ed.a, ed.b);
        }
      }
      ed.path.setAttribute('d', e.d);
      if (e.kind === 'watch') { ed.path.setAttribute('class', 'e watch'); continue; }
      const st = status.get(e.to);
      const cls = st === 'running' ? 'run' : st === 'failed' ? 'fail' : 'done';
      const grow = ed.path.classList.contains('grow') ? ' grow' : '';
      ed.path.setAttribute('class', `e ${cls}${grow}`);
      for (const [dot, p] of [[ed.a, e.start], [ed.b, e.end]]) {
        dot.setAttribute('class', `dotc ${cls}${dot.classList.contains('late') ? ' late' : ''}`);
        dot.setAttribute('cx', String(p.x));
        dot.setAttribute('cy', String(p.y));
      }
    }
    for (const [key, ed] of edgeEls) {
      if (live.has(key)) continue;
      ed.path.remove(); ed.a?.remove(); ed.b?.remove();
      edgeEls.delete(key);
    }
  }

  function render() {
    if (!props || lastWidth <= 0) return;
    const { agents, calls } = prepareGraph(props.spans);
    const selected = props.selectedId && agents.some((a) => a.id === props.selectedId) ? props.selectedId : null;
    const now = Date.now();
    const animate = !reduceMotion();
    // An agent that finishes while we watch keeps its full card for FOLD_DELAY_MS, so the new badge can be read.
    const held = new Set();
    let wake = 0;
    for (const a of agents) {
      if (a.status === 'running') { ranRunning.add(a.id); finishedAt.delete(a.id); continue; }
      if (!animate || !ranRunning.has(a.id)) continue;
      if (!finishedAt.has(a.id)) finishedAt.set(a.id, now);
      const left = finishedAt.get(a.id) + FOLD_DELAY_MS - now;
      if (left > 0) { held.add(a.id); wake = Math.max(wake, left); }
    }
    clearTimeout(foldTimer);
    if (wake > 0) foldTimer = setTimeout(render, wake + 20);
    const hidden = hiddenAgents(agents, props.hide, selected, held);
    const folded = foldedAgents(agents, hidden, selected, held);
    layout = layoutGraph(agents, { width: lastWidth, detailOpen: props.detailOpen && panelBeside(lastWidth), hidden, folded });
    root.dataset.mode = layout.mode;
    canvas.classList.toggle('dense', layout.dense);
    canvas.style.height = `${layout.height}px`;
    empty.hidden = layout.cards.length > 0;

    const byId = new Map(agents.map((a) => [a.id, a]));
    const motion = animate && painted;
    const seen = new Set();
    for (const box of layout.cards) {
      seen.add(box.id);
      const agent = byId.get(box.id);
      const own = calls.get(box.id) ?? [];
      let c = cards.get(box.id);
      if (!c) {
        c = createCard();
        if (motion) c.root.classList.add('in');
        c.root.dataset.id = box.id;
        cards.set(box.id, c);
        canvas.append(c.root);
      }
      updateCard(c, {
        info: cardInfo(agent, own, now),
        rows: callRows(own, box.shownCalls, box.w < COMPACT_W),
        moreCalls: box.moreCalls,
        showTask: box.showTask,
        folded: box.folded,
        selected: box.id === selected,
        box,
        animate: motion,
      });
    }
    for (const [id, c] of cards) {
      if (!seen.has(id)) { c.root.remove(); cards.delete(id); }
    }
    drawEdges(motion);
    const wantBranch = new Set();
    for (const box of layout.cards) {
      if (layout.mode !== 'list' || !(box.indent > 0) || box.noBranch) continue;
      wantBranch.add(box.id);
      let b = branches.get(box.id);
      if (!b) { b = el('span', 'g-branch'); b.setAttribute('aria-hidden', 'true'); branches.set(box.id, b); canvas.append(b); }
      b.style.left = `${box.x - 12}px`;
      b.style.top = `${box.y - 8}px`;
    }
    for (const [id, b] of branches) if (!wantBranch.has(id)) { b.remove(); branches.delete(id); }
    updateHint();
    if (layout.cards.length > 0) painted = true;
  }

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        const w = Math.floor(canvas.clientWidth);
        if (w === lastWidth) return;
        lastWidth = w;
        render();
      })
    : null;
  ro?.observe(canvas);
  const onScroll = () => updateHint();
  let scrollHost = null;

  return {
    el: root,
    update(p) {
      props = p;
      const w = Math.floor(canvas.clientWidth);
      if (w > 0) lastWidth = w;
      if (!scrollHost && scroller()) { scrollHost = scroller(); scrollHost.addEventListener('scroll', onScroll, { passive: true }); }
      render();
    },
    destroy() {
      clearTimeout(foldTimer);
      ro?.disconnect();
      scrollHost?.removeEventListener('scroll', onScroll);
    },
  };
}
