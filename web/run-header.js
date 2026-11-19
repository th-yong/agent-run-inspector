// Run screen head: title, meta line, totals strip, Graph | Timeline tabs and the "hide finished" slot.
// The pure helpers (rollValue, scopeOf, ...) are exported for tests; the DOM part touches `document` only in createRunHeader().
import { S } from './strings.js';
import { fmtDuration, fmtTokens, fmtUsd } from './format.js';
import { fmtStart, providerSlugs, iconEl } from './session-list.js';

export const ROLL_MS = 250;
const known = (n) => typeof n === 'number' && Number.isFinite(n);

/** Number shown `elapsed` ms into a roll from `from` to `to` (ease-out). An unknown side jumps straight to `to`. */
export function rollValue(from, to, elapsed, duration = ROLL_MS) {
  if (!known(from) || !known(to) || from === to || elapsed >= duration) return to;
  const p = Math.max(0, elapsed) / duration;
  return from + (to - from) * (1 - (1 - p) ** 3);
}

/** Totals scope: the chosen agent (with its sub-agents) when the server has totals for it, otherwise the whole run. */
export function scopeOf(totals, spans, id) {
  const agent = id && totals?.byAgent?.[id] ? totals.byAgent[id] : null;
  if (agent) return { id, name: spans?.find((s) => s.id === id)?.name ?? id, t: agent };
  return { id: null, name: null, t: totals?.total ?? null };
}

/** Earliest start among the spans: the clock for a running session whose summary has no start yet. */
export function firstStart(spans) {
  const starts = (spans ?? []).map((x) => x.start).filter(known);
  return starts.length ? Math.min(...starts) : null;
}

/** Agents that are working now (external session nodes are not agents of this run). */
export const runningAgents = (spans) => (spans ?? []).filter((s) => s.kind === 'agent' && !s.external && s.status === 'running').length;

export function costBasis(t) {
  const key = t && S.totals.basis[t.basis] ? t.basis : 'unknown';
  return { key, partial: Boolean(t?.partial) };
}

export function stripValues(t) {
  const n = (v) => (known(v) ? v : null);
  return {
    usd: n(t?.usd),
    tokens: t ? (known(t.input) && known(t.output) ? t.input + t.output : null) : null,
    cached: n(t?.cacheRead),
    modelCalls: n(t?.modelCalls),
    toolCalls: n(t?.toolCalls),
    errors: n(t?.errors),
  };
}

// ---------------- DOM ----------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number cell that rolls to new values over 250ms (no roll on the first value or with reduced motion). */
function roller(node, fmt) {
  let shown; let raf = 0;
  return (value) => {
    cancelAnimationFrame(raf);
    const from = shown;
    shown = value;
    if (from === undefined || reducedMotion() || !known(from) || !known(value) || from === value) { node.textContent = fmt(value); return; }
    const t0 = performance.now();
    const step = (now) => {
      const v = rollValue(from, value, now - t0);
      node.textContent = fmt(v);
      if (now - t0 < ROLL_MS) raf = requestAnimationFrame(step); else node.textContent = fmt(value);
    };
    raf = requestAnimationFrame(step);
  };
}

const int = (v) => (known(v) ? String(Math.round(v)) : '—');
const usd = (v) => fmtUsd(v);

function stat(label, cls = '') {
  const box = el('div', `stat ${cls}`.trim());
  const v = el('div', 'v num');
  const sub = el('div', 'sub');
  box.append(el('div', 'lbl', label), v, sub);
  return { box, v, sub };
}

/**
 * Builds the head once; `update(props)` refreshes it. props:
 *  { summary, totals, spans, scopeId, tab, hide, status }
 * Events: onBack(), onTab(tab), onShowAll(), onHide(bool).
 */
export function createRunHeader({ onBack, onTab, onShowAll, onHide }) {
  const root = el('div', 'run-head');
  const back = el('button', 'back', S.run.back);
  back.type = 'button';
  back.addEventListener('click', () => onBack?.());

  const title = el('div', 'run-title');
  const badge = el('span', 'badge');
  const name = el('span', 'name');
  const dot = el('span', 'dot pulse');
  dot.title = S.status.running;
  const hdr = el('span', 'run-hdr');
  const hdrN = el('span'); const hdrR = el('span'); const hdrUsd = el('b', 'num');
  hdr.append(hdrN, ' · ', hdrR, ' · ', hdrUsd);
  title.append(badge, name, dot, hdr);

  const meta = el('div', 'run-meta');
  const mProject = el('span', 'm-project'); const mStart = el('span', 'num'); const mModels = el('span', 'm-models');
  meta.append(mProject, mStart, mModels);

  const strip = el('div', 'totals');
  strip.setAttribute('role', 'group');
  const scope = el('div', 'scope');
  const scopeBody = el('div');
  const scopeV = el('div', 'v');
  scopeBody.append(el('div', 'lbl', S.totals.scope), scopeV);
  const showAll = el('button', 'clear', S.totals.showAll);
  showAll.type = 'button';
  showAll.addEventListener('click', () => onShowAll?.());
  scope.append(scopeBody, showAll);
  const time = stat(S.totals.time); const cost = stat(S.totals.cost); const tok = stat(S.totals.tokens);
  const nl = stat(S.totals.modelCalls); const nt = stat(S.totals.toolCalls); const err = stat(S.totals.errors, 'err');
  const basis = el('span', 'basis'); const partial = el('span', 'basis warn', S.totals.partial);
  partial.title = S.totals.partialTip;
  cost.v.after(basis);
  cost.sub.append(partial);
  strip.append(scope, time.box, cost.box, tok.box, nl.box, nt.box, err.box);

  const tabs = el('div', 'tabs');
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', S.header.tabsLabel);
  const tabBtn = {};
  for (const k of ['graph', 'timeline']) {
    const b = el('button', '', S.header[k]);
    b.type = 'button';
    b.dataset.tab = k;
    b.addEventListener('click', () => onTab?.(k));
    tabBtn[k] = b;
    seg.append(b);
  }
  const toggle = el('label', 'g-toggle');
  const check = el('input');
  check.type = 'checkbox';
  check.addEventListener('change', () => onHide?.(check.checked));
  toggle.append(check, ' ', S.header.hideFinished);
  tabs.append(seg, toggle);

  root.append(back, title, meta, strip);

  const rUsd = roller(hdrUsd, usd); const rCost = roller(cost.v, usd); const rTok = roller(tok.v, fmtTokens);
  const rNl = roller(nl.v, int); const rNt = roller(nt.v, int); const rErr = roller(err.v, int);
  let last = null;
  let timer = 0;

  function paintTime() {
    if (!last) return;
    const { t, running, start } = last.timeInfo;
    if (running && known(start)) { time.v.textContent = fmtDuration(Date.now() - start); time.sub.textContent = S.totals.elapsed; } else {
      time.v.textContent = known(t?.durationMs) ? fmtDuration(t.durationMs) : '—';
      time.sub.textContent = '';
    }
  }

  function update(p) {
    const s = p.summary;
    last = p;
    const source = s?.source;
    badge.className = `badge ${source === 'codex' ? 'cx' : 'cc'}`;
    badge.textContent = S.sourceBadge[source] ?? '';
    badge.hidden = !source;
    badge.title = source ? S.sourceTip(S.source[source] ?? source) : '';
    name.textContent = s ? s.title || S.list.untitled : '';
    const running = s?.status === 'running';
    dot.hidden = !running;
    dot.classList.toggle('bg', Boolean(s?.background));
    dot.title = s?.background ? S.status.background : S.status.running;

    const total = p.totals?.total ?? null;
    const haveTotals = Boolean(total);
    hdr.hidden = !haveTotals;
    if (haveTotals) {
      hdrN.textContent = S.header.agents(total.agents);
      hdrR.textContent = S.header.running(runningAgents(p.spans));
      rUsd(total.usd);
    }

    mProject.textContent = s?.project ?? '';
    mProject.hidden = !s?.project;
    mStart.textContent = s?.start ? `${S.header.started} ${fmtStart(s.start)}` : '';
    mStart.hidden = !s?.start;
    mModels.replaceChildren();
    const models = s?.models ?? [];
    mModels.hidden = models.length === 0;
    if (models.length) {
      const icons = el('span', 'provs');
      for (const slug of providerSlugs(models)) icons.append(iconEl(slug));
      mModels.append(icons, ` ${models.join(' · ')}`);
      mModels.title = S.header.models;
    }

    strip.hidden = !haveTotals;
    const sc = scopeOf(p.totals, p.spans, p.scopeId);
    scopeV.textContent = sc.name ?? S.totals.wholeRun;
    showAll.hidden = !sc.id;
    const v = stripValues(sc.t);
    rCost(v.usd); rTok(v.tokens); rNl(v.modelCalls); rNt(v.toolCalls); rErr(v.errors);
    const b = costBasis(sc.t);
    const priced = known(v.usd);
    basis.textContent = priced ? S.totals.basis[b.key] : '';
    basis.title = priced ? S.totals.basisTip[b.key] : '';
    basis.hidden = !priced;
    partial.hidden = !b.partial;
    tok.sub.textContent = known(v.tokens) ? S.totals.cached(fmtTokens(v.cached)) : '';
    const agentSpan = sc.id ? p.spans?.find((x) => x.id === sc.id) : null;
    const scopeRunning = sc.id ? agentSpan?.status === 'running' : running;
    last.timeInfo = { t: sc.t, running: Boolean(scopeRunning), start: sc.id ? agentSpan?.start : (known(s?.start) ? s.start : firstStart(p.spans)) };
    paintTime();
    clearInterval(timer);
    if (last.timeInfo.running) timer = setInterval(paintTime, 1000);
    err.box.classList.toggle('has', known(v.errors) && v.errors > 0);

    for (const k of Object.keys(tabBtn)) tabBtn[k].setAttribute('aria-pressed', String(p.tab === k));
    toggle.hidden = p.tab !== 'graph';
    check.checked = Boolean(p.hide);
  }

  return { el: root, tabs, update, destroy: () => clearInterval(timer) };
}
