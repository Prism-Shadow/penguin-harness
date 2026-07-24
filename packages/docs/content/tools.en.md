---
title: Tools & Approval
description: The deliberately minimal built-in toolset, its execution contract with centralized close-out, and per-call approval audited in the Trace.
---

## Design

PenguinHarness ships a deliberately minimal built-in toolset: dedicated file tools (`read_file` / `edit_file` / `write_file`) cover precise reading and editing — line-numbered output and exact-string replacement beat quoting `sed` one-liners — while the shell (`run_command`) remains the general-purpose fallback for everything else: running programs, searching, installing dependencies. Every tool that remains earns its schema tokens.

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

## Built-in tools

There are 9 built-in tools (assembled via `packages/core/src/environment/tools/registry.ts`):

| Tool | Permission | Timeout (ms) | Purpose |
| --- | --- | --- | --- |
| `run_command` | rw | 120000 | Run a shell command in the Workspace via `bash -lc`, streaming stdout/stderr |
| `input_command` | rw | 130000 | Drive a running command by `process_id`: write stdin, send Ctrl-C, poll output |
| `read_file` | r | 30000 | Read a text file as a line-numbered (`cat -n`) window, paged by offset/limit |
| `edit_file` | rw | 30000 | Exact-string replacement in an existing file, echoing a verification snippet |
| `write_file` | rw | 30000 | Create or overwrite a whole file, creating parent directories as needed |
| `run_subagent` | rw | 600000 | Delegate a self-contained subtask to a child Agent in the same Workspace |
| `input_subagent` | rw | 600000 | Poll a background subagent, or send a follow-up prompt once it is idle |
| `read_image` | r | 60000 | Read an image and return it as image content (vision models) |
| `describe_image` | r | 90000 | Have the configured `vision_model` read the image and answer in text (text-only models) |

`run_command` was formerly named `exec_command`; existing `system_config.yaml` files that still say `exec_command` keep working — the registry maps both names to the same shell tool, and the assembled tool takes its runtime name from the config entry.

### Call descriptions

The command/subagent tools (`run_command`, `input_command`, `run_subagent`, `input_subagent`) accept an optional `description` argument: one model-written sentence about what the call is doing, shown by the CLI and Web UI while the call runs. It is injected into the tool schemas at assembly time and controlled by `tools.call_descriptions` in `system_config.yaml` (missing = enabled; set `false` to turn it off). The file tools don't take it — their `file_path` argument is self-describing.

### Command sessions

`run_command` waits in the foreground first; if the command outruns `yield_time_ms` it moves to the background and the call returns the output so far plus a `process_id`, driven from then on by `input_command`:

```text
run_command(cmd)
  ├─ finishes within the foreground window (yield_time_ms, default 60000)
  │        ──► full output + exit code
  └─ still running ──► backgrounds, returns output so far + process_id
                     │
    input_command(process_id[, chars]) ──► write stdin / send Ctrl-C / poll
                     └─ loop until the command exits
```

Both tools' arguments (explicit keys):

```ts
// run_command
{
  cmd: string;             // required: the shell command to run
  workdir?: string;        // working directory; defaults to the Workspace root, relative paths resolve against it
  yield_time_ms?: number;  // foreground wait; default 60000, minimum 250, capped below the tool timeout
  description?: string;    // optional (with tools.call_descriptions): one sentence shown to the user while the call runs
}

// input_command
{
  process_id: string;      // required: the command-session id returned by run_command
  chars?: string;          // characters for stdin; send "\u0003" alone to deliver Ctrl-C; empty = poll only
  yield_time_ms?: number;  // wait; defaults 250 for writes, 5000 for empty polls
  description?: string;    // optional (with tools.call_descriptions)
}
```

### File tools

`read_file` / `edit_file` / `write_file` run with the user's full permissions, same as the shell tool; relative paths resolve against the Workspace and absolute paths are allowed. They are non-streaming (a single final output) and never throw — failures come back as explanatory text with `stop_reason: failed`.

```ts
// read_file — cat -n style output (line number, tab, content); overlong single lines are
// truncated, and binary content (NUL bytes) is rejected with advice to use shell/image tools.
{
  file_path: string;       // required: absolute, or relative to the Workspace
  offset?: number;         // 1-based line to start from; default 1
  limit?: number;          // max lines returned; default 2000 — a trailing note points at the continuation
}

// edit_file — the file must exist; old_string must occur exactly once (or set replace_all);
// success echoes "Replaced N occurrence(s)" plus a numbered snippet around the change.
{
  file_path: string;       // required
  old_string: string;      // required: exact text to replace, including whitespace/indentation
  new_string: string;      // required: must differ from old_string
  replace_all?: boolean;   // replace every occurrence; default false
}

// write_file — creates parent directories as needed; reports "Created" vs "Overwrote" with lines/bytes.
{
  file_path: string;       // required
  content: string;         // required: full file content; an empty string creates an empty file
}
```

### Subagents

`run_subagent` hands a subtask you can fully specify in one prompt to a child Agent, with the same two-phase shape: after the foreground window (default 300000ms) it moves to the background with a `subagent_id`, driven by `input_subagent` for polling or follow-up prompts; the child's pending approvals surface while the poll waits.

```ts
// run_subagent
{
  prompt: string;          // required: the complete subtask (all context + the exact final output expected)
  agent_id?: string;       // the child Agent; defaults to the current Agent
  model_id?: string;       // the child Session's model; inherits the parent Session's model when omitted
  yield_time_ms?: number;  // foreground wait; default 300000
  description?: string;    // optional (with tools.call_descriptions)
}

// input_subagent
{
  subagent_id: string;     // required: the background Subagent id returned by run_subagent
  prompt?: string;         // follow-up task, accepted only while the child Session is idle; empty = poll only
  yield_time_ms?: number;  // wait; defaults 300000 with a prompt, 10000 for empty polls
  description?: string;    // optional (with tools.call_descriptions)
}
```

- Depth is capped at 1: a subagent cannot spawn another subagent.
- The child Session follows the parent Session — its model (unless `model_id`/`provider` pick another), thinking level, and Workspace — never the Project defaults.
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

### Background session caps

| Session type | Cap | Eviction |
| --- | --- | --- |
| Command sessions | 64 | When full, exited sessions are evicted first, then idle ones by LRU |
| Subagent sessions | 8 | Only completed ones are evicted; running subagents never — with no room, spawning is rejected |

## Approval

Every complete `tool_call` triggers exactly one approval decision:

```ts
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<"allow" | "deny">;
```

| Surface | Behavior |
| --- | --- |
| SDK | Pass `approve` per `session.run`; with none injected the engine denies by default (conservative — nothing gets approved unattended) |
| CLI | `--approve` takes four modes: allow-all (default) / deny-all / read-only / always-ask; read-only auto-approves `permission: "r"` tools and defers the rest to a human |
| Web / Server | The same four modes, set per Session; the mode is re-read from the DB on every decision, so changes take effect immediately; manual decisions arrive via the API |

A deny produces a synthetic aborted `tool_call_output` (`Tool call denied by user.`) for the model to react to. Every decision is written to the Trace as an `approval_decision` event, forming a complete audit record. Approval happens in the tool-execution phase of the [Agent Loop](/agent-loop).

## Custom tools & MCP

The `tools.builtin` array in `system_config.yaml` declares the toolset with entries of the same `ToolDefinitionConfig` shape. The semantics are **wholesale replacement, not merging**: omit the section entirely to keep the full default toolset; once written, the default list is replaced and every tool you keep must carry its complete definition (including the `parameters` JSON Schema — a tool's schema comes entirely from config). `tools.mcpServers` carries MCP server configs (name + config) — enumerating concrete MCP tools is reserved for a later adapter layer and not yet wired. See [Configuration](/configuration).

```yaml
tools:
  # Writing builtin replaces the default toolset wholesale (this example deliberately
  # keeps a minimal single-tool set).
  builtin:
    - name: run_command
      description: Run a shell command in the workspace.
      permission: rw
      timeoutMs: 120000
      maxOutputLength: 16000
      # parameters: the complete JSON Schema is required (see the default definition
      # in packages/core/src/state/default-config.ts); elided here.
  mcpServers: []
  # Optional: set false to drop the `description` call argument from the
  # command/subagent tools (missing = enabled).
  call_descriptions: true
```
