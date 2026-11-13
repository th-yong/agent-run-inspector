// Small helpers for a screen that stays open for hours: following the newest calls, the connection dot,
// and holding back redraws while the tab is hidden. Pure, so they can be tested without a browser.

/** True when the scroller sits at (or within `slack` px of) its end. */
export const nearBottom = ({ scrollTop, clientHeight, scrollHeight }, slack = 24) => scrollHeight - (scrollTop + clientHeight) <= slack;

/** Ids of calls (model or tool) not in `known` yet; they are added to it. The first call of this has no baseline: seed `known` yourself. */
export function freshCalls(known, spans) {
  const out = [];
  for (const s of spans) {
    if ((s.kind !== 'llm' && s.kind !== 'tool') || known.has(s.id)) continue;
    known.add(s.id);
    out.push(s.id);
  }
  return out;
}

/** One state for the header dot from every open stream: statuses are 'connected' | 'reconnecting' | undefined. */
export function liveState(streams) {
  const all = Object.values(streams).filter(Boolean);
  if (!all.length) return 'connecting';
  return all.every((s) => s === 'connected') ? 'connected' : 'reconnecting';
}

/** `request()` runs `flush` now, or once at `resume()` if the tab was hidden meanwhile. */
export function createFlushGate(isHidden, flush) {
  let pending = false;
  return {
    request() { if (isHidden()) pending = true; else flush(); },
    resume() { if (pending && !isHidden()) { pending = false; flush(); } },
  };
}
