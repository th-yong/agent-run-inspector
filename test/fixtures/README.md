# Test fixtures

All fixtures are synthetic. Field names follow the shapes described in `docs/spec.md`; no real run record was copied.
Body text is short invented prose plus redaction markers (`SECRET-MARKER-...`) so redaction tests can assert they never leak.
Session ids look like `00000000-0000-4000-8000-0000000000aN`, agent ids like `asynthNNNNNNNNNN`.

## Claude Code (`claude-code/projects/-synthetic-demo-app/`)

Generated once by a throwaway script and committed as plain files. A line marked "cut" is intentionally not valid JSON.

| File | Covers |
|---|---|
| `<S1>.jsonl` | `ai-title`; repeated `message.id` lines with identical `usage`; `api-request` + `requestRef` linked; assistant with no `requestRef` and no `api-request` (start approximated); `<synthetic>` API error line; `usage.iterations[advisor_message]` with its own model; `server_tool_use`; `tool_result.is_error`; `toolUseResult.interrupted`; `Agent` tool_use (background, worktree isolation); `async_launched`; `teammate_spawned`; `compact_boundary`; `turn_duration`; `task-notification`; `cost-state`; path-like object keys in tool input |
| `<S1>/subagents/agent-asynth…01.jsonl` + `.meta.json` | depth 1, finished; launches the depth-2 agent |
| `<S1>/subagents/agent-asynth…02.jsonl` + `.meta.json` | depth 2 (same folder, parent found via `toolUseId`) |
| `<S1>/subagents/agent-asynth…03.jsonl` + `.meta.json` | depth 1 with `worktreePath` / `worktreeBranch` |
| `<S2>.jsonl` | no `cost-state`; unknown `type`; two background agents; cut final line (no trailing newline) |
| `<S2>/subagents/agent-asynth…11.*` | running: meta has no `finished` |
| `<S2>/subagents/agent-asynth…12.*` | stopped: `stoppedByUser: true`, no `finished` |

Checked by `test/fixtures-cc.test.js`.
