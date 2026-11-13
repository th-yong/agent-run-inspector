# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
