// Codex sub-agents: each child thread is its own rollout file. This module joins
// child parsers onto a parent parser and returns one flat span list.
//
// Link rule (spec 5.3 / 11-5):
// - exact: the parent has a SubAgentActivity naming the child's thread id (0.166+).
// - inferred (linkApprox + startApprox): no such item, so the child hangs off the
//   spawn_agent call that started last at or before the child's session_meta
//   timestamp. Calls are consumed one child at a time (calls at the same instant
//   go in file order). No earlier call left -> the parent's root agent.
// The spawn call is always picked by time; only the parent link can be exact.
// Hangul-free: UI text lives in strings.js.

const byStart = (a, b) => a.start - b.start || (a.id < b.id ? -1 : 1);

function pickSpawn(spawns, claimed, childStart) {
  let best = null;
  for (const s of spawns) {
    if (claimed.has(s.callId) || s.start > childStart) continue;
    if (!best || s.start > best.start) best = s; // strict >: first of a tie wins
  }
  return best;
}

/**
 * @param {ReturnType<import('./index.js').createCodexParser>} root
 * @param {Array<ReturnType<import('./index.js').createCodexParser>>} pool any rollouts; unrelated ones are ignored
 * @returns {{ spans: object[] }}
 */
export function linkCodexAgents(root, pool = []) {
  const rootMeta = root.meta();
  if (!rootMeta) return { spans: root.spans() };
  const rootSession = rootMeta.id;

  const kids = new Map(); // parent thread id -> [{ p, meta, start }]
  for (const p of pool) {
    const m = p.meta();
    if (!m?.parentThreadId || p === root) continue;
    const start = p.spans().find((s) => s.kind === 'session')?.start ?? 0;
    if (!kids.has(m.parentThreadId)) kids.set(m.parentThreadId, []);
    kids.get(m.parentThreadId).push({ p, m, start, id: m.id });
  }

  const out = [...root.spans()];
  const seen = new Set([rootMeta.id]);

  function attach(parent, parentMeta, parentAgentId, parentDepth) {
    const list = (kids.get(parentMeta.id) ?? []).filter((k) => !seen.has(k.id)).sort(byStart);
    if (!list.length) return;
    const spawns = parent.spawns();
    const exactIds = new Set(parent.activities().map((a) => a.agentThreadId));
    const claimed = new Set();
    const link = new Map(); // child id -> spawn record | null
    // exact links claim first so inferred ones cannot take their call
    for (const pass of [true, false]) {
      for (const k of list) {
        if (exactIds.has(k.id) !== pass) continue;
        const s = pickSpawn(spawns, claimed, k.start);
        if (s) claimed.add(s.callId);
        link.set(k.id, s);
      }
    }
    for (const k of list) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const spawn = link.get(k.id);
      const exact = exactIds.has(k.id);
      const spawnSpan = spawn ? out.find((s) => s.id === `cx:${parentMeta.id}:${spawn.callId}`) : null;
      const agentId = `cx:${k.id}:main`;
      if (spawnSpan) spawnSpan.spawnsAgentId = agentId;
      const sess = k.p.spans().find((s) => s.kind === 'session');
      for (const s of k.p.spans()) {
        if (s.kind === 'session') continue;
        const c = { ...s, sessionId: rootSession };
        if (s.id === agentId) {
          c.parentId = spawnSpan ? spawnSpan.id : parentAgentId;
          c.depth = parentDepth + 1;
          c.name = k.m.nickname ?? s.name;
          if (k.m.role) c.task = k.m.role;
          c.status = sess.status;
          c.end = sess.end;
          if (!exact) { c.linkApprox = true; c.startApprox = true; }
        }
        out.push(c);
      }
      attach(k.p, k.m, agentId, parentDepth + 1);
    }
  }

  attach(root, rootMeta, `cx:${rootSession}:main`, 0);
  return { spans: out };
}
