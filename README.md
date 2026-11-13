English | [한국어](README.ko.md)

# agent-run-inspector

A local, read-only inspector for Claude Code and Codex CLI agent runs: see who called whom, what each call cost and where it failed, live, in your browser.

![Demo: the agent graph and timeline of a run](docs/demo.gif)

## Install and run

It reads the run logs those tools already write to disk. Nothing is installed into the agents (no hooks, no proxy). Node 22 or newer, no runtime dependencies, no build step.

```sh
npx github:th-yong/agent-run-inspector
```

It prints `http://127.0.0.1:<port>/?t=<token>` and opens it. After `npm i -g github:th-yong/agent-run-inspector` the short name `ari` works too.

### Private repository access

The repository is private. Accept the collaborator invitation first, then sign in with `gh auth login` or any git credential that can read the repository.

### Run from a local clone

```sh
git clone git@github.com:th-yong/agent-run-inspector.git
cd agent-run-inspector
node bin/cli.js
# or: npm link, then run ari
```

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
| `-v, --version` | Print the version |
| `-h, --help` | Show the help |
| `ari roots list` | Show the log folders in use |
| `ari roots add <dir>` | Remember a Claude Code folder (`--codex` for Codex) |
| `ari roots remove <dir>` | Forget a remembered folder |

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

## Security

Run logs can hold customer data and secrets, so nothing leaves your machine except what you see on screen.

- The server listens on `127.0.0.1` only.
- Each run makes a random token. The first address carries it once, then it becomes an HttpOnly, SameSite=Strict cookie and disappears from the address bar. Requests without the cookie get 401. Host and Origin headers are checked.
- Zero outside requests: fonts, scripts and icons ship in the package. No CDN, telemetry or update check.
- Read-only: log files are never written or deleted. The screen never sends a file path; files are found by opaque ids and must stay inside the known log folders.

### Redaction

`--redact` (basic) hides message bodies, tool input values, tasks, commands and error text, and keeps only lengths and key names. `--redact=strict` also hides session titles, project names, branches and folder paths, for screen sharing. The server decides: the toggle in the top bar can raise the level but never go below the one the server started with.

## Cost

Costs are estimates, not bills. Per call, the value the tool itself reported (Claude Code) is used first, then the built-in `prices.json` (USD per 1M tokens, with an `asOf` date of 2026-11-13 and a source URL per model: the Anthropic and OpenAI public pricing pages), otherwise the call shows tokens only and totals are marked partial. Sub-agent calls always use the price table. Override or add models with `--prices <file>`, which is merged field by field over the built-in table.

## Supported scope

Claude Code (main sessions, sub-agents, teammate sessions) and Codex CLI (rollout files from 0.40 to 0.166). Not included: controlling agents, hooks or proxies, remote access or accounts, other tools such as Cursor or Gemini CLI, full-text search, exporting, and alerts.

### Known limits

- Codex sub-agents are linked to their parent by timing, so the link is an estimate when several start at once.
- Sub-agents of sub-agents are rare in the logs we have seen and are drawn as plain cards on the next row.
- Teammate sessions of Claude Code are shown as external nodes and are not joined to their own session.
- Cost needs a known model; unknown models show tokens only.

## Third-party assets

Brand icons come from simple-icons 15.22.0 (CC0-1.0), inlined without a dependency. Brand names and logos are trademarks of their owners. The OpenAI icon is no longer in newer simple-icons releases, so check each company's brand guidelines before any public distribution.

## License

No license has been chosen (`UNLICENSED`): private use only, not for redistribution.
