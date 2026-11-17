// Right-hand detail column of the graph tab (360px floating over the graph; the full width on narrow screens): the chosen agent's totals
// and its full call list, newest first. A call opens its details right under its row (web/call-detail.js).
import { S } from './strings.js';
import { fmtDuration, fmtTokens, fmtUsd } from './format.js';
import { callRows, callIcon, iconNode, providerTile, statusKey } from './card.js';
import { costBasis, stripValues } from './run-header.js';
import { createCallDetail } from './call-detail.js';

/** The agent's own model and tool calls (not its sub-agents' or advisor children), newest first. */
export function agentCalls(spans, agentId) {
  return (spans ?? [])
    .filter((s) => (s.kind === 'llm' || s.kind === 'tool') && s.parentId === agentId)
    .sort((a, b) => b.start - a.start);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * createAgentPanel({ onOpen(callId | null), onClose() }) -> { el, update(props), destroy() }
 * props: { agent | null, spans, totals (entry for the agent), sessionId, openId }
 */
export function createAgentPanel({ onOpen, onClose }) {
  const root = el('aside', 'g-panel');
  root.setAttribute('aria-label', S.panel.label);
  root.hidden = true;
  const head = el('div', 'gp-h');
  const nameBox = el('div', 'gp-who');
  const name = el('div', 'gp-name');
  const meta = el('div', 'gp-meta');
  nameBox.append(name, meta);
  const close = el('button', 'icon-btn', S.panel.close);
  close.type = 'button';
  close.addEventListener('click', () => onClose?.());
  head.append(el('span', 'prov-slot'), nameBox, close);
  const task = el('div', 'gp-task');
  const stats = el('div', 'gp-stats');
  const sub = el('div', 'gp-sub');
  const list = el('div', 'gp-list');
  root.append(head, task, stats, sub, list);

  const detail = createCallDetail();
  let sig = '';
  let shownId = null;

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.gp-row');
    if (row) onOpen?.(row.dataset.id === shownId ? null : row.dataset.id);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shownId && root.contains(e.target)) { e.stopPropagation(); onOpen?.(null); }
  });

  function stat(label, value, sub2) {
    const d = el('div');
    d.append(el('span', '', label), el('b', 'num', value));
    if (sub2) d.append(el('small', '', sub2));
    return d;
  }

  return {
    el: root,
    update({ agent, spans, totals, sessionId, openId }) {
      root.hidden = !agent;
      if (!agent) { sig = ''; shownId = null; return; }
      const calls = agentCalls(spans, agent.id);
      const open = openId && calls.some((c) => c.id === openId) ? openId : null;
      const nextSig = JSON.stringify([agent.id, agent.name, agent.status, agent.model, agent.task, totals, open,
        calls.map((c) => [c.id, c.seq, c.status, c.end, c.name, c.command])]);
      const openCall = open ? calls.find((c) => c.id === open) : null;
      if (nextSig === sig) { if (openCall) detail.update({ span: openCall, sessionId }); return; }
      sig = nextSig;
      shownId = open;
      const scrollTop = root.scrollTop;
      const focusId = root.contains(document.activeElement) ? document.activeElement.closest?.('.gp-row')?.dataset.id : null;

      const model = agent.model ?? calls.find((c) => c.kind === 'llm' && c.model && !c.model.startsWith('<'))?.model ?? null;
      head.firstChild.replaceChildren(providerTile(model ?? agent.name));
      name.textContent = agent.name;
      name.title = agent.name;
      const st = statusKey(agent.status);
      meta.textContent = [model && model !== agent.name ? model : null, agent.role === 'watcher' ? S.panel.watcher : null,
        { running: S.status.running, done: S.status.ok, failed: S.status.error, cancelled: S.status.cancelled, unknown: S.status.unknown }[st]].filter(Boolean).join(' · ');
      task.textContent = agent.task ?? '';
      task.hidden = !agent.task;

      const v = stripValues(totals);
      const b = costBasis(totals);
      const nCalls = v.modelCalls == null && v.toolCalls == null ? null : (v.modelCalls ?? 0) + (v.toolCalls ?? 0);
      stats.replaceChildren(
        stat(S.panel.cost, fmtUsd(v.usd), totals ? S.totals.basis[b.key] : ''),
        stat(S.panel.tokens, fmtTokens(v.tokens)),
        stat(S.panel.time, fmtDuration(totals?.durationMs)),
        stat(S.panel.calls, nCalls == null ? '—' : String(nCalls)),
      );
      sub.textContent = S.panel.subNote(calls.length);

      const rows = new Map(callRows(calls, calls.length).map((r) => [r.id, r]));
      const nodes = [];
      for (const c of calls) {
        const r = rows.get(c.id);
        const btn = el('button', `gp-row${r.error ? ' err' : ''}${c.id === open ? ' sel' : ''}${r.running ? ' running' : ''}`);
        btn.type = 'button';
        btn.dataset.id = c.id;
        btn.setAttribute('aria-expanded', String(c.id === open));
        const ic = el('span', 'g-ic');
        ic.append(iconNode(callIcon(c)));
        const label = el('span', `g-rn${c.kind === 'llm' ? ' llm' : ''}`, r.label);
        label.title = r.label;
        btn.append(ic, label, el('span', 'num', r.running ? '…' : r.ms == null ? '—' : fmtDuration(r.ms)));
        nodes.push(btn);
        if (c.id === open) nodes.push(detail.el);
      }
      list.replaceChildren(...(nodes.length ? nodes : [el('div', 'gp-empty', S.panel.noCalls)]));
      if (openCall) detail.update({ span: openCall, sessionId });
      root.scrollTop = scrollTop;
      if (focusId) list.querySelector(`.gp-row[data-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    },
    destroy() { detail.destroy(); },
  };
}
