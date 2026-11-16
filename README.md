English | [한국어](README.ko.md)

# agent-run-inspector

[![CI](https://github.com/th-yong/agent-run-inspector/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/th-yong/agent-run-inspector/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/th-yong/agent-run-inspector)](LICENSE)
[![Node](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fth-yong%2Fagent-run-inspector%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&color=339933)](package.json)

A local, read-only inspector for Claude Code and Codex CLI agent runs: see who called whom, what each call cost and where it failed, live, in your browser.

![Demo: the run "Add rate limiting to the login API" appears; the orchestrator starts a planner, then a backend developer and a test writer, then a reviewer; their calls stream in, a failed test run is opened to show its details, and the run ends with a pull request](docs/demo.webp)

## Get started

It reads the run logs Claude Code and Codex CLI already write to disk. Nothing is installed into the agents (no hooks, no proxy). You need Node 22 or newer (check with `node -v`). On a Mac without it, install it with `brew install node` ([Homebrew](https://brew.sh)) or the installer from [nodejs.org](https://nodejs.org). If `npm i -g` fails with `EACCES`, your Node came from the nodejs.org installer: use Homebrew's Node or [nvm](https://github.com/nvm-sh/nvm) rather than `sudo`.

### On a Mac: use it as an app

```sh
npm i -g github:th-yong/agent-run-inspector
ari service install
```

That's all. **Agent Run Inspector** opens in its own window and stays in your Dock, and it starts with your Mac, so you never need the terminal again. It also puts a menu bar item up that counts running runs. Details: [The Mac app](#the-mac-app).

### Anywhere: try it once

```sh
npx github:th-yong/agent-run-inspector
```

It opens the inspector in your browser and runs until you press Ctrl+C.

## What you see

- **Session list**: running sessions on top, then recent ones. Filter by tool (Claude Code, Codex CLI) and period, or search by title or project. Agent-team teammates are folded into the run that started them instead of being listed on their own.
- **Graph**: one card per agent, from the orchestrator down. Each card shows its latest calls, status, cost, time and call count. Click a card to total that agent; "Hide finished agents" keeps only the ones still working.
- **Timeline**: every agent and call on one time axis, with turns and context compactions. Open a call to see its details.
- **Totals**: time, cost, tokens, model calls, tool calls and errors for the whole run or the selected agent.
- **Live**: new lines in the logs show up within about a second, with no reload.

## Options

| Option | What it does |
|---|---|
| `--port <n>` | Port to listen on (default: random free port) |
| `--open[=<where>]` | Open the address: `auto` (default; Orca tab inside Orca, else default browser), `orca`, `browser` or `none` |
| `--no-open` | Only print the address (same as `--open=none`) |
| `--root <dir>` | Extra Claude Code projects folder (repeatable) |
| `--codex-root <dir>` | Extra Codex sessions folder (repeatable) |
| `--source <name>` | `claude`, `codex` or `all` (default: `all`) |
| `--since <age>` | Only runs newer than this, e.g. `24h`, `7d`, `30d` |
| `--redact[=strict]` | Hide message bodies (`strict`: hide more) |
| `--prices <file>` | Price table that overrides the built-in one |
| `--session <id>` | Open this session directly |
| `--no-update-check` | Do not check npm for a newer version |
| `-v, --version` | Print the version |
| `-h, --help` | Show the help |
| `ari roots list` | Show the log folders in use |
| `ari roots add <dir>` | Remember a Claude Code folder (`--codex` for Codex) |
| `ari roots remove <dir>` | Forget a remembered folder |
| `ari service install` | macOS: keep it running from login (see below) |
| `ari service uninstall` | Stop and remove the service |
| `--no-dock` | With `service install`: do not add the app to the Dock |
| `ari open` | Open the running service in the browser |

## Finding your logs

| Tool | Default folder |
|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` if set, else `~/.claude/projects` |
| Codex CLI | `$CODEX_HOME/sessions` if set, else `~/.codex/sessions` |

If your logs live elsewhere, for example in a per-profile folder of another app, add the folder once and it is remembered in `~/.config/agent-run-inspector/config.json`:

```sh
ari roots add ~/some/profile/projects
ari roots add --codex ~/some/codex/sessions
```

## Opening inside Orca

Inside Orca the address opens as a new Orca browser tab (`orca tab create`). If that fails, or outside Orca, it falls back to the default browser. `--open=none` or `--no-open` only prints the address.

## The Mac app

`ari service install` sets up three things:

- **A background service** that starts at login on `http://127.0.0.1:7317/` (`--port <n>` to change), so the inspector is always ready.
- **Agent Run Inspector.app** in `~/Applications`, added to the Dock (`--no-dock` to skip): its own window and Launchpad entry, signed in at every launch. Its **menu bar item** shows how many runs are going; a click opens a small panel with the running sessions, each with its agents and what they are doing now (click a session to open it in the window), and a right click lists the running sessions. At login the app starts with only the menu bar item, and the window opens from the menu or the Dock. It is built on your Mac with the built-in `osacompile`, so there is nothing to download and no developer signing. If that fails, open the address in Chrome or Edge and choose Install instead.
- **A sign-in that lasts a year** for that address, so a bookmark works too. If a browser tab says "Signed out", run `ari open`.

The page header shows the version, and a badge when a newer one is out. To update, install the package again and run `ari service install` again; it restarts the service and the app on the new code. `ari service uninstall` removes the service, the app, its Dock icon and its login item. The log is `~/Library/Logs/agent-run-inspector.log`.


## Security

Run logs can hold customer data and secrets, so nothing leaves your machine except what you see on screen.

- The server listens on `127.0.0.1` only.
- Each run makes a random token. The first address carries it once, then it becomes an HttpOnly, SameSite=Strict cookie and disappears from the address bar. Requests without the cookie get 401, except the web app manifest and its icons (browsers fetch them without cookies; they hold nothing about your logs). Host and Origin headers are checked.
- The service (`ari service install`) instead keeps one token in `~/.config/agent-run-inspector/service.json` (readable by you only), and its cookie lasts a year. The token is never in the LaunchAgent file, the process arguments or the log. `ari service uninstall` deletes it; installing again keeps it.
- One outside request at most: once a day the CLI asks the npm registry for the latest version number of this package and prints a line in the terminal if there is a newer one. It sends nothing about you or your logs. Turn it off with `--no-update-check` or `ARI_NO_UPDATE_CHECK=1` (also off when `CI` or `NO_UPDATE_NOTIFIER` is set). Scripts and icons ship in the package and text uses the system's own fonts: no CDN, web fonts or telemetry.
- Read-only: log files are never written or deleted. The screen never sends a file path; files are found by opaque ids and must stay inside the known log folders.

### Redaction

`--redact` (basic) hides message bodies, tool input values, tasks, commands and error text, and keeps only lengths and key names. `--redact=strict` also hides session titles, project names, branches and folder paths, for screen sharing. The server decides: the toggle in the top bar can raise the level but never go below the one the server started with.

## Cost

Costs are estimates, not bills. Each model call is priced from the built-in `prices.json` (USD per 1M tokens, with an `asOf` date of 2026-11-13 and a source URL per model: the Anthropic and OpenAI public pricing pages); a call on an unknown model shows tokens only and the total is marked partial. For a Claude Code run, the session total that Claude Code itself recorded ("Reported") replaces the sum when it is there, except when teammate sessions are part of the run, since that total leaves them out. Override or add models with `--prices <file>`, which is merged field by field over the built-in table.

## Supported scope

Claude Code (main sessions, sub-agents, agent-team teammates) and Codex CLI (rollout files from 0.40 to 0.166). Not included: controlling agents, hooks or proxies, remote access or accounts, other tools such as Cursor or Gemini CLI, full-text search, exporting, and alerts.

### Known limits

- Codex sub-agents are linked to their parent by timing, so the link is an estimate when several start at once.
- Sub-agents of sub-agents are rare in the logs we have seen and are drawn as plain cards on the next row.
- A Claude Code teammate is joined to its lead only when its log folder is the lead's own or one below it (for example a `.claude/worktrees/...` worktree of the lead's project). Otherwise it is listed as a session of its own. Sub-agents started by a teammate are not drawn yet.
- Every run in its own working folder (for example one Orca worktree each) is listed as its own session.
- Cost needs a known model; unknown models show tokens only.

## Development

```sh
git clone https://github.com/th-yong/agent-run-inspector.git
cd agent-run-inspector
node bin/cli.js        # or: npm link, then run ari
npm test && npm run lint
```

Without the app, `ari` prints `http://127.0.0.1:<port>/?t=<token>` and opens it; the token signs the browser in for that run only.

## Third-party assets

Brand icons come from simple-icons 15.22.0 (CC0-1.0), inlined without a dependency, and only mark which provider or service a call belongs to. Brand names and logos are trademarks of their owners; this project is not affiliated with or endorsed by them. Logos keep their owners' colors. Logos whose owners' guidelines do not allow this use (OpenAI, Google, Figma, Slack, Python, Docker, PostgreSQL, Linear, Vercel, Atlassian) are not drawn; a neutral symbol stands in. Credits (Git logo by Jason Long, CC BY 3.0; Yarn logo, CC BY 4.0), trademark notices and the per-brand guideline review are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

The code is under the [MIT License](LICENSE). The license does not cover the third-party brand names and logos.
