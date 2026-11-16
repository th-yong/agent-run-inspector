// Menu bar (SwiftBar) plugin: `ari menubar` prints the menu in SwiftBar's text format, read from the
// running service's API. `ari menubar install` writes a small plugin script into SwiftBar's folder.
// The menu holds titles, project names, status, age and cost only; links never carry the token.
import { rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fmtDuration, fmtUsd } from '../web/format.js';

export const PLUGIN_NAME = 'agent-run-inspector.30s.sh';
const ICON = 'point.3.connected.trianglepath.dotted';
const RECENT = 5;
const STATE = {
  running: 'sfimage=circle.fill sfcolor=#4c6ef5',
  error: 'sfimage=exclamationmark.triangle.fill sfcolor=#e8590c',
  cancelled: 'sfimage=xmark.circle',
};

// SwiftBar splits a line at "|", and quotes parameter values with "
const text = (s, max = 48) => {
  const t = String(s ?? '').replace(/[|\n\r]/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const ago = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};
const q = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

/**
 * @param {object[]} sessions newest first, as /api/sessions returns them
 * @param {{ base: string, now: number, node: string, cli: string }} o
 */
export function renderMenu(sessions, { base, now, node, cli }) {
  const running = sessions.filter((s) => s.status === 'running');
  const last = (s) => s.end ?? s.lastWrite ?? 0;
  const recent = sessions.filter((s) => s.status !== 'running').sort((a, b) => last(b) - last(a)).slice(0, RECENT);
  const line = (s) => {
    const age = s.status === 'running' ? fmtDuration(now - s.start) : ago(now - last(s));
    const usd = typeof s.totals?.usd === 'number' && s.totals.usd > 0 ? ` · ${fmtUsd(s.totals.usd)}` : '';
    const name = s.title ? `${text(s.title, 40)} · ${text(s.project, 24)}` : text(s.project || s.id, 40);
    const icon = STATE[s.status] ?? 'sfimage=checkmark.circle';
    return `${name}  ${age}${usd} | href=${q(`${base}?s=${encodeURIComponent(s.id)}`)} ${icon}`;
  };
  return [
    `${running.length || ''} | sfimage=${ICON}`,
    '---',
    ...(running.length ? [`Running (${running.length}) | size=11`, ...running.map(line)] : ['Nothing running | size=11']),
    ...(recent.length ? ['---', 'Recent | size=11', ...recent.map(line)] : []),
    '---',
    `Open Inspector | href=${q(base)} sfimage=macwindow`,
    `Sign in again | bash=${q(node)} param1=${q(cli)} param2=open terminal=false sfimage=key`,
    'Refresh | refresh=true sfimage=arrow.clockwise',
  ].join('\n');
}

/** What the menu shows when the service is missing or not answering. */
export function renderProblem(message) {
  return [`⚠︎ | sfimage=${ICON}`, '---', `${text(message, 80)} | size=12`, 'Refresh | refresh=true'].join('\n');
}

/** Sessions from the running service; throws when it does not answer. */
export async function fetchSessions(svc, fetchImpl = fetch) {
  const res = await fetchImpl(`http://127.0.0.1:${svc.port}/api/sessions`, {
    headers: { cookie: `ari_${svc.port}=${svc.token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).sessions ?? [];
}

export function pluginScript({ node, cli }) {
  return `#!/bin/sh
# <xbar.title>Agent Run Inspector</xbar.title>
# <xbar.desc>Running Claude Code and Codex runs, from the agent-run-inspector service.</xbar.desc>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
# Written by "ari menubar install"; run it again after moving Node or the package.
exec ${q(node)} ${q(cli)} menubar
`;
}

export function installPlugin(dir, { node, cli }) {
  const file = join(dir, PLUGIN_NAME);
  writeFileSync(file, pluginScript({ node, cli }));
  chmodSync(file, 0o755);
  return file;
}

export function uninstallPlugin(dir) {
  rmSync(join(dir, PLUGIN_NAME), { force: true });
}
