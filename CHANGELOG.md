# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-16

Agent-team teammates inside their run, brand logos that follow their owners' guidelines, and a public repository under the MIT License.

### Fixed
- Claude Code agent-team teammates (logged as their own session files) are now joined to the run that started them, also from a worktree folder below the lead's: their calls, cost and live status show in the lead's graph instead of an "Another session" node, and they are no longer listed as separate untitled sessions. A run with teammates totals cost from its calls, since Claude Code's own session total leaves teammates out.
- The same teammate spawned twice no longer produces two nodes with the same id.

### Changed
- Brand logos keep their owners' colors (no shifting for contrast; black logos use the theme text color). Logos whose owners' guidelines do not allow this use (OpenAI, Google, Figma, Slack, Python, Docker, PostgreSQL, Linear, Vercel, Atlassian) are replaced by the neutral category symbol.
- The code is now under the MIT License. Brand names and logos are not covered; see `THIRD_PARTY_NOTICES.md` for credits, trademark notices and the guideline review.
- README: a "What you see" section, a correct description of how cost is chosen, current limits, and a new demo GIF recorded from the app with synthetic data.
- The repository is public: `npx github:th-yong/agent-run-inspector` works without a GitHub login, and the clone address in the README is HTTPS.
- CI can also be started by hand (`workflow_dispatch`).

### Verified
End-to-end check on one machine (688 sessions: 143 Claude Code, 545 Codex; 101,531 spans), with the teammate files (265 at the time) folded into their 7 lead runs:
- First session list 2.6 s through a freshly started server (cached list 57 ms). In one process with a warm disk cache the first list takes 0.5 s, the same range as v0.3.0's code on the same logs (0.3 to 0.6 s). Finding teammates reads 13 lead files (357 MB) once, in about 0.26 s.
- Opening every session: 0 failures; median 1 ms, 95th percentile 171 ms, slowest 3.8 s.
- Per-session totals equal the sum of their spans in all 688 sessions.
- Claude Code sub-agents: 518 of 518 files with metadata attached to their parent call (100%).
- Codex sub-agents: 9 of 553 links inferred by time (1.6%).
- Live updates: 52 session-list events in 60 s, first after 0.9 s.
- Peak server memory (RSS) 3.7 GB while opening all 688 sessions in a row (v0.3.0: 2.2 GB), since runs with teammates now load the teammates' files too.

## [0.3.0] - 2026-11-13

Open in Orca, packaging and an end-to-end check against real run records.

### Added
- `--open` opens the address as a new Orca browser tab inside Orca and in the default browser elsewhere; `--no-open` only prints it.
- English and Korean README.
- `scripts/e2e-check.js`: starts the server with `--redact=strict` against this machine's records and prints counts, times and pass/fail only.

### Fixed
- A Codex rollout file with no parsable line (empty or only a cut line) made opening that session fail with a 500.

### Verified
End-to-end check on one machine (942 sessions: 397 Claude Code, 545 Codex; 99,496 spans):
- First session list 447 ms (cached list 72 ms).
- Opening every session: 0 failures; median 2 ms, 95th percentile 104 ms, slowest 2.9 s.
- Per-session totals equal the sum of their spans in all 942 sessions.
- Claude Code sub-agents: 514 of 514 files with metadata attached to their parent call (100%).
- Codex sub-agents: 9 of 553 links inferred by time (1.6%).
- Live updates on a session being written: 31 events in 75 s, first after 11 s.
- Peak server memory (RSS) 2.2 GB while opening all 942 sessions in a row; the live heap after collection was 7 MB, so it is freed memory not yet returned, not a leak.

## [0.2.0] - 2026-11-13

The web UI. Open the printed address to browse sessions, an agent graph, a timeline and call details.

### Added
- Web UI served by the same local server: session list with filters and search, run header with totals, Graph and Timeline views, call details with source file and line, light and dark themes, and a narrow-screen layout down to 390px.
- Agent graph with live motion, a detail column and a "Hide finished agents" switch; on narrow screens it becomes a vertical list.
- Timeline with grouped calls, a time ruler and inline call details.
- Live updates over server-sent events, with a connection indicator and a "new calls" counter that holds the view while you read.
- Redact toggle in the top bar (off, on, strict). The server decides what is hidden and the screen can never go below the level the server started with.
- A clear notice when the tab belongs to an earlier run of the server ("Server restarted").

### Fixed
- Graph motion rules were nested in a narrow-screen media query, so folded cards were clipped on wide screens.

### Changed
- The call detail column stacks under the graph when the run column is narrower than 980px, so cards keep room.

### Notes
- `--open` still only prints the address; opening a browser tab comes in 0.3.0.

## [0.1.0] - 2026-11-13

First release: the local server and live JSON API. The web UI follows in 0.2.0.

### Added
- `ari` starts a local server on 127.0.0.1 and prints one address with an access token. `--port`, `--root`, `--codex-root`, `--source`, `--since`, `--redact[=strict]`, `--prices` and `--session` are supported; `ari roots list|add|remove` manages log folders.
- Claude Code and Codex CLI adapters, including sub-agents, with a session index and per-span detail.
- Cost estimates from a built-in price table (overridable by config or `--prices`).
- Redaction modes (basic, strict) applied to every API and stream response.
- Live updates over server-sent events for the session list and each session, with resume and resync.
- Clean shutdown on Ctrl+C and SIGTERM; clear message when the port is taken.
- Package scaffold, `--version` flag, lint script and CI.

### Notes
- `--open` is accepted but the browser is not opened yet; open the printed address yourself.
- Without a built web UI, `/` shows a short text note and the API stays available under `/api/`.

[Unreleased]: https://github.com/th-yong/agent-run-inspector/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/th-yong/agent-run-inspector/releases/tag/v0.1.0
