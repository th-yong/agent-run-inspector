export const HELP = `Usage: ari [options]
       ari roots <list|add|remove> [--codex] [dir]

Local, read-only inspector for Claude Code and Codex CLI agent runs.

Options:
  --port <n>            Port to listen on (default: random free port)
  --open / --no-open    Open the browser (default) or only print the address
  --root <dir>          Extra Claude Code projects folder (repeatable)
  --codex-root <dir>    Extra Codex sessions folder (repeatable)
  --source <name>       claude | codex | all (default: all)
  --since <age>         Only runs newer than this, e.g. 24h, 7d, 30d
  --redact[=strict]     Hide message bodies (strict: hide more)
  --prices <file>       Price table that overrides the built-in one
  --session <id>        Open this session directly
  -v, --version         Print the version
  -h, --help            Show this help

Commands:
  roots list            Show the log folders in use
  roots add <dir>       Remember a Claude Code folder (--codex for Codex)
  roots remove <dir>    Forget a remembered folder
`;

export const MSG = {
  unknownOption: (m) => `Error: ${m}`,
  badValue: (flag, hint) => `Error: invalid value for ${flag} (${hint})`,
  conflictOpen: 'Error: --open and --no-open cannot be used together',
  untitledSession: 'Untitled session',
  toolFailed: 'Tool call failed',
  agentFailed: 'Agent call failed',
  mainAgent: 'Main agent',
  unknownCommand: (c) => `Error: unknown command "${c}"`,
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
  serverNotReady: 'Server is not available in this build yet.',
};
