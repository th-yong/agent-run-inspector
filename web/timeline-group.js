// Pure helpers for the timeline's "Calls" group: counts, and folding long runs of the same tool. No DOM.
export const FOLD_LIMIT = 200;

const isLlm = (c) => c.kind === 'llm';

/** { total, llm, tool, error } for a list of call spans. A failed call counts as an error and as its kind. */
export function summarizeCalls(calls) {
  const out = { total: 0, llm: 0, tool: 0, error: 0 };
  for (const c of calls ?? []) {
    out.total++;
    if (isLlm(c)) out.llm++; else out.tool++;
    if (c.status === 'error') out.error++;
  }
  return out;
}

// Only finished, successful tool calls fold; errors and running calls stay visible as rows of their own.
const foldable = (c) => c.kind === 'tool' && c.status !== 'error' && Number.isFinite(c.end);

/**
 * Calls in time order -> display items. With more than `limit` calls, 2+ consecutive successful calls of
 * the same tool become one `{ type: 'run', key, name, spans, count, start, end }`; everything else is
 * `{ type: 'call', span }`. At or below `limit` nothing folds.
 */
export function foldCalls(calls, limit = FOLD_LIMIT) {
  const list = calls ?? [];
  if (list.length <= limit) return list.map((span) => ({ type: 'call', span }));
  const items = [];
  let i = 0;
  while (i < list.length) {
    const c = list[i];
    let j = i + 1;
    if (foldable(c)) while (j < list.length && foldable(list[j]) && list[j].name === c.name) j++;
    if (j - i >= 2) {
      const spans = list.slice(i, j);
      items.push({
        type: 'run', key: `run:${c.id}`, name: c.name, toolBrand: c.toolBrand, spans, count: spans.length,
        start: c.start, end: Math.max(...spans.map((s) => s.end)),
      });
    } else items.push({ type: 'call', span: c });
    i = j;
  }
  return items;
}
