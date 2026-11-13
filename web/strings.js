// Every user-visible string in the web UI lives here (English only).
export const S = {
  appName: 'Run Inspector',
  theme: { toggle: 'Switch light / dark', toDark: 'Switch to dark theme', toLight: 'Switch to light theme' },
  live: { connected: 'Live · 127.0.0.1', connecting: 'Connecting…', reconnecting: 'Reconnecting…', retry: 'Reconnect' },
  list: {
    heading: 'Sessions',
    loading: 'Loading sessions…',
    loadFailed: 'Could not load sessions.',
    none: 'No sessions to show yet.',
    untitled: 'Untitled session',
    agents: (n) => `${n} ${n === 1 ? 'agent' : 'agents'}`,
  },
  run: {
    back: '← Sessions',
    choose: 'Choose a session on the left.',
    loading: 'Loading session…',
    loadFailed: 'Could not load this session.',
    notFound: 'This session is no longer available.',
  },
  source: { 'claude-code': 'Claude Code', codex: 'Codex CLI' },
  sourceBadge: { 'claude-code': 'CC', codex: 'CX' },
  sourceTip: (name) => `Tool: ${name}`,
  status: { running: 'Running', ok: 'Done', error: 'Failed', cancelled: 'Cancelled', unknown: 'Unknown' },
};
