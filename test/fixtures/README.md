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

## Codex fixtures

Synthetic rollouts under `test/fixtures/codex/sessions/`. Field names follow the format survey in `docs/spec.md` section 5.3; no real session content is copied. Ids are `00000000-0000-4000-8000-0000000000NN`, cwd is `/work/synthetic-project`, and bodies are short invented text plus `SECRET-MARKER-CX-n` strings for redaction checks.

| File (date folder / thread) | Version | Covers |
|---|---|---|
| `03/01` ...0001 | 0.45.0 | `token_count` with `info: null`; repeated cumulative `total_token_usage` (duplicate to drop); a `function_call` with no output; no turn events |
| `03/02` ...0002 | 0.107.0 | `task_started` / `task_complete`, `turn_aborted`, `custom_tool_call` pair, `git.branch` |
| `03/03` ...0003 | 0.166.0 | parent: `token_usage_record` plus `token_count` (count once), `cache_write_input_tokens`, `item_completed` (CommandExecution ok and failed), `SubAgentActivity` started/completed, four `spawn_agent` calls (two at the same instant), `ordinal` |
| `03/03` ...0004 | 0.166.0 | child via `source.subagent.thread_spawn` and flat `parent_thread_id`, linked by `SubAgentActivity`; completes |
| `03/03` ...0005 | 0.166.0 | child, flat `parent_thread_id` only, same start instant as ...0004; never finishes (running) |
| `03/03` ...0006 | 0.166.0 | child via `thread_spawn`, after the third `spawn_agent`; `turn_aborted` |
| `03/04` ...0007 | 0.166.0 | child in a different date folder than its parent (`03/03`); completes |
| `03/05` ...0008 | 0.40.0 | first line is not `session_meta` (format unknown); also a `future_unknown_type` line |
