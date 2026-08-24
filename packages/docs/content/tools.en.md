---
title: Tools & Approval
description: The deliberately minimal built-in toolset, its execution contract with centralized close-out, and per-call approval audited in the Trace.
---

## Design

PenguinHarness ships a deliberately minimal built-in toolset: dedicated file tools (`read_file` / `edit_file` / `write_file`) cover precise reading and editing — line-numbered output and exact-string replacement beat quoting `sed` one-liners — while the shell (`exec_command`) remains the general-purpose fallback for everything else: running programs, searching, installing dependencies. Every tool that remains earns its schema tokens.

## Execution contract

Every built-in tool implements the same `BuiltinTool` interface (`packages/core/src/environment/tools/types.ts`):

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolExecutionContext {
  workspaceDir: string;
  toolCallId: string;
  signal?: AbortSignal;
  approve?: ApproveFn; // forwarded to tools that spawn child Sessions (approval inheritance)
}

interface ToolResult {
  stopReason?: StopReason; // the tool's self-reported terminal state (lowest priority, see below)
  note?: string; // terminal marker appended outside the truncation window (e.g. exit code)
  images?: string[]; // data-URL images, appended after the text output
}
```

A tool only yields incremental `partial_tool_call_output` deltas; the Environment handles the close-out centrally:

- streaming framing (start / stop) and `tool_call_id` threading;
- timeout merging, and head-kept truncation once output exceeds `maxOutputLength` (default 16000 characters);
- stop_reason priority: user interrupt > timeout > tool throw > tool self-report;
- never-empty output (`[no output]` is substituted when a tool produced nothing);
- `note` (e.g. the exit code) and images are appended outside the truncation window, so the terminal marker survives even when long output is cut.

Tools and the Environment never throw into the engine: errors collapse into `tool_call_output` messages the model can read and react to. See the [OmniMessage Protocol](/omni-message) for message structure.

### Recovering oversized output

When tool text in an Agent Session exceeds `maxOutputLength`, the model and Web/CLI still receive the same head window, truncation marker, and terminal marker, and the streaming invariant that user-visible output equals model-visible output does not change. Environment also appends a short archive status/path note outside that visible-output cap and saves a Session-owned recovery file. The file is exact within the per-call archive budget and otherwise contains bounded head/tail windows. This is the complete text **received by Environment**: a producer such as a command or subagent session may already have replaced overflow with an `[..., N chars of earlier output dropped ...]` marker in its own bounded unread buffer, and the downstream archive cannot recover text lost before that point.

The Agent can inspect ordinary multiline archives with the existing `read_file` (`offset` / `limit`). For byte tails or very long lines, it must construct a targeted shell command such as `rg` / `tail`; no dedicated retrieval tool is added. The note carries a plain absolute path, always the last element inside the bracket. On Windows it is written with forward slashes: `exec_command` runs through (Git) Bash and Node's fs APIs accept them, so one spelling works in JSON tool arguments and shell commands alike; POSIX paths pass through unchanged, and Session paths are ordinary absolute paths (never `\\?\`-prefixed), so the separator swap is lossless. As with any path, quote it inside shell commands when it contains spaces. The same spelling rule covers every path core composes for the model — the system prompt's App Data Dir / CWD lines, `[attached image/file: …]` lines and the goal-file line (`modelVisiblePath` in the SDK).

Recovery files live under the Session's `scratchpad/<session-id>/truncated-tool-output/`, are created only after actual truncation, and use private permissions where the platform supports them. One call stores at most 8 MiB (the production byte limit is one byte lower so `read_file` remains below its 8 MiB scan cap); larger output keeps bounded head/tail windows in the file with an explicit middle-gap marker. The limit is per call only: a Session has no aggregate archive byte or file-count quota, and concurrent captures independently retain up to one call's budget. Files remain readable across Tasks, runtime disposal, and Session resume until explicit Session deletion removes the entire scratchpad; no separate archive cleanup lifecycle is added.

Recovery files contain the unredacted tool text received by Environment. Accidentally reading credentials or other sensitive data can therefore increase local at-rest retention from the visible head window to the archive budget. Trace does not duplicate those bytes, but it records the same absolute Session path shown to the model and Web/CLI, exposing the host's data-root layout. Archive-write failure never changes the original tool's `stop_reason`; the visible note and stderr warning carry only a short error code (and stderr's tool name), not the path or raw error message.

## Configuration fields

Each tool is described by one `ToolDefinitionConfig`:

| Field | Meaning |
| --- | --- |
| `name` | Tool name, matching the model's `tool_call.name` |
| `description` | Tool description handed to the model |
| `parameters` | JSON Schema of the arguments |
| `permission` | `"r"` read-only / `"rw"` read-write |
| `forModel` | `"vision"` / `"text-only"`: selected by the Session model's class; omitted = available to all models |
| `timeoutMs` | Per-call timeout (ms), default 120000; `<=0` disables |
| `maxOutputLength` | Output length cap (characters); `<=0` disables |
| `call_description` | Per-tool toggle for the `description` call argument declared in `parameters` (required while on); missing = kept, `false` filters it and its `required` entry out of the schema at assembly |

## Built-in tools

There are 11 built-in tools (assembled via `packages/core/src/environment/tools/registry.ts`):

| Tool | Permission | Timeout (ms) | Purpose |
| --- | --- | --- | --- |
| `exec_command` | rw | 120000 | Run a shell command in the Workspace via `bash -lc`, streaming stdout/stderr |
| `input_command` | rw | 130000 | Drive a running command by `process_id`: write stdin, send Ctrl-C, poll output |
| `kill_command` | rw | 30000 | Terminate a command session by `process_id` (whole process group), returning undelivered output |
| `read_file` | r | 30000 | Read a text file as a line-numbered (`cat -n`) window, paged by offset/limit |
| `edit_file` | rw | 30000 | Exact-string replacement in an existing file, echoing a verification snippet |
| `write_file` | rw | 30000 | Create or overwrite a whole file, creating parent directories as needed |
| `run_subagent` | rw | 600000 | Delegate a self-contained subtask to a child Agent in the same Workspace |
| `input_subagent` | rw | 600000 | Poll a background subagent, or send a follow-up prompt once it is idle |
| `kill_subagent` | rw | 30000 | Abort a background subagent by `subagent_id` and remove it, returning undelivered text |
| `read_image` | r | 60000 | Read an image and return it as image content (vision models) |
| `describe_image` | r | 90000 | Have the configured `vision_model` read the image and answer in text (text-only models) |

Note that an existing agent's persisted `tools.builtin` list is frozen as written (the settings UI edits rows but adds none): agents created before this toolset do not pick up newer tools (the file tools, `kill_command`, `kill_subagent`) or newer arguments (`run_in_background`) automatically — hand-edit the agent's `system_config.yaml` and add the new entries (copy them from the default definitions in `packages/core/src/state/default-config.ts`) to adopt them.

### Call descriptions

The command/subagent tools (`exec_command`, `input_command`, `kill_command`, `run_subagent`, `input_subagent`, `kill_subagent`) take a `description` argument: one model-written sentence about what the call is doing, shown by the CLI and Web UI while the call runs. The argument is declared as a normal `description` property in each entry's `parameters` in `system_config.yaml` (tool schemas live entirely in the editable config), and it is **required** there — a tool that offers the argument always gets one, so the frontends can pick a call's display form from the schema instead of guessing while the arguments stream; the model is also asked to emit it first. The per-entry `call_description` field toggles the whole thing — missing = kept, `call_description: false` filters the property (and its `required` entry) out of the schema at assembly time (in-memory only, the YAML is never rewritten). The file tools don't take it — their `file_path` argument is self-describing.

### Command sessions

`exec_command` waits in the foreground first; if the command outruns `yield_time_ms` it moves to the background and the call returns the output so far plus a `process_id`, driven from then on by `input_command`. With `run_in_background: true` it skips the foreground window entirely: the call returns the `process_id` immediately, and when the process exits its result arrives as an automatic user message (see [Background completion reports](#background-completion-reports)). `kill_command` terminates a session either way:

```text
exec_command(cmd)
  ├─ finishes within the foreground window (yield_time_ms, default 60000)
  │        ──► full output + exit code
  ├─ still running ──► backgrounds, returns output so far + process_id
  │                  │
  │  input_command(process_id[, chars]) ──► write stdin / send Ctrl-C / poll
  │                  └─ loop until the command exits
  └─ run_in_background: true ──► returns process_id immediately
                     └─ on exit: completion report arrives as a user message
     kill_command(process_id) ──► SIGTERM the process group (SIGKILL after a grace period)
```

The tools' arguments (explicit keys):

```ts
// exec_command
{
  cmd: string;             // required: the shell command to run
  workdir?: string;        // working directory; defaults to the Workspace root, relative paths resolve against it
  yield_time_ms?: number;  // foreground wait; default 60000, minimum 250, capped below the tool timeout
  run_in_background?: boolean; // true = return process_id immediately; completion arrives as a user message
  description: string;     // required while call_description is on: one sentence shown to the user while the call runs, emitted first
}

// input_command
{
  process_id: string;      // required: the command-session id returned by exec_command
  chars?: string;          // characters for stdin; send "\u0003" alone to deliver Ctrl-C; empty = poll only
  yield_time_ms?: number;  // wait; defaults 250 for writes, 120000 for empty polls (one poll waits out most builds; pass a smaller value to peek)
  description: string;     // required while call_description is on
}

// kill_command
{
  process_id: string;      // required: the command session to terminate (already-exited sessions are removed too)
  description: string;     // required while call_description is on
}
```

On POSIX, Ctrl-C sends `SIGINT` to the session's process group, interrupting the foreground command. On Windows there is no console signal delivery to a piped child process, so Ctrl-C degrades to a hard kill of the whole command session tree (`taskkill /t /f`) — the foreground command and every child it started terminate, instead of the foreground command being interrupted.

### File tools

`read_file` / `edit_file` / `write_file` run with the user's full permissions, same as the shell tool; relative paths resolve against the Workspace and absolute paths are allowed. A symlinked path is followed to the file it names — reads, edits and writes all land on that file, and the link stays a link. They are non-streaming (a single final output) and never throw — failures come back as explanatory text with `stop_reason: failed`.

```ts
// read_file — cat -n style output (line number, tab, content); overlong single lines are
// truncated, and binary content (NUL bytes) is rejected with advice to use shell/image tools.
{
  file_path: string;       // required: absolute, or relative to the Workspace
  offset?: number;         // 1-based line to start from; default 1
  limit?: number;          // max lines returned; default 2000 — a trailing note points at the continuation
}

// edit_file — the file must exist; old_string must occur exactly once (or set replace_all);
// success echoes "Replaced N occurrence(s)" plus a git-style unified diff of the changed
// regions (one hunk per site, nearby sites merged; replace_all storms are capped at a few
// hunks plus an "…and N more replacements" note).
{
  file_path: string;       // required
  old_string: string;      // required: exact text to replace, including whitespace/indentation
  new_string: string;      // required: must differ from old_string
  replace_all?: boolean;   // replace every occurrence; default false
}

// write_file — creates parent directories as needed; reports "Created" vs "Overwrote" with
// lines/bytes. An overwrite also shows a small unified diff against the previous content,
// or a one-line +X/−Y summary when the change is large.
{
  file_path: string;       // required
  content: string;         // required: full file content; an empty string creates an empty file
}
```

### Subagents

`run_subagent` hands a subtask you can fully specify in one prompt to a child Agent, with the same two-phase shape: after the foreground window (default 300000ms) it moves to the background with a `subagent_id`, driven by `input_subagent` for polling or follow-up prompts; the child's pending approvals surface while the poll waits. With `run_in_background: true` the call returns the `subagent_id` immediately and every round's completion arrives as an automatic user message (see [Background completion reports](#background-completion-reports)); `kill_subagent` aborts and removes a background subagent (an idle one is removed too, freeing its slot).

```ts
// run_subagent
{
  prompt: string;          // required: the complete subtask (all context + the exact final output expected)
  agent_id?: string;       // the child Agent; defaults to the current Agent
  model_id?: string;       // the child Session's model, paired with provider; omit both to inherit the parent Session's model
  provider?: string;       // the provider group model_id belongs to; required whenever model_id is given
  thinking_level?: string; // "low" | "medium" | "high" | "xhigh" | "max"; omit to inherit the parent Session's level
  yield_time_ms?: number;  // foreground wait; default 300000
  run_in_background?: boolean; // true = return subagent_id immediately; completion arrives as a user message
  description: string;     // required while call_description is on
}

// input_subagent
{
  subagent_id: string;     // required: the background Subagent id returned by run_subagent
  prompt?: string;         // follow-up task, accepted only while the child Session is idle; empty = poll only
  yield_time_ms?: number;  // wait; defaults 300000 with a prompt, 10000 for empty polls
  description: string;     // required while call_description is on
}

// kill_subagent
{
  subagent_id: string;     // required: the background subagent to abort and remove
  description: string;     // required while call_description is on
}
```

- Depth is capped at 1: a subagent cannot spawn another subagent.
- The child Session follows the parent Session — its model (unless `model_id`/`provider` pick another), thinking level (unless `thinking_level` picks another — lower for cheap mechanical subtasks, higher for hard analysis), and Workspace — never the Project defaults.
- The child Session inherits the parent Agent's approval callback, so the approval mode follows the parent.
- The child Session gets its own Trace, linked from the parent by a `subagent` pointer event; child messages stream back into the parent flow tagged with `origin`. See [Sessions & Traces](/sessions-and-traces).

### Image tools

`read_image` and `describe_image` are mutually exclusive, selected by the Session model's vision flag. Both accept an http(s) URL or a Workspace path and support png/jpeg/gif/webp up to 5MB. Text-only models get `describe_image`: the image plus a prompt are forwarded to the Project's configured `vision_model`, whose text answer becomes the tool output. See [Models & Providers](/models).

```ts
// read_image (vision models)
{
  source: string;          // required: an http(s) URL, or a file path inside the Workspace
}

// describe_image (text-only models)
{
  source: string;          // required: as above
  prompt?: string;         // what to ask about the image; defaults to a detailed description
}
```

### Background completion reports

A task launched with `run_in_background: true` reports its completion as a **user message injected by the harness** — the model does not need to poll. The message opens with a `[background_task_done]` marker block (kind, id, status, one-line detail) followed by what ran and the tail of its yet-undelivered output (capped at 4000 characters; the Web App collapses the block into a one-line notice). Its `text` payload carries `sender: "harness"`, distinguishing it from human input in the Trace (see [OmniMessage](/omni-message)).

Delivery: while a Task is running, the report rides the next turn boundary — a final reply already streaming does not lose it, the Task simply continues for one more turn to react. While the Session is idle, the hosting server starts a new Task carrying the report (SDK embedders subscribe via `Session.onBackgroundNotice` / `takeBackgroundNotices`, or get it prepended to the next run). A task stopped through `kill_command` / `kill_subagent` sends no report — the kill's own result already carries the outcome.

A background subagent's lifecycle is decoupled from the call that launched it: its abort signal is its own (only `kill_subagent`, Session end, or registry eviction ends it), its messages stream to the frontend live through the launching Session (same origin-tagged channel a foreground window relays), and its tool approvals resolve through the launching call's own approval callback as a standing sink — so an `allow-all` launch runs unattended, and a failure still ends in a `status: failed` report rather than a child parked forever.

### Background session caps

| Session type | Cap | Eviction |
| --- | --- | --- |
| Command sessions | 64 | When full, exited sessions are evicted first, then idle ones by LRU |
| Subagent sessions | 8 | Only completed ones are evicted; running subagents never — with no room, spawning is rejected |

## Approval

Every complete `tool_call` triggers exactly one approval decision:

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

| Surface | Behavior |
| --- | --- |
| SDK | Pass `approve` per `session.run`; with none injected the engine denies by default (conservative — nothing gets approved unattended) |
| CLI | `--approve` takes four modes: allow-all (default) / deny-all / read-only / always-ask; read-only auto-approves `permission: "r"` tools and defers the rest to a human |
| Web / Server | The same four modes, set per Session; the mode is re-read from the DB on every decision, so changes take effect immediately; manual decisions arrive via the API |

A deny produces a synthetic `aborted` `tool_call_output` for the model to react to — `Tool call denied by user.`, or `Tool call denied by policy.` when the [command policy](/configuration#command-policy) denied it, so a policy hit never reads as a person cancelling. See [ApproveFn](/interfaces#approvefn). Every decision is written to the Trace as an `approval_decision` event — a policy veto recorded as `forbidden` — forming a complete audit record. Approval happens in the tool-execution phase of the [Agent Loop](/agent-loop).

## Custom tools & MCP

The `tools.builtin` array in `system_config.yaml` declares the toolset with entries of the same `ToolDefinitionConfig` shape. The semantics are **wholesale replacement, not merging**: omit the section entirely to keep the full default toolset; once written, the default list is replaced and every tool you keep must carry its complete definition (including the `parameters` JSON Schema — a tool's schema comes entirely from config). `tools.mcpServers` carries the MCP Server configuration, covered in the next section. See also [Configuration](/configuration).

```yaml
tools:
  # Writing builtin replaces the default toolset wholesale (this example deliberately
  # keeps a minimal single-tool set).
  builtin:
    - name: exec_command
      description: Run a shell command in the workspace.
      permission: rw
      # Optional per-tool toggle: false filters the `description` call argument
      # (declared in parameters.properties) out of the schema (missing = kept).
      call_description: false
      timeoutMs: 120000
      maxOutputLength: 16000
      # parameters: the complete JSON Schema is required (see the default definition
      # in packages/core/src/state/default-config.ts); elided here.
  mcpServers: []
```

### MCP Servers

Each `tools.mcpServers` entry is `{ name, config }`: `name` is restricted to letters/digits/`_`/`-` (it becomes the tool-name prefix), and `config` describes the transport. Three transports are supported:

- `stdio` — a local process (`command` / `args` / `env` / `cwd`). The process environment is the SDK's safe inherited defaults plus the entry's `env` (later wins); the Agent vault is **not** injected into MCP Server processes (unlike command subprocesses) — a variable a Server needs must be listed explicitly in the entry's `env`. `cwd` defaults to the Session's Workspace.
- `http` — Streamable HTTP, the current spec's remote transport (`url` / `headers`).
- `sse` — the legacy HTTP+SSE transport, kept for servers that have not migrated (`url` / `headers`).

The `transport` field may be omitted: an entry with `command` infers `stdio`, one with `url` infers `http`; `sse` must always be explicit. All three share the optional `connectTimeoutMs` (connect + tool-discovery budget, default 10000), `timeoutMs` / `maxOutputLength` (execution bounds applied to every tool of that Server; Environment defaults when unset) and `permission` (`auto` / `r` / `rw`, default `auto` — see the permission bullet below). `headers` are attached to every HTTP request to that Server (SSE stream included), so they can carry auth headers such as `Authorization`.

```yaml
tools:
  mcpServers:
    - name: filesystem
      config:
        command: npx
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    - name: linear
      config:
        transport: http
        url: https://mcp.linear.app/mcp
        headers: { Authorization: "Bearer ..." }
        permission: r        # auto (default) | r | rw
```

Behavior:

- Connecting is **lazy**: Session creation returns instantly, and the first `run()` connects all Servers in parallel and discovers tools once — the wait streams as one `mcp_connect_begin` / `mcp_connect_end` pair (frontends show a connecting status; the end carries the overall status plus per-Server results), and the full tool definitions follow as a `tool_list_ready` event (see [OmniMessage](/omni-message)); in the Trace all three land after the run's input, inside the new turn. Aborting mid-connect **cancels** the attempt — the next `run()` reconnects. The result is a Session-lifetime snapshot and `tools/list_changed` notifications are ignored. An unreachable Server or invalid entry only produces a stderr warning and is skipped — **the session is never blocked**.
- Discovered tools join the flat tool namespace as `mcp__<server>__<tool>` and go through the same [execution contract](#execution-contract) (timeout, truncation, interruption) and [approval](#approval) flow as builtin tools.
- Permission mapping: under the default `permission: auto`, a tool the Server annotates `readOnlyHint: true` is `r` (auto-approved by the read-only approval mode); everything else is `rw` — annotations are untrusted hints, so the default takes the restrictive direction. Setting the entry's `permission` to `r` or `rw` overrides the annotation for **every** tool of that Server, which is the way in for the many Servers that never set `readOnlyHint` and so land on `rw` wholesale.
- What `permission` is: it fixes the level each of that Server's tools reports, and exactly one approval mode reads that level. Under `read-only` an `r` tool is auto-approved and an `rw` tool needs manual confirmation; `allow-all`, `deny-all` and `always-ask` never consult it, so marking an entry `rw` adds no prompt there. Beyond that the key does nothing: it does not sandbox the Server, does not restrict what its tools do when they run, is never sent to or verified against the Server, and the Server keeps whatever capabilities its transport gives it. Marking a Server `r` that can in fact write removes the confirmation `read-only` would have asked for.
- Result mapping: text blocks concatenate into the output text; image blocks ride along as images (data URLs); audio and binary resources collapse to placeholder lines; a result with only `structuredContent` is serialized as JSON; a Server-reported `isError` lands as `stop_reason: "failed"` with the Server's error text as the content.
- Session teardown (`Environment.dispose`) closes every MCP client; stdio child processes exit with it.
