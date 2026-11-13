#!/usr/bin/env node
// Structure survey of real agent-run records. Prints ONLY key names, value
// types and counts. Never prints values, bodies, or paths. All output goes
// through safeKey() / numbers; no raw record value reaches the formatter.
import { createReadStream, readdirSync, statSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKS = [
  'depth2',
  'teammate-keys',
  'codex-item-id',
  'codex-cached',
  'codex-spawn-pairing',
  'codex-info-null',
  'cc-file-rotation',
];

const USAGE = `Usage: shape-scan.js <root> [--source cc|codex] [--check <item>]
Checks: ${CHECKS.join(', ')}
Prints key names, value types and counts only.`;

const MAX_DEPTH = 4;
const MAX_ROWS = 400;

// ---- output safety -------------------------------------------------------

export function safeKey(k) {
  const s = String(k);
  if (/[\\/]/.test(s) || /^[~.]/.test(s) || /^[A-Za-z]:/.test(s)) return '<path-like>';
  if (/^[0-9a-f-]{8,}$/i.test(s) && /\d/.test(s)) return '<id-like>';
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]{0,47}$/.test(s)) return '<odd-key>';
  return s;
}

function safeKind(v) {
  return typeof v === 'string' && /^[A-Za-z_]{1,32}$/.test(v) ? v : '<other>';
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ---- file walking / reading ---------------------------------------------

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out.sort();
}

async function* readLines(file, stats) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      if (stats) stats.badLines++;
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectSource(files) {
  return files.some((f) => basename(f).startsWith('rollout-') && f.endsWith('.jsonl')) ? 'codex' : 'cc';
}

function ccFiles(files) {
  const main = [];
  const sub = [];
  const meta = [];
  for (const f of files) {
    if (f.endsWith('.meta.json') || basename(f) === 'meta.json') meta.push(f);
    else if (f.endsWith('.jsonl')) (f.split(sep).includes('subagents') ? sub : main).push(f);
  }
  return { main, sub, meta };
}

const codexFiles = (files) => files.filter((f) => basename(f).startsWith('rollout-') && f.endsWith('.jsonl'));

function threadIdOf(file) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(basename(file));
  return m ? m[1] : null;
}

// ---- default: shape aggregation -----------------------------------------

function addShape(rows, prefix, v, depth) {
  const t = typeOf(v);
  const key = `${prefix}\t${t}`;
  rows.set(key, (rows.get(key) || 0) + 1);
  if (depth >= MAX_DEPTH) return;
  if (t === 'array') {
    for (const item of v.slice(0, 50)) addShape(rows, `${prefix}[]`, item, depth + 1);
  } else if (t === 'object') {
    for (const [k, val] of Object.entries(v)) addShape(rows, `${prefix}.${safeKey(k)}`, val, depth + 1);
  }
}

async function shapeScan(files, source) {
  const rows = new Map();
  const kinds = new Map();
  const stats = { files: 0, lines: 0, badLines: 0 };
  const targets = source === 'codex' ? codexFiles(files) : ccFiles(files).main.concat(ccFiles(files).sub);
  for (const f of targets) {
    stats.files++;
    for await (const obj of readLines(f, stats)) {
      stats.lines++;
      if (obj === null || typeof obj !== 'object') continue;
      const kind = source === 'codex' ? `${safeKind(obj.type)}/${safeKind(obj.payload?.type)}` : safeKind(obj.type);
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
      addShape(rows, '$', obj, 0);
    }
  }
  const out = [`source\t${source}`, `files\t${stats.files}`, `lines\t${stats.lines}`, `bad-lines\t${stats.badLines}`];
  out.push('# line kinds');
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) out.push(`kind\t${k}\t${n}`);
  out.push('# key path / type / count');
  const sorted = [...rows].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, n] of sorted.slice(0, MAX_ROWS)) out.push(`${k}\t${n}`);
  if (sorted.length > MAX_ROWS) out.push(`(+${sorted.length - MAX_ROWS} more rows)`);
  return out;
}

// ---- checks --------------------------------------------------------------

const fmt = (pairs) => pairs.map(([k, n]) => `${k}\t${n}`);

async function checkDepth2(files) {
  const { main, sub, meta } = ccFiles(files);
  const depth = { '0': 0, '1': 0, '2': 0, '3+': 0, missing: 0 };
  for (const f of meta) {
    const d = readJson(f)?.spawnDepth;
    if (typeof d !== 'number') depth.missing++;
    else depth[d >= 3 ? '3+' : String(Math.max(0, Math.floor(d)))]++;
  }
  const subToolUseIds = new Set();
  let subWithAgent = 0;
  let agentUsesInSub = 0;
  for (const f of sub) {
    let has = false;
    for await (const o of readLines(f)) {
      const c = o?.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b?.type === 'tool_use' && b.name === 'Agent') {
          has = true;
          agentUsesInSub++;
          if (typeof b.id === 'string') subToolUseIds.add(b.id);
        }
      }
    }
    if (has) subWithAgent++;
  }
  let metaLinkedToSubAgentUse = 0;
  for (const f of meta) {
    const id = readJson(f)?.toolUseId;
    if (typeof id === 'string' && subToolUseIds.has(id)) metaLinkedToSubAgentUse++;
  }
  const nested = sub.filter((f) => f.split(sep).filter((s) => s === 'subagents').length > 1).length;
  return fmt([
    ['main-files', main.length],
    ['subagent-files', sub.length],
    ['meta-files', meta.length],
    ['meta.spawnDepth=0', depth['0']],
    ['meta.spawnDepth=1', depth['1']],
    ['meta.spawnDepth=2', depth['2']],
    ['meta.spawnDepth>=3', depth['3+']],
    ['meta.spawnDepth-missing', depth.missing],
    ['subagent-files-with-Agent-tool_use', subWithAgent],
    ['Agent-tool_use-lines-in-subagent-files', agentUsesInSub],
    ['meta-linked-to-Agent-use-inside-subagent', metaLinkedToSubAgentUse],
    ['subagent-files-under-nested-subagents-dir', nested],
  ]);
}

async function checkTeammateKeys(files) {
  const { main, sub } = ccFiles(files);
  let spawned = 0;
  const resultKeys = new Map();
  const ids = new Set();
  const teams = new Set();
  const agentNames = new Set();
  const teamNames = new Set();
  const lineKeyCounts = new Map();
  for (const f of main.concat(sub)) {
    for await (const o of readLines(f)) {
      if (!o || typeof o !== 'object') continue;
      const r = o.toolUseResult;
      if (r && typeof r === 'object' && r.status === 'teammate_spawned') {
        spawned++;
        for (const k of Object.keys(r)) resultKeys.set(safeKey(k), (resultKeys.get(safeKey(k)) || 0) + 1);
        if (typeof r.teammate_id === 'string') ids.add(r.teammate_id);
        if (typeof r.team_name === 'string') teams.add(r.team_name);
      }
      if (typeof o.agentName === 'string') agentNames.add(o.agentName);
      if (typeof o.teamName === 'string') teamNames.add(o.teamName);
      for (const k of ['agentName', 'teamName', 'teammate_id', 'team_name']) {
        if (k in o) lineKeyCounts.set(k, (lineKeyCounts.get(k) || 0) + 1);
      }
    }
  }
  const idMatchesAgentName = [...ids].filter((i) => agentNames.has(i) || [...agentNames].some((a) => i.startsWith(`${a}@`))).length;
  const teamMatches = [...teams].filter((t) => teamNames.has(t)).length;
  return [
    ...fmt([
      ['teammate_spawned-results', spawned],
      ['distinct-teammate_id', ids.size],
      ['distinct-team_name', teams.size],
      ['teammate_id-matching-other-line-agentName', idMatchesAgentName],
      ['team_name-matching-other-line-teamName', teamMatches],
    ]),
    ...[...resultKeys].sort().map(([k, n]) => `toolUseResult-key\t${k}\t${n}`),
    ...[...lineKeyCounts].sort().map(([k, n]) => `top-level-key-on-lines\t${k}\t${n}`),
  ];
}

async function checkCodexItemId(files) {
  let completed = 0;
  let withId = 0;
  let equalsCallId = 0;
  let notEqual = 0;
  let withCallIdField = 0;
  let filesWithItemCompleted = 0;
  for (const f of codexFiles(files)) {
    const callIds = new Set();
    const itemIds = [];
    let seen = false;
    for await (const o of readLines(f)) {
      const p = o?.payload;
      if (o?.type === 'response_item' && typeof p?.call_id === 'string') callIds.add(p.call_id);
      if (o?.type === 'event_msg' && p?.type === 'item_completed') {
        completed++;
        seen = true;
        const it = p.item;
        if (it && typeof it === 'object') {
          if ('call_id' in it) withCallIdField++;
          if (typeof it.id === 'string') {
            withId++;
            itemIds.push(it.id);
          }
        }
      }
    }
    if (seen) filesWithItemCompleted++;
    for (const id of itemIds) (callIds.has(id) ? equalsCallId++ : notEqual++);
  }
  return fmt([
    ['files-with-item_completed', filesWithItemCompleted],
    ['item_completed-lines', completed],
    ['item.id-present', withId],
    ['item.id-equals-a-call_id-in-file', equalsCallId],
    ['item.id-not-equal-any-call_id', notEqual],
    ['item-has-call_id-field', withCallIdField],
  ]);
}

async function checkCodexCached(files) {
  let total = 0;
  let missing = 0;
  let inputGeCached = 0;
  let cachedGtInput = 0;
  let cachedZero = 0;
  for (const f of codexFiles(files)) {
    for await (const o of readLines(f)) {
      if (o?.type !== 'event_msg' || o.payload?.type !== 'token_count') continue;
      const u = o.payload.info?.last_token_usage;
      if (!u) continue;
      total++;
      const { input_tokens: i, cached_input_tokens: c } = u;
      if (typeof i !== 'number' || typeof c !== 'number') {
        missing++;
        continue;
      }
      if (c === 0) cachedZero++;
      if (i >= c) inputGeCached++;
      else cachedGtInput++;
    }
  }
  return fmt([
    ['token_count-with-last_token_usage', total],
    ['input-or-cached-missing', missing],
    ['input>=cached', inputGeCached],
    ['cached>input', cachedGtInput],
    ['cached=0', cachedZero],
  ]);
}

async function checkCodexInfoNull(files) {
  let total = 0;
  let infoNull = 0;
  let infoMissing = 0;
  let filesWithNull = 0;
  let filesWithToken = 0;
  for (const f of codexFiles(files)) {
    let n = 0;
    let t = 0;
    for await (const o of readLines(f)) {
      if (o?.type !== 'event_msg' || o.payload?.type !== 'token_count') continue;
      total++;
      t++;
      if (!('info' in o.payload)) infoMissing++;
      else if (o.payload.info === null) {
        infoNull++;
        n++;
      }
    }
    if (t) filesWithToken++;
    if (n) filesWithNull++;
  }
  return fmt([
    ['files-with-token_count', filesWithToken],
    ['files-with-info-null', filesWithNull],
    ['token_count-lines', total],
    ['info=null', infoNull],
    ['info-key-absent', infoMissing],
  ]);
}

async function checkCodexSpawnPairing(files) {
  const rollouts = codexFiles(files);
  const byThread = new Map();
  for (const f of rollouts) {
    const id = threadIdOf(f);
    if (id) byThread.set(id, f);
  }
  const children = [];
  for (const f of rollouts) {
    for await (const o of readLines(f)) {
      if (o?.type !== 'session_meta') break;
      const p = o.payload || {};
      const parent = p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id;
      if (typeof parent === 'string') children.push({ parent, ts: Date.parse(p.timestamp ?? o.timestamp) });
      break;
    }
  }
  const parentSpawns = new Map();
  let subAgentActivity = 0;
  const loadParent = async (id) => {
    if (parentSpawns.has(id)) return parentSpawns.get(id);
    const f = byThread.get(id);
    const times = [];
    if (f) {
      for await (const o of readLines(f)) {
        const p = o?.payload;
        if (o?.type === 'response_item' && p?.type === 'function_call' && p.name === 'spawn_agent') {
          times.push(Date.parse(o.timestamp));
        }
        if (o?.type === 'event_msg' && p?.type === 'item_completed' && p.item?.type === 'SubAgentActivity') subAgentActivity++;
      }
    }
    const r = f ? times.filter(Number.isFinite).sort((a, b) => a - b) : null;
    parentSpawns.set(id, r);
    return r;
  };
  const bins = [['<1s', 1000], ['1-5s', 5000], ['5-30s', 30000], ['30s-5m', 300000], ['>=5m', Infinity]];
  const hist = Object.fromEntries(bins.map(([n]) => [n, 0]));
  let noParentFile = 0;
  let noPrecedingSpawn = 0;
  let ambiguous = 0;
  for (const c of children) {
    const spawns = await loadParent(c.parent);
    if (!spawns) {
      noParentFile++;
      continue;
    }
    const before = spawns.filter((t) => t <= c.ts);
    if (!before.length || !Number.isFinite(c.ts)) {
      noPrecedingSpawn++;
      continue;
    }
    const near = before[before.length - 1];
    const diff = c.ts - near;
    hist[bins.find(([, lim]) => diff < lim)[0]]++;
    if (before.filter((t) => near - t < 2000).length > 1) ambiguous++;
  }
  return fmt([
    ['rollout-files', rollouts.length],
    ['child-rollouts', children.length],
    ['child-without-parent-file', noParentFile],
    ['child-without-preceding-spawn_agent', noPrecedingSpawn],
    ...bins.map(([n]) => [`gap-nearest-spawn_agent-to-child-start ${n}`, hist[n]]),
    ['children-with-another-spawn_agent-within-2s', ambiguous],
    ['SubAgentActivity-items-in-parents', subAgentActivity],
  ]);
}

async function checkCcFileRotation(files) {
  const { main, sub } = ccFiles(files);
  const sessionFiles = new Map();
  let withCompact = 0;
  let compactThenSessionChange = 0;
  let filesWithMultipleSessionIds = 0;
  for (const f of main) {
    let first = null;
    let compact = false;
    let changed = false;
    const ids = new Set();
    for await (const o of readLines(f)) {
      if (typeof o?.sessionId === 'string') {
        ids.add(o.sessionId);
        if (first === null) first = o.sessionId;
        else if (compact && o.sessionId !== first) changed = true;
      }
      if (o?.type === 'system' && o.subtype === 'compact_boundary') compact = true;
    }
    if (compact) withCompact++;
    if (changed) compactThenSessionChange++;
    if (ids.size > 1) filesWithMultipleSessionIds++;
    for (const id of ids) sessionFiles.set(id, (sessionFiles.get(id) || 0) + 1);
  }
  const shared = [...sessionFiles.values()].filter((n) => n > 1).length;
  return fmt([
    ['main-files', main.length],
    ['subagent-files', sub.length],
    ['main-files-with-compact_boundary', withCompact],
    ['compact_boundary-then-sessionId-changes-in-same-file', compactThenSessionChange],
    ['files-with-more-than-one-sessionId', filesWithMultipleSessionIds],
    ['sessionIds-appearing-in-more-than-one-main-file', shared],
  ]);
}

const CHECK_FNS = {
  depth2: [checkDepth2, 'cc'],
  'teammate-keys': [checkTeammateKeys, 'cc'],
  'codex-item-id': [checkCodexItemId, 'codex'],
  'codex-cached': [checkCodexCached, 'codex'],
  'codex-spawn-pairing': [checkCodexSpawnPairing, 'codex'],
  'codex-info-null': [checkCodexInfoNull, 'codex'],
  'cc-file-rotation': [checkCcFileRotation, 'cc'],
};

// ---- entry ---------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { root: null, source: null, check: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') opts.source = argv[++i];
    else if (a === '--check') opts.check = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('--') && opts.root === null) opts.root = a;
    else return { error: 'Unknown argument.' };
  }
  if (opts.help) return opts;
  if (!opts.root) return { error: 'Missing <root>.' };
  if (opts.source && !['cc', 'codex'].includes(opts.source)) return { error: 'Bad --source (cc|codex).' };
  if (opts.check && !CHECKS.includes(opts.check)) return { error: 'Unknown check.' };
  return opts;
}

export async function scan(root, { source = null, check = null } = {}) {
  const files = walk(root);
  if (check) {
    const [fn, need] = CHECK_FNS[check];
    if (source && source !== need) return [`check\t${check}`, `skipped\tneeds --source ${need}`];
    return [`check\t${check}`, ...(await fn(files))];
  }
  return shapeScan(files, source || detectSource(files));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (opts.error) {
    console.error(`${opts.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  try {
    statSync(opts.root);
  } catch {
    console.error('Root not readable.');
    process.exitCode = 1;
    return;
  }
  console.log((await scan(opts.root, opts)).join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error('Scan failed.');
    process.exitCode = 1;
  });
}
