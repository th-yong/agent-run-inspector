# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/th-yong/agent-run-inspector/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/th-yong/agent-run-inspector/releases/tag/v0.1.0
