# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Orca bots and workers. A worker started with `orca orchestration worker-start` is folded into the session that started it (an agent node with the worker's own calls, sub-agents and cost; the `--task-title` shows on the card), joined by the task id in that call's result; a session that only quotes the ids links nothing. An Orca bot's session (run from `~/.orca/bots/<name>`) shows a Bot badge in the session list (its name stands in for a missing title), and its top graph card reads "Bot · <name>" instead of Orchestrator.

## [0.9.4] - 2026-11-24

### Added

- Mac app: the "Update …" badge in the window's header now starts the update, the same as the menu bar's "Update to …" (in a browser it still only says how).
- `ari service install` ends with a line asking for a GitHub star when you run it yourself (not on the app's own updates). The README ends with one too.

## [0.9.3] - 2026-11-19

### Fixed

- Mac app: Update is offered only once npm serves the new version (a release reaches GitHub a minute or two earlier; updating in that gap failed with a 404 or reinstalled the old version). A failed install is tried twice more, 30 seconds apart. "Check for Updates…" in that gap says the version is almost ready.

## [0.9.2] - 2026-11-19

### Fixed

- A session that only ran a local slash command (`/clear`, `/usage`, `/model`, ...) no longer shows as Running ("Thinking…") for 10 minutes. A `/clear` starts a new file holding just the command records.

## [0.9.1] - 2026-11-19

### Added

- Prices for OpenAI GPT-6.2 Astra (`gpt-6.2-astra`) and GPT-6.2 Sol (`gpt-6.2-sol`), including their long-context rates above 272K input tokens.

## [0.9.0] - 2026-11-19

### Added

- Claude Code runs whose turn ended while a background task is still open (a `run_in_background` Bash command, a Monitor, a background agent) stay running and are labelled **Background** (purple, next to orange Running) in the list, the run header and the menu bar panel. They used to show as done until the agent resumed. The menu bar count includes them.

### Fixed

- Opening an agent's panel in the graph no longer makes the page scroll: the panel fits the space under the run header.

## [0.8.2] - 2026-11-19

### Changed

- On npm now: install with `npm i -g agent-run-inspector` or try `npx agent-run-inspector`. The Mac app's Update, the update notices and the README use the npm package instead of `github:th-yong/agent-run-inspector`.

## [0.8.1] - 2026-11-18

Not on npm yet; install from GitHub.

### Fixed

- Update (Mac app) and the install commands get the newest release tag (`#semver:*`), not whatever is on main yet.

### Docs

- SECURITY.md: how to report a vulnerability (privately, through GitHub).
- README Security: the update checks now go to GitHub releases (CLI daily, Mac app every 6 hours), and updates install only when you press Update.
- README demo shows the 0.8.0 screen.

## [0.8.0] - 2026-11-17

The Mac app updates itself. Not on npm yet; install from GitHub. Apps from 0.7.0 or earlier need one manual update (`npm i -g github:th-yong/agent-run-inspector && ari service install`); after that, updates come from the menu bar.

### Added
- The Mac app updates itself: "Check for Updates…" in the menu bar item's right-click menu ("Update to …" when a newer release is out) and an "Update to …" button at the bottom of the panel. It asks first, then runs `npm i -g github:th-yong/agent-run-inspector` and `ari service install` in a login shell and reopens; on failure it shows the commands and the log (`~/Library/Logs/agent-run-inspector-update.log`).

### Changed
- The update check asks GitHub for the latest release instead of npm, so it works before the first npm release. The app checks every 6 hours.

### Fixed
- A right click on the menu bar item opened the panel instead of the menu.
- `ari service install` stops a running app that ignores Quit before rebuilding it, so the new code runs.

## [0.7.0] - 2026-11-17

Prices for OpenAI's newest models, the detail panel in smaller windows, and no more Redact toggle. Not on npm yet; install from GitHub.

### Added
- Prices from OpenAI's price page (2026-11-17): gpt-6-astra, gpt-6-sol, gpt-6.1-sol, gpt-6.1-terra, gpt-6-luna, gpt-5.6-sol (promotional until 2026-11-30), gpt-5.6-terra, gpt-5.6-luna, the -pro models, gpt-6-cyber, gpt-5.6-cyber and gpt-6-rosalind, with long-context rates above 272K prompt tokens where OpenAI lists them (also for gpt-5.5 and gpt-5.4) and 30-minute cache-write rates.

### Changed
- Menu bar panel: when no tool call is running, the line says which sub-agent is working instead of the orchestrator that waits on it.
- README: a "The menu bar" section with a picture of the panel showing a tool call, waiting for you, and thinking.

### Fixed
- In a smaller window the agent detail panel dropped below the graph (run column under 980 px). It now floats beside the graph down to 640 px, and covers the graph's width below that instead of stacking.

### Removed
- The Redact toggle in the top bar and `POST /api/redact`. The inspector runs on your own machine for you; to hide message text for a screen share or recording, start it with `--redact` (or `--redact=strict`).

## [0.6.0] - 2026-11-16

Session groups, a menu bar panel of running sessions, and a fix for the app window jumping in front. Not on npm yet; install from GitHub.

### Added
- Session groups: make a group with "+ New group" above the list, then drag sessions onto it, right-click a session, or pick the group in the run header. A group chip filters the list to its sessions; right-click a chip to delete it. The menu bar panel shows running sessions by group. Groups are saved in `groups.json` next to `config.json` (`GET`/`PUT /api/groups`).
- Session list: drag the line between the list and the run to resize the list (220-640 px, remembered; double-click resets; arrow keys when focused).

### Changed
- Menu bar panel: instead of one run's graph, it lists every running session with what it is doing now (the tool and the time in it, thinking, or waiting for you), its agents, and the session's time, cost, tokens and failed calls. The panel fits its height to the list. A click on a session opens it in the window. The right-click menu no longer lists recent runs. `GET /api/live` serves this view (agent names, states and tool names only).
- Session list: Today is the default period; Running and Recent have clear section bars with counts and a gap between them; Recent folds with a click (remembered in the browser).
- Session list: the token count is left out when it is not known yet (it showed "0 tok" for runs that were never opened and had no cost record), and reads "tokens".
- Opening an agent's details no longer rewraps the graph: the panel floats over its right side, and if it would cover the chosen card the whole graph slides left as one piece (and back on close).
- README demo: an animated WebP of a made-up but realistic run, "Add rate limiting to the login API". `scripts/demo-dev-project.js` writes that run.

### Fixed
- Opening and closing the menu bar panel no longer brings the app's window in front of other apps: the panel no longer activates the app.

## [0.5.0] - 2026-11-16

A Mac app with a menu bar item, and the inspector running in the background so it opens without a terminal. Not on npm yet; install from GitHub.

### Added
- `ari service install` (macOS) sets up three things:
  - a background service that starts at login on `http://127.0.0.1:7317/` (`--port` to change), with a sign-in that lasts a year;
  - **Agent Run Inspector.app** in `~/Applications`, added to the Dock (`--no-dock` to skip): its own window, Launchpad entry and Spotlight name, signed in at every launch. It is compiled on the Mac from `src/macos/app.js` with the built-in `osacompile`, so nothing is downloaded and no compiler or developer signing is needed;
  - a login item that starts the app with only its menu bar item.
  Running it again after an upgrade restarts the service and the app on the new code. `ari service uninstall` removes all of it, and `ari open` signs a browser in again. The token stays in a file only you can read and is never in the LaunchAgent, the process arguments, the app or the log.
- Menu bar item: the number of running runs next to the app's mark. A click opens a popover with the newest running run and its live agent graph, with "Open in window" for the full view; a right click lists running and recent runs, Open and Quit. No SwiftBar or other app is needed.
- Version and updates: the page header shows the version, and an "Update" badge (with how to update) when the daily npm check finds a newer one, so app users see it without a terminal (the terminal line came in 0.4.2). The service checks again every 6 hours. The app's Info.plist carries the version. `GET /api/meta` returns `{ version, latest }`.
- Web app manifest and icons, so Chrome or Edge can also install the page as an app. The manifest and icons are the only files served without the sign-in cookie, since browsers fetch them without credentials. `scripts/build-app-icons.js` draws all icons.

### Changed
- README starts with "Get started": the Mac app in two commands, or a one-off `npx` run. The demo GIF is re-recorded.
- The page's top-left mark and the browser tab icon are the app icon (they were a gradient square and a black square).
- Narrow graph (the popover, small windows): running agents come first, and finished one-line cards share rows two at a time instead of one long column; narrow cards show only the ✓ mark.
- The "signed out" notice in the web UI also points to `ari open`.

### Fixed
- Agent-team teammates that were stopped or shut down no longer show as Running for ten minutes. A teammate is done when the lead stopped it (`TaskStop`) or heard it shut down, when it approved a shutdown request, or when the lead's shutdown request is its last message; calls it left open stop showing as running.
- Sessions listed as "Untitled session" although they have a title (shown once opened): long tool output pushed the title out of the first and last 16 KB the list reads; the list now also searches the last 256 KB. On one machine: 61 of 143 untitled before, 19 after, and those 19 have no title at all.
- "Partly unknown" cost: Claude Haiku 5.5, Claude Sonnet 5, Claude Opus 5 and Claude Fable 5 / 5.1 are in the price table (Haiku 5.5 with its second rate card above 100K prompt tokens, a new `longContext` field); `gpt-5-codex`, `gpt-5.1-codex` and `gpt-5.2-codex` too (rates supplied by the user); and Claude Code's own `<synthetic>` messages, which carry no tokens, cost $0 instead of counting as unknown.
- Reinstalling the service while it runs no longer fails with "Bootstrap failed: 5", and a running copy of the app is quit before it is rebuilt.

## [0.4.2] - 2026-11-16

Readable call bars, an update notice, and the groundwork for npm (not on npm yet; the first npm release is 0.4.3).

### Added
- Update notice: once a day the CLI asks the npm registry for the latest version number and prints one line in the terminal when a newer version exists. Nothing else is sent. Off with `--no-update-check`, `ARI_NO_UPDATE_CHECK=1`, `NO_UPDATE_NOTIFIER` or in CI.

### Changed
- Call bars in graph cards use a log scale (100 ms up to the agent's longest call), so one long call no longer shrinks every other bar to the minimum.
- Package metadata for npm (keywords, homepage, repository, author) and a release workflow that publishes to npm when a GitHub Release is created (trusted publishing, with provenance). It skips a version already on npm, and skips everything until the package's first, hand-made npm publish.

## [0.4.1] - 2026-11-16

Runs waiting for the user show as done.

### Fixed
- A run waiting for the user is no longer shown as Running for ten minutes after its last write. Claude Code: the last turn ended with the model's final answer (`end_turn`) or `turn_duration`. Codex: the last turn ended with `task_complete` or `turn_aborted`. Sub-agents or teammates that are still working keep the run Running, and a new prompt makes it Running again.

### Changed
- `LICENSE` holds only the standard MIT text, so GitHub detects it as MIT. The note that the license does not cover third-party brand names and logos is in the README and `THIRD_PARTY_NOTICES.md`.

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

[Unreleased]: https://github.com/th-yong/agent-run-inspector/compare/v0.9.4...HEAD
[0.9.4]: https://github.com/th-yong/agent-run-inspector/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/th-yong/agent-run-inspector/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/th-yong/agent-run-inspector/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/th-yong/agent-run-inspector/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/th-yong/agent-run-inspector/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/th-yong/agent-run-inspector/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/th-yong/agent-run-inspector/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/th-yong/agent-run-inspector/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/th-yong/agent-run-inspector/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/th-yong/agent-run-inspector/releases/tag/v0.1.0
