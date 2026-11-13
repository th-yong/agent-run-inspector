// Timeline tab: agent tree on the left, time ruler and call bars on the right, tokens / cost / time columns.
// Pure placement lives in timeline-scale.js; positions are set through the CSSOM (no inline style attributes).
import { S } from './strings.js';
import { fmtDuration, fmtTokens, fmtUsd } from './format.js';
import { providerSlugs, iconEl } from './session-list.js';
import { hasIcon } from './icons.js';
import { openEnd, domainOf, ticksFor, boxOf, timelineRows, callsByAgent, settleAgents } from './timeline-scale.js';
import { createCallDetail } from './call-detail.js';

const known = (n) => typeof n === 'number' && Number.isFinite(n);
const GLYPH = { llm: '◆', tool: '▪', error: '▲' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG = 'http://www.w3.org/2000/svg';
function chevron() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '8'); svg.setAttribute('height', '8'); svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M2 1l4 3-4 3z'); p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

const modelLabel = (m) => (m ?? '').replace(/^claude-/, '');
const modelIcon = (model) => {
  const slug = providerSlugs([model])[0];
  return slug ? iconEl(slug) : null;
};

/** Brand icon for a call row: the model's provider for LLM calls, the tool's brand for tool calls. */
function callIcon(span) {
  if (span.kind === 'llm') return modelIcon(span.model);
  return span.toolBrand && hasIcon(span.toolBrand) ? iconEl(span.toolBrand) : null;
}

function setBox(node, box) {
  node.style.left = `${box.left}%`;
  node.style.width = `${box.width}%`;
}

function barClass(span) {
  if (span.status === 'error') return 'b err';
  if (span.kind === 'llm') return span.end == null ? 'b llm run' : 'b llm';
  return 'b tool';
}

function barTitle(span) {
  const dur = known(span.end) ? fmtDuration(span.end - span.start) : S.timeline.running;
  const name = span.kind === 'llm' ? modelLabel(span.model) || S.timeline.llm : span.name;
  return `${name} · ${dur}`;
}

/** Put a node on the time axis. It is remembered in `ctx.pos` so a moving axis can reposition it without a rebuild. span null = the "now" line. */
function place(ctx, node, span) {
  ctx.pos.push({ node, span });
  setBox(node, span ? boxOf(span, ctx.domain, ctx.now) : boxOf({ start: ctx.now, end: ctx.now }, ctx.domain, ctx.now));
}

function bar(span, ctx) {
  const b = el('div', barClass(span));
  place(ctx, b, span);
  b.title = barTitle(span);
  return b;
}

function reposition(pos, ctx) {
  for (const { node, span } of pos) setBox(node, span ? boxOf(span, ctx.domain, ctx.now) : boxOf({ start: ctx.now, end: ctx.now }, ctx.domain, ctx.now));
}

const tokensOf = (t) => (t && known(t.input) && known(t.output) ? t.input + t.output : null);
const spanMs = (s, now) => (known(s.start) ? (known(s.end) ? s.end - s.start : openEnd(s, now) - s.start) : null);

function cells(row, tk, co, du) {
  const c = (cls, text) => { const d = el('div', `c right num ${cls}`, text); return d; };
  row.append(c('tk', tk), c('co', co), c('du', du));
}

const lane = () => el('div', 'lane');

const fp = (...parts) => parts.join('|');
const sumOf = (calls, pick) => {
  let n = 0; let any = false;
  for (const c of calls) { const v = pick(c); if (known(v)) { n += v; any = true; } }
  return any ? n : null;
};

/** Ruler gridlines, context markers (Claude Code compactions) and turn bands (Codex), drawn once over the lane column. */
function overlay(domain, ticks, markers, turns) {
  const o = el('div', 'overlay');
  o.setAttribute('aria-hidden', 'true');
  const total = domain.t1 - domain.t0;
  const pct = (ms) => Math.min(100, Math.max(0, ((ms - domain.t0) / total) * 100));
  for (const t of ticks) {
    if (t.pct === 0 || t.pct >= 100) continue;
    const g = el('div', 'gridline');
    g.style.left = `${t.pct}%`;
    o.append(g);
  }
  for (const tr of turns ?? []) {
    if (tr.approx || !known(tr.start) || !known(tr.end) || tr.end < domain.t0 || tr.start > domain.t1) continue;
    const left = pct(tr.start);
    const b = el('div', `turn${tr.status === 'error' || tr.status === 'cancelled' ? ' bad' : ''}`);
    b.style.left = `${left}%`;
    b.style.width = `${Math.max(0.2, pct(tr.end) - left)}%`;
    b.title = S.timeline.turnTip(fmtDuration(tr.end - tr.start), tr.status === 'ok' ? '' : S.status[tr.status] ?? '');
    o.append(b);
  }
  for (const m of markers ?? []) {
    if (m.kind !== 'compact' || !known(m.ts) || m.ts < domain.t0 || m.ts > domain.t1) continue;
    const mk = el('div', 'mark');
    mk.style.left = `${pct(m.ts)}%`;
    mk.title = S.timeline.compactTip(m.preTokens != null ? fmtTokens(m.preTokens) : null, m.postTokens != null ? fmtTokens(m.postTokens) : null);
    o.append(mk);
  }
  return o;
}

/**
 * createTimeline({ onSelect(agentId | null) }) -> { el, update(props), destroy() }
 * props: { spans, totals, markers, turns, sel, status, openId, sessionId, now? }. A call row opens its detail right below it (onOpen(id | null)). Open agents / groups are remembered per view.
 * Rows are kept by key: a row whose inputs did not change keeps its DOM node, so a refresh only touches what moved.
 */
export function createTimeline({ onSelect, onOpen, loadDetail } = {}) {
  const root = el('div', 'timeline');
  const expanded = new Set();
  const cache = new Map(); // row key -> { node, sig }
  let seeded = false;
  let last = null;
  let timer = 0;
  let detail = null; // { id, node, cd } the one open call detail, kept across refreshes
  let revealed = null; // the openId whose rows were already made visible
  let parts = null; // { legend, grid, head, headSig, overlay, overlaySig }
  const stats = { built: 0, reused: 0 };

  function toggle(key) {
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
    render();
  }

  function twisty(key, open, can, label) {
    const tw = el('button', 'tw');
    tw.type = 'button';
    tw.setAttribute('aria-expanded', String(open));
    tw.setAttribute('aria-label', label);
    tw.disabled = !can;
    tw.append(chevron());
    tw.addEventListener('click', (e) => { e.stopPropagation(); toggle(key); });
    return tw;
  }

  function agentSig(row, ctx) {
    const a = row.span;
    const own = ctx.calls.get(a.id) ?? [];
    const t = ctx.totals?.byAgent?.[a.id];
    let calls = '';
    for (const c of own) calls += `${c.start},${c.end},${c.status},${c.kind};`;
    return fp(row.depth, ctx.sel === a.id, expanded.has(a.id), ctx.hasSubAgents.has(a.id), own.length > 0,
      a.name, a.agentType, a.model, a.status, a.start, a.end, a.lastActivity, a.end == null ? Math.floor(ctx.now / 1000) : '',
      t?.input, t?.output, t?.usd, t?.durationMs, calls);
  }

  function agentRow(row, ctx) {
    const a = row.span;
    const own = ctx.calls.get(a.id) ?? [];
    const hasKids = own.length > 0 || ctx.hasSubAgents.has(a.id);
    const open = expanded.has(a.id);
    const r = el('div', `r agent${ctx.sel === a.id ? ' sel' : ''}`);
    r.dataset.agent = a.id;
    const nmc = el('div', 'c nmc');
    const nm = el('div', 'nm');
    nm.style.paddingLeft = `${row.depth * 16}px`;
    const pick = el('button', 'label pick');
    pick.type = 'button';
    pick.title = S.timeline.pickTip;
    pick.setAttribute('aria-pressed', String(ctx.sel === a.id));
    pick.append(el('span', 'agent-name', a.name || a.id));
    const type = a.agentType && a.agentType !== 'main' ? a.agentType : '';
    if (type) pick.append(' ', el('span', 'atype', type));
    pick.addEventListener('click', () => onSelect?.(last?.sel === a.id ? null : a.id));
    nm.append(twisty(a.id, open, hasKids, open ? S.timeline.collapse : S.timeline.expand), pick);
    if (a.model) {
      const m = el('span', 'model');
      const ic = modelIcon(a.model);
      if (ic) m.append(ic, ' ');
      m.append(modelLabel(a.model));
      nm.append(m);
    }
    if (a.status === 'running') { const d = el('span', 'dot pulse'); d.title = S.status.running; nm.append(d); }
    else if (a.status === 'error') { const e = el('span', 'k-err', GLYPH.error); e.title = S.status.error; nm.append(e); }
    nmc.append(nm);

    const lc = el('div', 'lanec');
    const ln = lane();
    const bg = el('div', `span-bg${a.end == null ? ' running' : ''}`);
    place(ctx, bg, a);
    ln.append(bg);
    for (const c of own) ln.append(bar(c, ctx));
    if (a.end == null) {
      const n = el('div', 'now');
      place(ctx, n, null);
      ln.append(n);
    }
    lc.append(ln);
    r.append(nmc, lc);
    const t = ctx.totals?.byAgent?.[a.id];
    cells(r, fmtTokens(tokensOf(t)), fmtUsd(t?.usd), fmtDuration(known(t?.durationMs) && a.end != null ? t.durationMs : spanMs(a, ctx.now)));
    return r;
  }

  function groupRow(row, ctx) {
    const s = row.summary;
    const open = expanded.has(row.key);
    const r = el('div', 'r group');
    r.dataset.group = row.span.id;
    const nmc = el('div', 'c nmc');
    const nm = el('div', 'nm');
    nm.style.paddingLeft = `${row.depth * 16}px`;
    const label = el('button', 'label calls-label');
    label.type = 'button';
    label.setAttribute('aria-expanded', String(open));
    label.append(el('span', 'calls-n', S.timeline.calls(s.total)));
    label.addEventListener('click', () => toggle(row.key));
    nm.append(twisty(row.key, open, true, open ? S.timeline.collapseCalls : S.timeline.expandCalls), label,
      el('span', 'small calls-split', S.timeline.callsSplit(s.llm, s.tool)));
    if (s.error) nm.append(el('span', 'small status-err', S.timeline.callsErrors(s.error)));
    nmc.append(nm);
    const lc = el('div', 'lanec');
    lc.append(lane());
    r.append(nmc, lc);
    const llm = row.calls.filter((c) => c.kind === 'llm');
    cells(r, fmtTokens(sumOf(llm, (c) => tokensOf(c.tokens))), fmtUsd(sumOf(llm, (c) => c.cost?.usd)), '');
    return r;
  }

  function runRow(row, ctx) {
    const run = row.run;
    const open = expanded.has(row.key);
    const r = el('div', 'r call run');
    r.dataset.run = run.key;
    const nmc = el('div', 'c nmc');
    const nm = el('div', 'nm');
    nm.style.paddingLeft = `${row.depth * 16}px`;
    nm.append(twisty(row.key, open, true, open ? S.timeline.collapseRun : S.timeline.expandRun), el('span', 'kind k-tool', GLYPH.tool));
    const first = run.spans[0];
    const ic = callIcon(first);
    if (ic) nm.append(ic);
    nm.append(el('span', 'label', run.name), el('span', 'small run-n', S.timeline.times(run.count)));
    nmc.append(nm);
    const lc = el('div', 'lanec');
    const ln = lane();
    const b = el('div', 'b tool fold');
    place(ctx, b, { start: run.start, end: run.end });
    b.title = `${run.name} ${S.timeline.times(run.count)} · ${fmtDuration(run.end - run.start)}`;
    ln.append(b);
    lc.append(ln);
    r.append(nmc, lc);
    cells(r, '—', '—', fmtDuration(run.end - run.start));
    return r;
  }

  function callRow(row, ctx) {
    const c = row.span;
    const err = c.status === 'error';
    const isOpen = ctx.openId === c.id;
    const r = el('div', `r call${err ? ' is-err' : ''}${isOpen ? ' open' : ''}`);
    r.dataset.call = c.id;
    r.addEventListener('click', () => onOpen?.(last?.openId === c.id ? null : c.id));
    const nmc = el('div', 'c nmc');
    const nm = el('div', 'nm');
    nm.style.paddingLeft = `${row.depth * 16 + 22}px`;
    const g = el('span', `kind ${err ? 'k-err' : c.kind === 'llm' ? 'k-llm' : 'k-tool'}`, err ? GLYPH.error : GLYPH[c.kind]);
    g.title = err ? S.timeline.failed : c.kind === 'llm' ? S.timeline.llm : S.timeline.tool;
    nm.append(g);
    const ic = callIcon(c);
    if (ic) nm.append(ic);
    const pick = el('button', 'label callpick', c.kind === 'llm' ? modelLabel(c.model) || c.name : c.name);
    pick.type = 'button';
    pick.setAttribute('aria-expanded', String(isOpen));
    pick.title = isOpen ? S.timeline.closeCall : S.timeline.openCall;
    nm.append(pick);
    if (c.end == null) nm.append(el('span', 'st-run small', S.timeline.running));
    if (err) nm.append(el('span', 'status-err small', S.timeline.failed));
    nmc.append(nm);
    const lc = el('div', 'lanec');
    const ln = lane();
    ln.append(bar(c, ctx));
    lc.append(ln);
    r.append(nmc, lc);
    const llm = c.kind === 'llm';
    cells(r, llm ? fmtTokens(tokensOf(c.tokens)) : '—', llm ? fmtUsd(c.cost?.usd) : '—', c.end == null ? '…' : fmtDuration(c.end - c.start));
    return r;
  }

  const sigOf = {
    agent: agentSig,
    group: (row, ctx) => fp(row.depth, expanded.has(row.key), row.calls.length, row.summary.llm, row.summary.error, sumOf(row.calls, (c) => (c.kind === 'llm' ? tokensOf(c.tokens) : null)), sumOf(row.calls, (c) => (c.kind === 'llm' ? c.cost?.usd : null))),
    run: (row, ctx) => fp(row.depth, expanded.has(row.key), row.run.count, row.run.start, row.run.end),
    call: (row, ctx) => {
      const c = row.span;
      return fp(row.depth, ctx.openId === c.id, c.name, c.model, c.kind, c.status, c.start, c.end, c.lastActivity, c.tokens?.input, c.tokens?.output, c.cost?.usd);
    },
  };
  const build = { agent: agentRow, group: groupRow, run: runRow, call: callRow };

  function makeDetail(id) {
    const cd = createCallDetail(loadDetail ? { load: loadDetail } : {});
    const node = el('div', 'r-detail');
    node.dataset.detail = id;
    node.append(cd.el);
    return { id, node, cd };
  }

  function dropDetail() {
    if (!detail) return;
    detail.cd.destroy();
    detail.node.remove();
    detail = null;
  }

  /** A call named in the address may sit in a closed agent, Calls group or folded run: open the way to it. */
  function reveal(spans, id) {
    const c = spans.find((x) => x.id === id && (x.kind === 'llm' || x.kind === 'tool'));
    if (!c) return;
    const byId = new Map(spans.map((x) => [x.id, x]));
    for (let a = byId.get(c.parentId), n = 0; a && a.kind === 'agent' && n < 50; a = byId.get(a.parentId), n++) expanded.add(a.id);
    expanded.add(`calls:${c.parentId}`);
    const run = timelineRows(spans, expanded).find((r) => r.type === 'run' && r.run.spans.some((x) => x.id === id));
    if (run) expanded.add(run.key);
  }

  function legend() {
    const l = el('div', 'legend');
    const item = (cls, text) => { const s = el('span'); s.append(el('i', cls), text); return s; };
    l.append(item('lg-llm', S.timeline.llm), item('lg-tool', S.timeline.tool), item('lg-err', S.timeline.error), item('lg-life', S.timeline.lifetime));
    l.append(el('span', 'hint', S.timeline.hint));
    return l;
  }

  function head(ticks) {
    const h = el('div', 'ghead');
    const ruler = el('div', 'ruler');
    for (const t of ticks) {
      const s = el('span', '', t.label);
      s.style.left = `${t.pct}%`;
      ruler.append(s);
    }
    const right = (t) => { const d = el('div', 'right', t); return d; };
    h.append(el('div', '', S.timeline.colName), ruler, right(S.timeline.colTokens), right(S.timeline.colCost), right(S.timeline.colTime));
    return h;
  }

  function ensureParts() {
    if (parts) return parts;
    parts = { legend: legend(), grid: el('div', 'grid'), head: null, headSig: '', overlay: null, overlaySig: '' };
    root.replaceChildren(parts.legend, parts.grid);
    return parts;
  }

  function render() {
    if (!last) return;
    const { spans: raw = [], totals = null, markers = [], turns = [], sel = null, status = 'ready' } = last;
    const now = last.now ?? Date.now();
    const spans = settleAgents(raw);
    const openId = last.openId ?? null;
    clearInterval(timer);
    const agents = spans.filter((s) => s.kind === 'agent');
    if (!seeded && agents.length) {
      seeded = true;
      // Start with the main agents open so their sub-agents and Calls group show; calls open by choice.
      for (const a of agents) if (a.parentId == null || !agents.some((x) => x.id === a.parentId)) expanded.add(a.id);
    }
    if (!agents.length) {
      parts = null;
      cache.clear();
      dropDetail();
      root.replaceChildren(el('div', 'placeholder', status === 'ready' ? S.timeline.none : S.timeline.waiting));
      return;
    }
    const p = ensureParts();
    const domain = domainOf(spans, now);
    const ticks = ticksFor(domain, 6);
    const ctx = {
      domain, ticks, now, sel, totals,
      dsig: `${domain.t0},${domain.t1}`,
      psig: `${domain.t0},${domain.t1},${now}`, // what moves a bar that is still open
      pos: null,
      openId,
      calls: callsByAgent(spans),
      hasSubAgents: new Set(agents.filter((a) => a.parentId != null).map((a) => a.parentId)),
    };

    const headSig = ticks.map((t) => t.label).join(',');
    if (headSig !== p.headSig) {
      const h = head(ticks);
      if (p.head) p.head.replaceWith(h); else p.grid.prepend(h);
      p.head = h; p.headSig = headSig;
    }
    const overlaySig = fp(ctx.dsig, JSON.stringify(markers), JSON.stringify(turns));
    if (overlaySig !== p.overlaySig) {
      const o = overlay(domain, ticks, markers, turns);
      if (p.overlay) p.overlay.replaceWith(o); else p.head.after(o);
      p.overlay = o; p.overlaySig = overlaySig;
    }

    if (openId !== revealed) { revealed = openId; if (openId) reveal(spans, openId); }
    const openSpan = openId ? spans.find((x) => x.id === openId && (x.kind === 'llm' || x.kind === 'tool')) : null;

    let shown = false;
    const seen = new Set();
    let cur = p.overlay.nextSibling;
    for (const row of timelineRows(spans, expanded)) {
      const key = `${row.type}:${row.key}`;
      const sig = sigOf[row.type](row, ctx);
      seen.add(key);
      let ent = cache.get(key);
      if (ent && ent.sig === sig) {
        stats.reused++;
        const ps = ent.dyn ? ctx.psig : ctx.dsig;
        if (ent.ps !== ps) { reposition(ent.pos, ctx); ent.ps = ps; }
      } else {
        const old = ent?.node;
        ctx.pos = [];
        const node = build[row.type](row, ctx);
        const dyn = ctx.pos.some((x) => !x.span || x.span.end == null);
        ent = { node, sig, pos: ctx.pos, dyn, ps: dyn ? ctx.psig : ctx.dsig };
        cache.set(key, ent);
        stats.built++;
        if (old) { if (old === cur) cur = cur.nextSibling; old.remove(); } // swap in place, so the rows after it stay put
      }
      if (ent.node === cur) cur = cur.nextSibling;
      else p.grid.insertBefore(ent.node, cur);
      if (row.type === 'call' && openSpan && row.span.id === openId) {
        if (detail?.id !== openId) { dropDetail(); detail = makeDetail(openId); }
        detail.cd.update({ span: openSpan, sessionId: last.sessionId });
        shown = true;
        if (detail.node === cur) cur = cur.nextSibling;
        else p.grid.insertBefore(detail.node, cur);
      }
    }
    if (!shown) dropDetail();
    while (cur) { const next = cur.nextSibling; cur.remove(); cur = next; }
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
    if (spans.some((s) => s.kind !== 'session' && s.end == null && s.status === 'running')) timer = setInterval(render, 1000);
  }

  return {
    el: root,
    update(props) { last = props; render(); },
    destroy() { clearInterval(timer); dropDetail(); },
    stats,
  };
}
