# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/th-yong/agent-run-inspector/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/th-yong/agent-run-inspector/releases/tag/v0.1.0
