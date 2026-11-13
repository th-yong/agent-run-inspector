import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./fixtures/claude-code/projects/', import.meta.url));
const PROJECT = join(ROOT, '-synthetic-demo-app');
const S1 = '00000000-0000-4000-8000-0000000000a1';
const S2 = '00000000-0000-4000-8000-0000000000a2';

// Files whose last line is intentionally cut off (a live-written file).
const TRUNCATED_TAIL = new Set([`${S2}.jsonl`]);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

const files = walk(ROOT).map((p) => ({ rel: relative(PROJECT, p), text: readFileSync(p, 'utf8') }));
const jsonl = files.filter((f) => f.rel.endsWith('.jsonl'));

function lines(f) {
  const parts = f.text.split('\n');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

// All parsed lines, with the intended truncated line excluded.
function parsed(f) {
  const ls = lines(f);
  return ls.flatMap((l, i) => {
    if (TRUNCATED_TAIL.has(f.rel) && i === ls.length - 1) return [];
    return [JSON.parse(l)];
  });
}
const all = jsonl.flatMap((f) => parsed(f).map((o) => ({ file: f.rel, o })));
const blocks = all.flatMap(({ file, o }) => (Array.isArray(o.message?.content) ? o.message.content.map((b) => ({ file, o, b })) : []));

test('every line parses as JSON except the intentionally truncated tail', () => {
  for (const f of jsonl) {
    const ls = lines(f);
    ls.forEach((l, i) => {
      const last = i === ls.length - 1;
      if (TRUNCATED_TAIL.has(f.rel) && last) {
        assert.throws(() => JSON.parse(l), `${f.rel}: tail should be unfinished`);
        assert.ok(!f.text.endsWith('\n'), 'unfinished tail has no newline');
      } else {
        assert.doesNotThrow(() => JSON.parse(l), `${f.rel}:${i + 1}`);
      }
    });
  }
  for (const f of files.filter((x) => x.rel.endsWith('.meta.json'))) JSON.parse(f.text);
});

test('fixtures are synthetic: ids, markers, no real paths', () => {
  const idRe = /^00000000-0000-4000-8000-0000000000a\d$/;
  for (const { o } of all) if (o.sessionId) assert.match(o.sessionId, idRe);
  for (const f of files) {
    assert.doesNotMatch(f.text, /\/Users\/|\/home\/|\.claude\//, `${f.rel}: real-looking path`);
    if (f.rel.endsWith('.jsonl')) assert.match(f.text, /SECRET-MARKER-/, `${f.rel}: no marker`);
  }
  for (const f of files.filter((x) => x.rel.includes('subagents/') && x.rel.endsWith('.jsonl'))) {
    assert.match(f.rel, /agent-asynth\d{10}\.jsonl$/);
  }
  for (const { o } of all) if (o.cwd) assert.equal(o.cwd, '/synthetic/demo-app');
});

test('main + subagents + meta files, depth 1 and 2, toolUseId links', () => {
  const metas = files.filter((f) => f.rel.endsWith('.meta.json')).map((f) => ({ ...JSON.parse(f.text), rel: f.rel }));
  assert.deepEqual([...new Set(metas.map((m) => m.spawnDepth))].sort(), [1, 2]);
  const toolUseIds = new Set(blocks.filter((x) => x.b.type === 'tool_use' && x.b.name === 'Agent').map((x) => x.b.id));
  for (const m of metas) {
    assert.ok(toolUseIds.has(m.toolUseId), `${m.rel}: toolUseId has no Agent tool_use`);
    assert.ok(files.some((f) => f.rel === m.rel.replace('.meta.json', '.jsonl')), `${m.rel}: no jsonl`);
  }
  // depth-2 agent is launched from inside a subagent file
  const depth2 = metas.find((m) => m.spawnDepth === 2);
  const launcher = blocks.find((x) => x.b.id === depth2.toolUseId);
  assert.ok(launcher.file.includes('subagents/'));
  for (const f of jsonl.filter((x) => x.rel.includes('subagents/'))) {
    for (const o of parsed(f).filter((x) => x.type === 'assistant' || x.type === 'user')) {
      assert.equal(o.isSidechain, true);
      assert.ok(o.agentId);
    }
  }
});

test('meta variants: finished, running (no finished), stoppedByUser, worktree', () => {
  const metas = files.filter((f) => f.rel.endsWith('.meta.json')).map((f) => JSON.parse(f.text));
  assert.ok(metas.some((m) => m.finished === true));
  assert.ok(metas.some((m) => m.finished === undefined && !m.stoppedByUser));
  assert.ok(metas.some((m) => m.stoppedByUser === true && m.finished === undefined));
  assert.ok(metas.some((m) => m.worktreePath && m.worktreeBranch));
});

test('repeated message.id lines carry identical usage', () => {
  const byId = new Map();
  for (const { o } of all) {
    if (o.type !== 'assistant') continue;
    const k = o.message.id;
    byId.set(k, [...(byId.get(k) ?? []), o]);
  }
  const repeated = [...byId.values()].filter((v) => v.length > 1);
  assert.ok(repeated.length >= 1);
  for (const v of repeated) {
    for (const o of v) {
      assert.equal(o.message.content.length, 1);
      assert.deepEqual(o.message.usage, v[0].message.usage);
    }
  }
});

test('api-request / requestRef: linked and unlinked', () => {
  const reqIds = new Set(all.filter(({ o }) => o.type === 'api-request').map(({ o }) => o.id));
  const asst = all.filter(({ o }) => o.type === 'assistant').map(({ o }) => o);
  assert.ok(asst.some((o) => o.requestRef && reqIds.has(o.requestRef)));
  assert.ok(asst.some((o) => !o.requestRef));
  for (const o of asst) if (o.requestRef) assert.ok(reqIds.has(o.requestRef), `dangling ${o.requestRef}`);
});

test('<synthetic> API error line has zero tokens and error flags', () => {
  const e = all.map((x) => x.o).find((o) => o.message?.model === '<synthetic>');
  assert.equal(e.isApiErrorMessage, true);
  assert.equal(e.apiErrorStatus, 529);
  assert.equal(e.message.usage.output_tokens, 0);
});

test('advisor_message iteration with its own model; server_tool_use', () => {
  const it = all.map((x) => x.o).flatMap((o) => o.message?.usage?.iterations ?? []);
  const adv = it.find((i) => i.type === 'advisor_message');
  assert.ok(adv.model && adv.model !== 'synthetic-model-a');
  assert.ok(blocks.some((x) => x.b.type === 'server_tool_use'));
});

test('tool results: is_error and interrupted, paired by tool_use_id', () => {
  const results = blocks.filter((x) => x.b.type === 'tool_result');
  assert.ok(results.some((x) => x.b.is_error === true));
  assert.ok(results.some((x) => x.o.toolUseResult?.interrupted === true));
  const uses = new Set(blocks.filter((x) => x.b.type === 'tool_use').map((x) => x.b.id));
  for (const r of results) assert.ok(uses.has(r.b.tool_use_id));
});

test('cost-state present in session 1, absent in session 2', () => {
  const has = (rel) => parsed(files.find((f) => f.rel === rel)).some((o) => o.type === 'cost-state');
  assert.equal(has(`${S1}.jsonl`), true);
  assert.equal(has(`${S2}.jsonl`), false);
  const cs = parsed(files.find((f) => f.rel === `${S1}.jsonl`)).find((o) => o.type === 'cost-state');
  assert.equal(typeof cs.totalCostUSD, 'number');
  assert.ok(Object.values(cs.modelUsage).every((m) => 'costUSD' in m && 'inputTokens' in m));
});

test('teammate_spawned, compact_boundary, turn_duration, task-notification, unknown type', () => {
  const objs = all.map((x) => x.o);
  assert.ok(objs.some((o) => o.toolUseResult?.status === 'teammate_spawned' && o.toolUseResult.team_name));
  assert.ok(objs.some((o) => o.subtype === 'compact_boundary' && o.compactMetadata.preTokens > o.compactMetadata.postTokens));
  assert.ok(objs.some((o) => o.subtype === 'turn_duration' && o.durationMs > 0));
  assert.ok(objs.some((o) => o.type === 'user' && o.origin?.kind === 'task-notification'));
  const known = new Set(['assistant', 'user', 'system', 'api-request', 'ai-title', 'cost-state']);
  assert.ok(objs.some((o) => !known.has(o.type)));
});

test('path-like object keys exist in tool input', () => {
  const keys = blocks.filter((x) => x.b.type === 'tool_use').flatMap((x) => Object.keys(x.b.input));
  assert.ok(keys.some((k) => k.startsWith('/')));
  assert.ok(keys.some((k) => k.includes('\\')));
});
