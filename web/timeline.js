// Timeline tab: agent tree on the left, time ruler and call bars on the right, tokens / cost / time columns.
// Pure placement lives in timeline-scale.js; positions are set through the CSSOM (no inline style attributes).
import { S } from './strings.js';
import { fmtDuration, fmtTokens, fmtUsd } from './format.js';
import { providerSlugs, iconEl } from './session-list.js';
import { hasIcon } from './icons.js';
import { openEnd, domainOf, ticksFor, boxOf, timelineRows, callsByAgent } from './timeline-scale.js';

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

function bar(span, domain, now) {
  const b = el('div', barClass(span));
  setBox(b, boxOf(span, domain, now));
  b.title = barTitle(span);
  return b;
}

const tokensOf = (t) => (t && known(t.input) && known(t.output) ? t.input + t.output : null);
const spanMs = (s, now) => (known(s.start) ? (known(s.end) ? s.end - s.start : openEnd(s, now) - s.start) : null);

function cells(row, tk, co, du) {
  const c = (cls, text) => { const d = el('div', `c right num ${cls}`, text); return d; };
  row.append(c('tk', tk), c('co', co), c('du', du));
}

function lane(domain, ticks) {
  const l = el('div', 'lane');
  for (const t of ticks) {
    if (t.pct === 0 || t.pct >= 100) continue;
    const g = el('div', 'gridline');
    g.style.left = `${t.pct}%`;
    l.append(g);
  }
  return l;
}

/**
 * createTimeline({ onSelect(agentId | null) }) -> { el, update(props), destroy() }
 * props: { spans, totals, sel, status, now? }. Expanded agents are remembered per view.
 */
export function createTimeline({ onSelect } = {}) {
  const root = el('div', 'timeline');
  const expanded = new Set();
  let seeded = false;
  let last = null;
  let timer = 0;

  function toggle(id) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    render();
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
    const tw = el('button', 'tw');
    tw.type = 'button';
    tw.setAttribute('aria-expanded', String(open));
    tw.setAttribute('aria-label', open ? S.timeline.collapse : S.timeline.expand);
    tw.disabled = !hasKids;
    tw.append(chevron());
    tw.addEventListener('click', (e) => { e.stopPropagation(); toggle(a.id); });
    const pick = el('button', 'label pick');
    pick.type = 'button';
    pick.title = S.timeline.pickTip;
    pick.setAttribute('aria-pressed', String(ctx.sel === a.id));
    pick.append(el('span', 'agent-name', a.name || a.id));
    const type = a.agentType && a.agentType !== 'main' ? a.agentType : '';
    if (type) pick.append(' ', el('span', 'atype', type));
    pick.addEventListener('click', () => onSelect?.(ctx.sel === a.id ? null : a.id));
    nm.append(tw, pick);
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
    const ln = lane(ctx.domain, ctx.ticks);
    const bg = el('div', `span-bg${a.end == null ? ' running' : ''}`);
    setBox(bg, boxOf(a, ctx.domain, ctx.now));
    ln.append(bg);
    for (const c of own) ln.append(bar(c, ctx.domain, ctx.now));
    if (a.end == null) {
      const n = el('div', 'now');
      n.style.left = `${boxOf({ start: ctx.now, end: ctx.now }, ctx.domain, ctx.now).left}%`;
      ln.append(n);
    }
    lc.append(ln);
    r.append(nmc, lc);
    const t = ctx.totals?.byAgent?.[a.id];
    cells(r, fmtTokens(tokensOf(t)), fmtUsd(t?.usd), fmtDuration(known(t?.durationMs) && a.end != null ? t.durationMs : spanMs(a, ctx.now)));
    return r;
  }

  function callRow(row, ctx) {
    const c = row.span;
    const err = c.status === 'error';
    const r = el('div', `r call${err ? ' is-err' : ''}`);
    r.dataset.call = c.id;
    const nmc = el('div', 'c nmc');
    const nm = el('div', 'nm');
    nm.style.paddingLeft = `${row.depth * 16 + 22}px`;
    const g = el('span', `kind ${err ? 'k-err' : c.kind === 'llm' ? 'k-llm' : 'k-tool'}`, err ? GLYPH.error : GLYPH[c.kind]);
    g.title = err ? S.timeline.failed : c.kind === 'llm' ? S.timeline.llm : S.timeline.tool;
    nm.append(g);
    const ic = callIcon(c);
    if (ic) nm.append(ic);
    nm.append(el('span', 'label', c.kind === 'llm' ? modelLabel(c.model) || c.name : c.name));
    if (c.end == null) nm.append(el('span', 'st-run small', S.timeline.running));
    if (err) nm.append(el('span', 'status-err small', S.timeline.failed));
    nmc.append(nm);
    const lc = el('div', 'lanec');
    const ln = lane(ctx.domain, ctx.ticks);
    ln.append(bar(c, ctx.domain, ctx.now));
    lc.append(ln);
    r.append(nmc, lc);
    const llm = c.kind === 'llm';
    cells(r, llm ? fmtTokens(tokensOf(c.tokens)) : '—', llm ? fmtUsd(c.cost?.usd) : '—', c.end == null ? '…' : fmtDuration(c.end - c.start));
    return r;
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

  function render() {
    if (!last) return;
    const { spans = [], totals = null, sel = null, status = 'ready' } = last;
    const now = last.now ?? Date.now();
    clearInterval(timer);
    const agents = spans.filter((s) => s.kind === 'agent');
    if (!seeded && agents.length) {
      seeded = true;
      // Start with the main agents open so their sub-agents show; calls open by choice.
      for (const a of agents) if (a.parentId == null || !agents.some((x) => x.id === a.parentId)) expanded.add(a.id);
    }
    if (!agents.length) {
      root.replaceChildren(el('div', 'placeholder', status === 'ready' ? S.timeline.none : S.timeline.waiting));
      return;
    }
    const domain = domainOf(spans, now);
    const ticks = ticksFor(domain, 6);
    const ctx = {
      domain, ticks, now, sel, totals,
      calls: callsByAgent(spans),
      hasSubAgents: new Set(agents.filter((a) => a.parentId != null).map((a) => a.parentId)),
    };
    const grid = el('div', 'grid');
    grid.append(head(ticks));
    const frag = document.createDocumentFragment();
    for (const row of timelineRows(spans, expanded)) frag.append(row.type === 'agent' ? agentRow(row, ctx) : callRow(row, ctx));
    grid.append(frag);
    root.replaceChildren(legend(), grid);
    if (spans.some((s) => s.kind !== 'session' && s.end == null && s.status === 'running')) timer = setInterval(render, 1000);
  }

  return {
    el: root,
    update(props) { last = props; render(); },
    destroy() { clearInterval(timer); },
  };
}
