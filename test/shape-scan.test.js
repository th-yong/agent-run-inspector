import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, safeKey, parseArgs, CHECKS } from '../scripts/shape-scan.js';

const SCRIPT = fileURLToPath(new URL('../scripts/shape-scan.js', import.meta.url));
const SECRET = 'SECRET_BODY_MARKER';
const SECRET_DIR = 'SECRET_DIR_MARKER';
const SECRET_VAL = 'SECRET_VALUE_MARKER';
const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const T = (s) => `2026-01-01T00:00:${String(s).padStart(2, '0')}.000Z`;
const TID_PARENT = '11111111-1111-4111-8111-111111111111';
const TID_CHILD = '22222222-2222-4222-8222-222222222222';

function makeCc(root) {
  const proj = join(root, SECRET_DIR);
  mkdirSync(join(proj, 'sess1', 'subagents'), { recursive: true });
  writeFileSync(
    join(proj, 'sess1.jsonl'),
    jl(
      { type: 'user', sessionId: 's1', timestamp: T(1), message: { content: SECRET }, cwd: `/Users/${SECRET_DIR}/x` },
      {
        type: 'assistant',
        sessionId: 's1',
        message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { prompt: SECRET } }, { type: 'text', text: SECRET }] },
      },
      { type: 'user', sessionId: 's1', toolUseResult: { status: 'teammate_spawned', teammate_id: 'bob@team1', team_name: 'team1', [`/Users/${SECRET_DIR}/k`]: SECRET_VAL } },
      { type: 'system', subtype: 'compact_boundary', sessionId: 's1' },
      { type: 'user', sessionId: 's2', agentName: 'bob', teamName: 'team1' },
    ),
  );
  writeFileSync(
    join(proj, 'sess1', 'subagents', 'agent-a1.jsonl'),
    jl({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Agent', input: {} }] } }),
  );
  writeFileSync(join(proj, 'sess1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ spawnDepth: 1, toolUseId: 'tu1' }));
  writeFileSync(join(proj, 'sess1', 'subagents', 'agent-a2.meta.json'), JSON.stringify({ spawnDepth: 2, toolUseId: 'tu2' }));
}

function makeCodex(root) {
  const day = join(root, '2026', '01', '01');
  mkdirSync(day, { recursive: true });
  const tc = (i, c, info = true) => ({
    timestamp: T(5),
    type: 'event_msg',
    payload: { type: 'token_count', info: info ? { last_token_usage: { input_tokens: i, cached_input_tokens: c } } : null },
  });
  writeFileSync(
    join(day, `rollout-2026-01-01T00-00-00-${TID_PARENT}.jsonl`),
    jl(
      { timestamp: T(0), type: 'session_meta', payload: { id: TID_PARENT, cwd: `/Users/${SECRET_DIR}` } },
      { timestamp: T(2), type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'c1', arguments: SECRET } },
      { timestamp: T(3), type: 'event_msg', payload: { type: 'item_completed', item: { id: 'c1', status: 'completed' } } },
      { timestamp: T(3), type: 'event_msg', payload: { type: 'item_completed', item: { id: 'zzz', type: 'SubAgentActivity', agent_thread_id: TID_CHILD } } },
      tc(100, 40),
      tc(10, 50),
      tc(0, 0, false),
    ),
  );
  writeFileSync(
    join(day, `rollout-2026-01-01T00-00-04-${TID_CHILD}.jsonl`),
    jl({ timestamp: T(4), type: 'session_meta', payload: { id: TID_CHILD, timestamp: T(4), parent_thread_id: TID_PARENT } }),
  );
}

const find = (lines, label) => lines.find((l) => l.startsWith(`${label}\t`));

test('safeKey masks paths, ids and odd keys', () => {
  assert.equal(safeKey('/Users/x/y'), '<path-like>');
  assert.equal(safeKey('C:\\x'), '<path-like>');
  assert.equal(safeKey('~/x'), '<path-like>');
  assert.equal(safeKey('3f2a9c1e-aaaa-bbbb-cccc-1234567890ab'), '<id-like>');
  assert.equal(safeKey('has space'), '<odd-key>');
  assert.equal(safeKey('toolUseResult'), 'toolUseResult');
});

test('parseArgs validates input', () => {
  assert.equal(parseArgs([]).error !== undefined, true);
  assert.equal(parseArgs(['r', '--check', 'nope']).error !== undefined, true);
  assert.equal(parseArgs(['r', '--source', 'x']).error !== undefined, true);
  assert.deepEqual(parseArgs(['r', '--source', 'cc', '--check', 'depth2']), { root: 'r', source: 'cc', check: 'depth2' });
});

test('output never contains values, bodies, or path fragments', async () => {
  const cc = mkdtempSync(join(tmpdir(), 'ari-ss-cc-'));
  const cx = mkdtempSync(join(tmpdir(), 'ari-ss-cx-'));
  try {
    makeCc(cc);
    makeCodex(cx);
    const all = [];
    all.push(...(await scan(cc)));
    all.push(...(await scan(cx)));
    for (const c of CHECKS) {
      all.push(...(await scan(c.startsWith('codex') ? cx : cc, { check: c })));
    }
    const text = all.join('\n');
    for (const s of [SECRET, SECRET_DIR, SECRET_VAL, 'Users', 'bob', 'team1', TID_PARENT, TID_CHILD, tmpdir()]) {
      assert.equal(text.includes(s), false, `leaked ${s}`);
    }
    assert.match(text, /<path-like>/);
    // Every line is tab-separated labels followed by integers or type names.
    for (const l of all) assert.match(l, /^[#(\w$<>.=\-[\] +:/]+(\t[\w<>/-]+)*$/);
  } finally {
    rmSync(cc, { recursive: true, force: true });
    rmSync(cx, { recursive: true, force: true });
  }
});

test('CLI: runs, prints counts only, bad args exit 2', () => {
  const cc = mkdtempSync(join(tmpdir(), 'ari-ss-cli-'));
  try {
    makeCc(cc);
    const ok = spawnSync(process.execPath, [SCRIPT, cc, '--check', 'depth2'], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout.includes(SECRET_DIR), false);
    assert.match(ok.stdout, /meta\.spawnDepth=2\t1/);
    const bad = spawnSync(process.execPath, [SCRIPT, cc, '--check', SECRET], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.equal((bad.stdout + bad.stderr).includes(SECRET), false);
    const missing = spawnSync(process.execPath, [SCRIPT, join(cc, 'nope')], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
  } finally {
    rmSync(cc, { recursive: true, force: true });
  }
});

test('shape scan counts keys and types', async () => {
  const cc = mkdtempSync(join(tmpdir(), 'ari-ss-shape-'));
  try {
    makeCc(cc);
    const out = await scan(cc, { source: 'cc' });
    assert.ok(out.includes('$.message.content\tstring\t1'));
    assert.ok(out.includes('$.message.content[].name\tstring\t2'));
    assert.ok(out.includes('$.toolUseResult.<path-like>\tstring\t1'));
    assert.ok(find(out, 'files').endsWith('\t2'));
  } finally {
    rmSync(cc, { recursive: true, force: true });
  }
});

test('depth2, teammate-keys, rotation checks give expected numbers', async () => {
  const cc = mkdtempSync(join(tmpdir(), 'ari-ss-cc2-'));
  try {
    makeCc(cc);
    const d = await scan(cc, { check: 'depth2' });
    assert.ok(find(d, 'subagent-files-with-Agent-tool_use').endsWith('\t1'));
    assert.ok(find(d, 'meta-linked-to-Agent-use-inside-subagent').endsWith('\t1'));
    const t = await scan(cc, { check: 'teammate-keys' });
    assert.ok(find(t, 'teammate_spawned-results').endsWith('\t1'));
    assert.ok(find(t, 'teammate_id-matching-other-line-agentName').endsWith('\t1'));
    assert.ok(find(t, 'team_name-matching-other-line-teamName').endsWith('\t1'));
    const r = await scan(cc, { check: 'cc-file-rotation' });
    assert.ok(find(r, 'compact_boundary-then-sessionId-changes-in-same-file').endsWith('\t1'));
  } finally {
    rmSync(cc, { recursive: true, force: true });
  }
});

test('codex checks give expected numbers', async () => {
  const cx = mkdtempSync(join(tmpdir(), 'ari-ss-cx2-'));
  try {
    makeCodex(cx);
    const id = await scan(cx, { check: 'codex-item-id' });
    assert.ok(find(id, 'item.id-equals-a-call_id-in-file').endsWith('\t1'));
    assert.ok(find(id, 'item.id-not-equal-any-call_id').endsWith('\t1'));
    const c = await scan(cx, { check: 'codex-cached' });
    assert.ok(find(c, 'input>=cached').endsWith('\t1'));
    assert.ok(find(c, 'cached>input').endsWith('\t1'));
    const n = await scan(cx, { check: 'codex-info-null' });
    assert.ok(find(n, 'info=null').endsWith('\t1'));
    const s = await scan(cx, { check: 'codex-spawn-pairing' });
    assert.ok(find(s, 'child-rollouts').endsWith('\t1'));
    assert.ok(find(s, 'gap-nearest-spawn_agent-to-child-start 1-5s').endsWith('\t1'));
    assert.ok(find(s, 'SubAgentActivity-items-in-parents').endsWith('\t1'));
  } finally {
    rmSync(cx, { recursive: true, force: true });
  }
});
