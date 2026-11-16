export const HELP = `Usage: ari [options]
       ari roots <list|add|remove> [--codex] [dir]
       ari service <install|uninstall> [--port <n>]
       ari open

Local, read-only inspector for Claude Code and Codex CLI agent runs.

Options:
  --port <n>            Port to listen on (default: random free port)
  --open[=<where>]      Open the address: auto (default; Orca tab inside Orca,
                        else default browser), orca, browser or none
  --no-open             Only print the address (same as --open=none)
  --root <dir>          Extra Claude Code projects folder (repeatable)
  --codex-root <dir>    Extra Codex sessions folder (repeatable)
  --source <name>       claude | codex | all (default: all)
  --since <age>         Only runs newer than this, e.g. 24h, 7d, 30d
  --redact[=strict]     Hide message bodies (strict: hide more)
  --prices <file>       Price table that overrides the built-in one
  --session <id>        Open this session directly
  --no-update-check     Do not check npm for a newer version (once a day)
  -v, --version         Print the version
  -h, --help            Show this help

Commands:
  roots list            Show the log folders in use
  roots add <dir>       Remember a Claude Code folder (--codex for Codex)
  roots remove <dir>    Forget a remembered folder
  service install       macOS: keep the inspector running from login on a fixed
                        port (default 7317) with a lasting sign-in, and build
                        Agent Run Inspector.app (Dock, menu bar item, opens at
                        login); run again after an upgrade to restart it
  service uninstall     Stop it and remove it (and the app and its Dock icon)
  --no-dock             With service install: do not add the app to the Dock
  open                  Open the running service in the browser (signs in again)
`;

export const MSG = {
  unknownOption: (m) => `Error: ${m}`,
  badValue: (flag, hint) => `Error: invalid value for ${flag} (${hint})`,
  conflictOpen: 'Error: --open and --no-open cannot be used together',
  updateAvailable: (cur, next) => `Update available: ${cur} -> ${next}. Run "npm i -g agent-run-inspector" or use "npx agent-run-inspector@latest".`,
  untitledSession: 'Untitled session',
  toolFailed: 'Tool call failed',
  agentFailed: 'Agent call failed',
  mainAgent: 'Main agent',
  badPrices: (m) => `Error: ${m}`,
  unknownCommand: (c) => `Error: unknown command "${c}"`,
  appBuilt: (p) => `App: ${p} (Dock, Launchpad, Spotlight; its menu bar item shows running runs)`,
  appFailed: 'Could not build the app; open the address in Chrome or Edge and choose Install instead.',
  dockAdded: 'Added to the Dock (skip with --no-dock).',
  dockRemoved: 'Removed from the Dock.',
  serviceUsage: 'Usage: ari service <install|uninstall> [--port <n>]',
  serviceNone: 'No service is installed. Run "ari service install" first.',
  serviceRemoved: 'Service stopped and removed.',
  serviceFailed: (m) => `Error: launchctl failed: ${m}`,
  serviceInstalled: (url, log) => `Service running at ${url} (starts at login). Log: ${log}\nOpen it any time with "ari open".`,
  serviceStarted: (url) => `Service listening on ${url}`,
  rootsUsage: 'Usage: ari roots <list|add|remove> [--codex] [dir]',
  rootsNeedDir: 'Error: a folder is required',
  notADirectory: (p) => `Error: not a directory: ${p}`,
  rootAdded: (p) => `Added: ${p}`,
  rootExists: (p) => `Already listed: ${p}`,
  rootRemoved: (p) => `Removed: ${p}`,
  rootNotFound: (p) => `Not in the list: ${p}`,
  rootsNone: 'No log folders found. Add one with: ari roots add <dir>',
  rootLine: (kind, p, how) => `${kind.padEnd(7)} ${p}  (${how})`,
  badConfig: (p) => `Error: cannot read config file ${p}`,
  noRoots: 'No run logs found. Pass --root <dir>, or run: ari roots add <dir>',
  unknownFormat: 'Unknown format',
  codexSession: 'Codex session',
  hidden: '(hidden)',
  charsHidden: (n) => `(${n.toLocaleString('en-US')} chars hidden)`,
  noWebUi: 'The web UI is not part of this build. The JSON API is available under /api/.',
  portInUse: (p) => `Error: port ${p} is already in use. Try another with --port, or omit it to pick a free one.`,
  portDenied: (p) => `Error: no permission to listen on port ${p}. Try another with --port.`
};
