#!/usr/bin/env node
// End-to-end check against this machine's real run records. Prints counts, times and pass/fail only.
// Never prints, logs or stores any record content, title, project name or path.
//   node scripts/e2e-check.js [--live-seconds 60] [--root <dir>]... [--codex-root <dir>]...
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveRoots } from '../src/roots.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { values: opt } = parseArgs({
  options: { 'live-seconds': { type: 'string', default: '60' }, root: { type: 'string', multiple: true }, 'codex-root': { type: 'string', multiple: true } },
});
const liveMs = Number(opt['live-seconds']) * 1000;
const out = (k, v) => console.log(`${k}=${v}`);
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

// -- roots (counts only) --
const roots = resolveRoots({ env: process.env, config: { claudeRoots: [], codexRoots: [] }, flags: { root: opt.root, codexRoot: opt['codex-root'] } });
const home = process.env.HOME;
const claudeDirs = new Set(roots.claude.map((r) => r.path));
if (home) { try { readdirSync(join(home, '.claude', 'projects')); claudeDirs.add(join(home, '.claude', 'projects')); } catch { /* none */ } }
out('claude_roots', claudeDirs.size);
out('codex_roots', roots.codex.length);

// -- disk side of the sub-agent check: meta files with a toolUseId --
function* walk(dir) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const metaToolUse = new Set();
let metaFiles = 0;
for (const d of claudeDirs) {
  for (const f of walk(d)) {
    if (!f.endsWith('.meta.json') || !f.includes('/subagents/')) continue;
    metaFiles++;
    try {
      const m = JSON.parse(readFileSync(f, 'utf8'));
      if (typeof m.toolUseId === 'string' && m.toolUseId) metaToolUse.add(m.toolUseId);
    } catch { /* unreadable meta counts as not linkable */ }
  }
}
out('subagent_meta_files', metaFiles);
out('subagent_meta_with_tool_use', metaToolUse.size);

// -- server --
const args = [cli, '--redact=strict', '--no-open', '--port', '0'];
for (const d of claudeDirs) args.push('--root', d);
const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
let rssMax = 0;
const sampleRss = () => {
  try { rssMax = Math.max(rssMax, Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)]).toString().trim()) || 0); } catch { /* gone */ }
};
const rssTimer = setInterval(sampleRss, 250);

const address = await new Promise((resolve, reject) => {
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\/\S*/); if (m) resolve(m[0]); });
  child.on('exit', () => reject(new Error('server exited')));
  setTimeout(() => reject(new Error('server start timeout')), 60000);
});
const base = new URL(address);
const port = Number(base.port);
const token = base.searchParams.get('t');
const cookie = `ari_${port}=${token}`;
const headers = { Cookie: cookie };

async function get(path) {
  const t0 = process.hrtime.bigint();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, ms: ms(t0), json: res.status === 200 ? JSON.parse(text) : null };
}

let pass = true;
const check = (name, ok) => { out(`check_${name}`, ok ? 'pass' : 'FAIL'); if (!ok) pass = false; };
const num = (n) => (Number.isFinite(n) ? n : 0);

try {
  const first = await get('/api/sessions');
  out('first_list_ms', first.ms);
  const second = await get('/api/sessions');
  out('second_list_ms', second.ms);
  const sessions = first.json.sessions;
  const bySource = (s) => sessions.filter((x) => x.source === s).length;
  out('sessions_total', sessions.length);
  out('sessions_claude', bySource('claude-code'));
  out('sessions_codex', bySource('codex'));
  check('list_ok', first.status === 200 && sessions.length > 0);

  let openFail = 0; let sumMismatch = 0; let spanTotal = 0; let errorSpans = 0;
  const openTimes = [];
  let ccAgentSpans = 0; let ccClaimed = 0; let ccUnclaimed = 0; let ccUnknown = 0; let ccOrphanNoMeta = 0;
  const claimedToolUse = new Set();
  let cxAgents = 0; let cxApprox = 0;
  for (const s of sessions) {
    let r;
    try { r = await get(`/api/sessions/${encodeURIComponent(s.id)}`); } catch { r = { status: 0 }; }
    if (r.status !== 200) { openFail++; out('open_fail_detail', `source=${s.source} status=${r.status}`); continue; }
    openTimes.push(r.ms);
    const { spans, totals } = r.json;
    spanTotal += spans.length;
    const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, modelCalls: 0, toolCalls: 0, errors: 0, agents: 0 };
    const kids = new Map();
    for (const sp of spans) {
      if (sp.kind === 'llm') {
        sum.modelCalls++;
        if (sp.end !== null && sp.tokens) {
          sum.input += num(sp.tokens.input); sum.output += num(sp.tokens.output);
          sum.cacheRead += num(sp.tokens.cacheRead); sum.cacheWrite += num(sp.tokens.cacheWrite);
        }
      } else if (sp.kind === 'tool') sum.toolCalls++;
      else if (sp.kind === 'agent' && !sp.external) sum.agents++;
      if (sp.kind !== 'session' && sp.status === 'error') { sum.errors++; errorSpans++; }
      if (sp.parentId) { if (!kids.has(sp.parentId)) kids.set(sp.parentId, []); kids.get(sp.parentId).push(sp); }
    }
    const t = totals?.total;
    if (!t || Object.keys(sum).some((k) => num(t[k]) !== sum[k])) sumMismatch++;
    if (s.source === 'claude-code') {
      for (const sp of spans) {
        if (sp.kind !== 'agent' || sp.external) continue;
        ccAgentSpans++;
        if (sp.id.startsWith('ag:file:')) { ccOrphanNoMeta++; continue; }
        const own = (kids.get(sp.id) ?? []).filter((c) => c.ref);
        if (!own.length) { ccUnknown++; continue; }
        // A claimed span points at the parent's call line; an unclaimed one points at its own file, where its calls live.
        if (own.some((c) => c.ref.fileId === sp.ref?.fileId)) ccUnclaimed++;
        else { ccClaimed++; claimedToolUse.add(sp.id.slice(3)); }
      }
    } else {
      for (const sp of spans) {
        if (sp.kind !== 'agent' || sp.external) continue;
        cxAgents++;
        if (sp.linkApprox) cxApprox++;
      }
    }
  }
  openTimes.sort((a, b) => a - b);
  const pct = (p) => openTimes[Math.min(openTimes.length - 1, Math.floor(openTimes.length * p))] ?? 0;
  out('open_failed', openFail);
  out('open_ms_median', pct(0.5));
  out('open_ms_p95', pct(0.95));
  out('open_ms_max', openTimes[openTimes.length - 1] ?? 0);
  out('spans_total', spanTotal);
  out('error_spans', errorSpans);
  out('totals_mismatch_sessions', sumMismatch);
  check('open_all', openFail === 0);
  check('totals_match_spans', sumMismatch === 0);

  const linked = [...metaToolUse].filter((id) => claimedToolUse.has(id)).length;
  out('cc_agent_spans', ccAgentSpans);
  out('cc_claimed_by_parent', ccClaimed);
  out('cc_unclaimed', ccUnclaimed);
  out('cc_no_children_unclassified', ccUnknown);
  out('cc_file_orphans_without_tool_use', ccOrphanNoMeta);
  out('cc_meta_linked_to_parent', linked);
  out('cc_meta_linked_pct', metaToolUse.size ? Math.round((1000 * linked) / metaToolUse.size) / 10 : 'n/a');
  out('codex_sub_agents', cxAgents);
  out('codex_inferred_links', cxApprox);
  out('codex_inferred_pct', cxAgents ? Math.round((1000 * cxApprox) / cxAgents) / 10 : 'n/a');

  // -- live: most recently written session; count SSE events within the window --
  const active = [...sessions].sort((a, b) => b.lastWrite - a.lastWrite)[0];
  out('active_age_s', Math.round((Date.now() - active.lastWrite) / 1000));
  // Count the data events of one stream for the whole window.
  const listen = (path) => new Promise((resolve) => {
    let n = 0; let firstMs = null; const t0 = process.hrtime.bigint();
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.on('data', (d) => {
        const c = (String(d).match(/^data:/gm) ?? []).length;
        if (c && firstMs === null) firstMs = ms(t0);
        n += c;
      });
    });
    req.on('error', () => resolve({ n, firstMs }));
    setTimeout(() => { req.destroy(); resolve({ n, firstMs }); }, liveMs);
  });
  const [one, all] = await Promise.all([listen(`/api/sessions/${encodeURIComponent(active.id)}/stream`), listen('/api/sessions/stream')]);
  out('live_window_s', liveMs / 1000);
  out('live_session_events', one.n);
  out('live_session_first_event_ms', one.firstMs ?? 'none');
  out('live_list_events', all.n);
  out('live_list_first_event_ms', all.firstMs ?? 'none');
  check('live_events', one.n + all.n > 0);
} catch (e) {
  out('error', e?.code ?? e?.name ?? 'unknown');
  pass = false;
} finally {
  sampleRss();
  clearInterval(rssTimer);
  out('rss_max_mb', Math.round(rssMax / 1024));
  child.kill('SIGTERM');
}
out('overall', pass ? 'pass' : 'FAIL');
process.exitCode = pass ? 0 : 1;
