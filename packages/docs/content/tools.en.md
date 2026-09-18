---
title: Tools & Approval
description: How the built-in tools run under one execution contract, how each call is approved and audited in the Trace, and how MCP servers join them.
---

PenguinHarness ships a deliberately minimal built-in toolset. Dedicated file tools (`read_file` / `edit_file` / `write_file`) cover precise reading and editing, because line-numbered output and exact-string replacement beat quoting `sed` one-liners. The shell (`exec_command`) remains the general-purpose fallback for everything else: running programs, searching, installing dependencies. Every tool that remains earns the schema Tokens it costs.

The Environment runs every tool call through one shared contract and handles the close-out centrally. This page covers that contract first, then the per-tool configuration, the 7 built-in tools and their background behavior, the per-call approval recorded in the Trace, and how to customize the toolset and add MCP servers.

## Execution contract

Every built-in tool implements the same `BuiltinTool` interface (`packages/core/src/environment/tools/types.ts`):

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  detachable?: boolean; // has a background form a running call can be moved to (exec_command, run_subagent)
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolExecutionContext {
  workspaceDir: string;
  toolCallId: string;
  signal?: AbortSignal;
  detachSignal?: AbortSignal; // fires when the host asks this call to continue as a background task
  approve?: ApproveFn; // forwarded to tools that spawn child Sessions (approval inheritance)
}

interface ToolResult {
  stopReason?: StopReason; // the tool's self-reported terminal state (lowest priority, see below)
  note?: string; // terminal marker appended outside the output budget (e.g. exit code)
  images?: string[]; // data-URL images, appended after the text output
}
```

A tool only yields incremental `partial_tool_call_output` deltas. The Environment handles the close-out centrally:

- streaming framing (start / stop) and `tool_call_id` threading;
- timeouts, and head-and-tail truncation once output exceeds `maxOutputLength` (default 16000 characters);
- `stop_reason` priority: user interrupt > timeout > tool throw > tool self-report. A timeout or a throw ends the call as `fatal`;
- never-empty output: `[no output]` is substituted when a call produced no text and no note;
- `note` (for example the exit code) and images are appended outside the output budget, so the terminal marker survives even when long output is cut.

Truncation splits the budget in half. The head window streams live. At finalization, the Environment emits a `[output truncated: kept first H and last T of C chars]` marker followed by the tail window. The total `C` tells the model whether the [recovery file](#recovering-oversized-output) is worth reading. Output that ends past the head window but within the budget is flushed verbatim at finalization instead, with no marker.

Tools and the Environment never throw into the engine. Errors become `tool_call_output` messages the model can read and react to. A call whose arguments do not fit the tool ends as `fatal`, and its whole output is a correction guide:

- the fault;
- the argument names received, with unknown ones called out;
- the tool's parameters, restated from its schema;
- the shape of a correct call.

That is enough to repair the call from the output alone. For message structure, see the [OmniMessage Protocol](/omni-message).

### Recovering oversized output

When tool text in an agent Session exceeds `maxOutputLength`, the model, the Web App and the CLI still receive the same head and tail windows, the counting truncation marker and the terminal marker. The streaming invariant that user-visible output equals model-visible output does not change.

Beyond that visible cap, the Environment appends a short archive status or path note and saves a recovery file owned by the Session. The file holds the exact text within the per-call archive budget, and bounded head and tail windows beyond it. It is the complete text **received by the Environment**: a producer such as a command or subagent session may already have replaced overflow in its own bounded unread buffer with a `[... N chars of earlier output dropped ...]` marker, and the archive cannot recover text lost before that point.

The agent reads ordinary multiline archives with the existing `read_file` (`offset` / `limit`). For byte tails or very long lines, it builds a targeted shell command such as `rg` or `tail`; there is no dedicated retrieval tool.

The note carries a plain absolute path, always the last element inside the bracket. On Windows the path uses forward slashes: `exec_command` runs through (Git) Bash and Node's fs APIs accept them, so one spelling works in JSON tool arguments and shell commands alike. POSIX paths pass through unchanged, and Session paths are ordinary absolute paths (never `\\?\`-prefixed), so swapping the separator loses nothing. As with any path, quote it in shell commands when it contains spaces.

The same spelling rule covers every path core composes for the model:

- the system prompt's App Data Dir / CWD lines;
- `[attached image/file: …]` lines;
- the goal-file line (`modelVisiblePath` in the SDK).

| Property | Recovery file behavior |
| --- | --- |
| Location | `scratchpad/<session-id>/truncated-tool-output/`, under the Session |
| Creation | Only after actual truncation |
| Permissions | Private where the platform supports them |
| Per-call size | At most 8 MiB; the production byte limit is one byte lower so `read_file` stays below its 8 MiB scan cap |
| Larger output | Bounded head and tail windows with an explicit middle-gap marker |
| Quota | Per call only: a Session has no total byte or file-count quota, and concurrent captures each keep up to one call's budget |
| Lifetime | Readable across Tasks, runtime disposal and Session resume, until explicit Session deletion removes the whole scratchpad; there is no separate archive cleanup |

> [!WARNING]
> Recovery files contain the unredacted tool text the Environment received. If a tool accidentally reads credentials or other sensitive data, the local copy on disk grows from the visible windows to the archive budget.

The Trace does not duplicate those bytes. It does record the same absolute Session path shown to the model, the Web App and the CLI, which exposes the host's data-root layout.

A failed archive write never changes the original tool's `stop_reason`. The visible note and the stderr warning carry only a short error code (plus the tool name on stderr), never the path or the raw error message.

## Configuration fields

Each tool is described by one `ToolDefinitionConfig`:

| Field | Meaning |
| --- | --- |
| `name` | Tool name, matching the model's `tool_call.name` |
| `description` | Tool description handed to the model |
| `parameters` | JSON Schema of the arguments |
| `permission` | `"r"` read-only / `"rw"` read-write |
| `forModel` | `"vision"` / `"text-only"`: selected by the Session model's class. Omitted means available to all models. No built-in entry sets it, because `read_file` serves both classes |
| `timeoutMs` | Per-call timeout (ms), default 120000; `<=0` disables |
| `maxOutputLength` | Output length cap (characters); `<=0` disables |
| `call_description` | Per-tool switch for the `description` call argument declared in `parameters` (required while on). Missing means kept; `false` removes the property and its `required` entry from the schema at assembly |

## Built-in tools

There are 7 built-in tools, assembled through `packages/core/src/environment/tools/registry.ts`:

| Tool | Permission | Timeout (ms) | Purpose |
| --- | --- | --- | --- |
| `exec_command` | rw | 120000 | Run a shell command in the Workspace (through `bash -lc` where bash exists), streaming stdout/stderr |
| `input_command` | rw | 120000 | Drive a command session by `process_id`: write stdin, send Ctrl-C, poll output, or terminate it (`kill: true`) |
| `read_file` | r | 60000 | Read a text file as a line-numbered (`cat -n`) window paged by offset/limit, or an image (path or URL) as image content; for a text-only model, the `vision_model` describes the image in text |
| `edit_file` | rw | 30000 | Replace an exact string in an existing file, echoing a diff of the change |
| `write_file` | rw | 30000 | Create or overwrite a whole file, creating parent directories as needed |
| `run_subagent` | rw | 600000 | Delegate a self-contained subtask to a child agent in the same Workspace |
| `input_subagent` | rw | 600000 | Poll a background subagent, steer it mid-run, stop its current run, or continue it with a follow-up prompt |

An existing agent's stored `tools.builtin` list stays exactly as written; the settings UI edits rows but adds none. As a result:

- Agents created before this toolset do not pick up newer tools (for example the file tools) or newer arguments (`run_in_background`, `kill`, `abort`) automatically.
- Entries for removed tools (`kill_command`, `kill_subagent`, `read_image`, `describe_image`) simply stop being assembled. A model that calls one gets the standard unknown-tool failure.
- A stored `read_file` entry from before it read images keeps its old description and timeout, although the implementation behind it already reads images.

To adopt the current definitions, edit the agent's `system_config.yaml` by hand, copying the entries from the defaults in `packages/core/src/state/default-config.ts`. **Update kernel** on the agent's settings page rewrites the list only while the **Tools** tab is absent or still an unedited old default; **Restore default configuration** always does, but resets the whole config. See [Kernel updates](/configuration#kernel-updates).

### Call descriptions

The command and subagent tools (`exec_command`, `input_command`, `run_subagent`, `input_subagent`) take a `description` argument: one model-written sentence about what the call is doing, which the CLI and the Web App show while the call runs.

The argument is declared as a normal `description` property in each entry's `parameters` in `system_config.yaml`, because tool schemas live entirely in the editable config. It is **required** there, so a tool that offers the argument always gets one. The frontends can then choose a call's display form from the schema instead of guessing while the arguments stream, and the model is asked to emit the argument first.

The per-entry `call_description` field switches the whole feature. Missing means kept; `call_description: false` removes the property and its `required` entry from the schema at assembly time. This happens in memory only; the YAML is never rewritten.

The file tools do not take the argument, because their `file_path` already says what the call is about.

### Command sessions

`exec_command` waits in the foreground first. If the command outlasts `yield_time_ms`, it moves to the background, and the call returns the output so far plus a `process_id`; from then on `input_command` drives it. With `run_in_background: true`, `exec_command` skips the foreground window: the call returns the `process_id` at once, and when the process exits, its result arrives as an automatic user message (see [Background completion reports](#background-completion-reports)).

`input_command` with `kill: true` terminates a session started either way. A process is a real OS object that does get destroyed, so termination is a parameter of the access tool rather than a tool of its own:

```text
exec_command(cmd)
  ├─ finishes within the foreground window (yield_time_ms, default 60000)
  │        ──► full output (+ an exit-code or signal note when it failed)
  ├─ still running ──► backgrounds, returns output so far + process_id
  │                  │
  │  input_command(process_id[, chars]) ──► write stdin / send Ctrl-C / poll
  │                  └─ loop until the command exits
  └─ run_in_background: true ──► returns process_id immediately
                     └─ on exit: completion report arrives as a user message
     input_command(process_id, kill: true) ──► SIGTERM the process group (SIGKILL after a grace period)
```

A command that exits cleanly adds no note. A non-zero exit adds `[exit code: N]` and a signal adds `[terminated by signal S]`; both end the call as `fatal`.

The tools' arguments (explicit keys):

```ts
// exec_command
{
  cmd: string;             // required: the shell command to run (also accepted as `command`; the schema names only `cmd`)
  workdir?: string;        // working directory; defaults to the Workspace root, relative paths resolve against it
  yield_time_ms?: number;  // foreground wait; default 60000, minimum 250, capped below the tool timeout
  run_in_background?: boolean; // true = return process_id immediately; completion arrives as a user message
  description: string;     // required while call_description is on: one sentence shown to the user while the call runs, emitted first
}

// input_command
{
  process_id: string;      // required: the command-session id returned by exec_command
  chars?: string;          // characters for stdin; send "\u0003" alone to deliver Ctrl-C; empty = poll only
  kill?: boolean;          // true = terminate: kill the whole process group, return undelivered output, remove the session
  yield_time_ms?: number;  // wait; defaults 250 for writes, 110000 for empty polls (one poll waits out most builds; pass a smaller value to peek)
  description: string;     // required while call_description is on
}
```

**Shell.** Commands run through `bash -lc` wherever a bash exists, and the system prompt tells the model which shell is active. `PENGUIN_SHELL` (an executable name or path) overrides the choice on every platform. Otherwise the shell is picked in this order:

- On POSIX: `bash` on PATH, then the usual absolute bash locations, then the `$SHELL` login shell, then `sh`.
- On Windows: a `bash` on PATH that is not the WSL launcher (for example Git for Windows), then the bundled MinGit bash, then `pwsh`, then `powershell`.

**Ctrl-C.** On POSIX, Ctrl-C sends `SIGINT` to the session's process group, which interrupts the foreground command. Windows cannot deliver a console signal to a piped child process, so Ctrl-C becomes a hard kill of the whole command session tree (`taskkill /t /f`): the foreground command and every child it started terminate, instead of only the foreground command being interrupted.

### File tools

`read_file` / `edit_file` / `write_file` run with the user's full permissions, like the shell tool. Relative paths resolve against the Workspace, and absolute paths are allowed. A symlinked path is followed to the file it names: reads, edits and writes all land on that file, and the link stays a link. `read_file` refuses the secret stores `.vault.toml` and `.project_config.toml`, matched by file name in any directory and after following symlinks.

The file tools return a single final output rather than a stream, with one exception: for a text-only model, `read_file` streams the vision model's description of an image. They never throw. Failures come back as explanatory text with `stop_reason: fatal`.

`edit_file` and `write_file` serialize per file within the server process, keyed by the file's real path, so a symlink and its target count as one file. Parallel edits of one file are applied one after another, and an `old_string` that an earlier edit removed fails to match instead of overwriting it. Writes from other processes are outside this lock.

`read_file` reads images as well as text. The image branch takes a png, jpeg, gif or webp file up to 5MB, recognized by its magic number and then by its extension, or an http(s) URL in `file_path`. A URL is only ever an image source, and the response's content-type is checked first.

What comes back depends on the Session model's vision flag:

- A model that accepts images gets the image itself as image content, and the text output is one line such as `image/png, 123.4 kB`.
- A text-only model gets the Project's `vision_model` answering `prompt` (by default, a detailed description), streamed as the tool's text output. The image never enters that Session's history. Without a `vision_model`, reading an image in a text-only Session fails with an explanation asking the user to pick one in the model settings. See [Models & Providers](/models).

The branch is decided by the `VisionDescriberService` that the SDK injects into the Environment for text-only Sessions only, so one config entry (without `forModel`) serves both model classes.

```ts
// read_file — cat -n style output (line number, tab, content) for text; overlong single lines
// are truncated, and binary content that is no supported image (NUL bytes) is rejected with
// advice to use the shell. An image (or an http(s) URL) returns image content or a text
// description instead, and ignores offset/limit.
{
  file_path: string;       // required: absolute, or relative to the Workspace; an http(s) URL for an image
  offset?: number;         // 1-based line to start from; default 1
  limit?: number;          // max lines returned; default 2000 — a trailing note points at the continuation
  prompt?: string;         // a question about an image, answered by the vision_model for a text-only model; default: a detailed description
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

`run_subagent` hands a subtask you can fully specify in one prompt to a child agent. It has the same two-phase shape as a command: after the foreground window (default 300000ms) the child moves to the background with a `subagent_id`, and `input_subagent` drives it from there. The child's pending approvals surface while a poll waits.

`input_subagent` covers four actions:

1. An empty `prompt` polls.
2. A `prompt` sent while the child **runs** is injected mid-run as a steering message. This is the same mechanism as a user interjecting in the main session: the message arrives as `[user_steering]` at the child's next step and is recorded in the child's Trace with sender `parent_agent`.
3. A `prompt` sent while the child is idle continues the same session with a follow-up round.
4. `abort: true` stops the child's **current run only**. The session survives for steering and follow-ups; combined with a `prompt`, it interrupts and redirects.

Every `input_subagent` call returns the child's **most recent complete reply** to the model: an idempotent snapshot of what it last said, not an incremental drain.

With `run_in_background: true`, the launch returns the `subagent_id` immediately, and the completion of every round the model started arrives as an automatic user message. Rounds started from the panel and rounds ended by an explicit abort stay silent (see [Background completion reports](#background-completion-reports)).

There is **no kill for subagents**. Like the main agent's session, a subagent session is never destroyed. Releasing an idle one only frees its slot, and a released `subagent_id` **revives automatically** when it is messaged again; the model and the panel share the same resume path.

The Web App's subagents panel drives a selected child with the **same composer as the main conversation**, in its subagent variant:

- the message body;
- Skills and slash Skill commands;
- a thinking-level picker, which pins the child Session from its next LLM request;
- the context ring, showing the child's own usage;
- the locked-model badge;
- the approval-mode selector, which edits the parent Session's mode, since that is the mode child approvals are judged by.

A message is a user input to the child, whatever its state: steering while it runs, a follow-up round while it is idle, and a **revival** when the session was already released. To revive a child, the server resumes the child Session (its own history, model and Workspace) and manages it again, so the conversation simply continues. The action button's stop face aborts only the child's current run. All of this goes through the same core channel as `input_subagent`, and the panel's running marks follow the server's live child states rather than the transcript.

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
  prompt?: string;         // steering interjection while the child runs; a follow-up round while it is idle; empty = poll only
  abort?: boolean;         // stop the child's CURRENT run (session kept; the aborted round sends no completion report); with a prompt: interrupt and redirect
  yield_time_ms?: number;  // wait; defaults 300000 with a prompt, 10000 for empty polls
  description: string;     // required while call_description is on
}

```

- Depth is capped at 1: a subagent cannot spawn another subagent.
- The child Session follows the parent Session, never the Project defaults: its model (unless `model_id` / `provider` pick another) and its Workspace.
- The thinking level also follows the parent unless `thinking_level` picks one (lower for cheap mechanical subtasks, higher for hard analysis). The child inherits the parent Session's level from creation, or else the level the parent's current context opened with. A level set on the parent Session mid-conversation is not passed down.
- The child Session inherits the parent agent's approval callback, so the approval mode follows the parent.
- The child Session gets its own Trace, linked from the parent by a `subagent` pointer event. Child messages stream back into the parent's flow tagged with `origin`. See [Sessions & Traces](/sessions-and-traces).

### Background completion reports

A task launched with `run_in_background: true`, and a running call the user [moved to the background](/chat#send-a-tool-call-to-the-background) from its card in the Web App, both report their completion as a **user message injected by the harness**. The model does not need to poll.

A call the user moved to the background says so in its own result. The note tells the model to leave the work alone (no polling, no input) and to move on to other work or end the turn. The user moved it precisely so the model would not follow it up, and the completion arrives on its own.

The message opens with a `[background_task_done]` marker block (kind, id, status and a one-line detail), followed by what ran and the output, capped at 4000 characters: for a command, the tail of its not-yet-delivered output; for a subagent, the end of the child's latest complete reply. The Web App shows the block as a collapsible notice. The message's `text` payload carries `sender: "harness"`, which distinguishes it from human input in the Trace (see [OmniMessage](/omni-message)).

When the report is delivered depends on the Session:

- **A Task is running:** the report rides the next turn boundary. A final reply that is already streaming does not lose it; the Task continues for one more turn to react.
- **The Session is idle:** the hosting server starts a new Task that carries the report. SDK embedders subscribe through `Session.onBackgroundNotice` / `takeBackgroundNotices`, or get the report prepended to the next run.

No report is sent for:

- a command terminated through `input_command`'s `kill`, because that call's own result already carries the outcome;
- a subagent round ended by an explicit `abort`, because the caller that aborted it reads the outcome directly;
- a round the user starts from the subagents panel, which is the user's own conversation with the child. Its answer text stays in the model-facing buffer for the next poll. Reports cover **model-initiated rounds only**: the `run_in_background` launch and `input_subagent` follow-ups.

**Stopped is not failed.** A command ended on purpose reports `status: stopped`, and its marker block says plainly that nobody should restart it unasked. Deliberate stops are:

- the user's **Stop** button in the Web App's process list;
- a stop signal from outside (`SIGTERM` / `SIGINT` / `SIGHUP`), such as a Ctrl-C in a terminal sharing the process group, a `pkill`, or a supervisor shutting a dev server down;
- a stop the harness forced itself, such as a capacity eviction or an idle reap.

The conversation does need to hear that the dev server it started is down. Worded as `failed`, that would read like a crash, and the reasonable response to a crashed dev server is to start it again, undoing the stop somebody just asked for. `failed` stays for outcomes nobody asked for: a spawn error, a non-zero exit, a hard kill, or a fault signal such as an OOM kill or a segfault.

A background subagent's lifecycle is independent of the call that launched it:

- **Aborting:** its abort scope is its own. A per-run `abort` ends a round; the session itself ends only with the parent Session, and even one released for capacity can be revived.
- **Messages:** they stream live to the frontend through the launching Session, on the same origin-tagged channel a foreground window uses.
- **Approvals:** they resolve through the launching call's own approval callback, which stays attached. An `allow-all` launch therefore runs unattended, and a failure still ends in a `status: failed` report rather than a child waiting forever.

### Background session caps

| Session type | Cap | Eviction |
| --- | --- | --- |
| Command sessions | 64 | When full, an exited session is evicted first; otherwise the least recently used session is killed and evicted |
| Subagent sessions | 8 | Only completed sessions are evicted, never a running one; when there is no room, spawning is rejected |

## Approval

Every complete `tool_call` gets exactly one approval decision:

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

| Surface | Behavior |
| --- | --- |
| SDK | Pass `approve` to each `session.run`. With none injected, the engine denies everything by default, so nothing is approved unattended |
| CLI | `--approve` takes four modes: `allow-all` (default), `deny-all`, `read-only`, `always-ask`. `read-only` auto-approves `permission: "r"` tools and leaves the rest to a person. The flag sets the approval mode of the server Session the CLI drives; without it, a CLI running inside an agent's command inherits the calling Session's mode |
| Web / Server | The same four modes, set per Session. The mode is re-read from the database on every decision, so a change applies at once. A tool's `r` / `rw` comes from the running context's toolset, so a permission change applies at the next rotation (compaction). Manual decisions arrive through the API |

Installed pre-tool-use hooks are consulted before the approval callback. A hook's `deny` refuses the call without asking, and its `allow` approves without asking, except that the [command policy](/configuration#command-policy) still vetoes an allowed call it matches. See [Pre-tool-use hooks](/agent-loop#pre-tool-use-hooks).

A refused call gets a synthetic `aborted` `tool_call_output` for the model to react to. The wording names the decider:

| Decider | Output |
| --- | --- |
| A person or approval mode (`deny`) | `Tool call denied by user.` |
| The command policy (`forbidden`) | `Tool call denied by policy.` |
| A pre-tool-use hook | `Tool call denied by the <hook> hook[: <reason>].` |

A policy hit therefore never reads as a person cancelling. See [ApproveFn](/interfaces#approvefn). Every decision is written to the Trace as an `approval_decision` event, with a policy veto recorded as `forbidden`, which makes the Trace a complete audit record. Approval happens in the tool-execution phase of the [agent loop](/agent-loop).

**Subagent approvals.** Ending the parent's task never auto-denies a child's approval. The server attaches a session-lifetime fallback approval sink to every Session it runs, CLI-driven Sessions included. It escalates to the user any child approval that has no active poll window and no background-launch sink, even while the parent Session sits idle. When a parent task ends or is stopped, only the **main** Session's pending approvals are resolved. A child approval tagged with `origin` stays pending, with its card on screen, until the user decides. An SDK embedder that never calls `Session.setSubagentApprovalFallback` keeps the poll-window-only behavior: the child's requests wait until a `run_subagent` or `input_subagent` call is active.

## Customizing the toolset

The `tools.builtin` array in `system_config.yaml` declares the toolset, with entries of the same `ToolDefinitionConfig` shape. It **replaces the defaults wholesale; it is not merged with them**. Omit the section to keep the full default toolset. Once you write it, the default list is gone, and every tool you keep needs its complete definition, including the `parameters` JSON Schema, because a tool's schema comes entirely from config.

`tools.mcpServers` holds the MCP Server configuration, covered in the next section. See also [Configuration](/configuration).

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

## MCP Servers

Each `tools.mcpServers` entry is `{ name, config }`. `name` becomes the tool-name prefix: it must start with a letter or digit and contain only letters, digits, `_` and `-`, and a duplicate name is skipped. `config` describes the transport. Three transports are supported:

- `stdio`: a local process (`command` / `args` / `env` / `cwd`). The process environment is the SDK's safe inherited defaults plus the entry's `env`, with `env` winning. Unlike command subprocesses, MCP Server processes do **not** receive the agent's Vault: list any variable a Server needs in the entry's `env`. `cwd` defaults to the Session's Workspace.
- `http`: Streamable HTTP, the current spec's remote transport (`url` / `headers`).
- `sse`: the legacy HTTP+SSE transport, kept for servers that have not migrated (`url` / `headers`).

The `transport` field may be omitted: an entry with `command` infers `stdio`, and one with `url` infers `http`. `sse` must always be explicit.

All three transports share these optional fields:

| Field | Meaning |
| --- | --- |
| `connectTimeoutMs` | Budget for connecting and discovering tools, default 10000 |
| `timeoutMs` | Execution timeout for every tool of that Server; the Environment default when unset |
| `maxOutputLength` | Output cap for every tool of that Server; the Environment default when unset |
| `permission` | `auto` / `r` / `rw`, default `auto`; see [Permission mapping](#permission-mapping) |

`connectTimeoutMs`, `timeoutMs` and `maxOutputLength` must be positive numbers here; an entry with a value of 0 or less is invalid. `headers` are attached to every HTTP request to that Server, SSE stream included, so they can carry auth headers such as `Authorization`.

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

### Connection and discovery

- Connecting is **lazy**. Creating a Session returns at once; the first `run()` connects all Servers in parallel and discovers their tools once.
- The wait streams as one `mcp_connect_begin` / `mcp_connect_end` pair: frontends show a connecting status, and the end event carries the overall status plus per-Server results. The full tool definitions follow as a `tool_list_ready` event (see [OmniMessage](/omni-message)). In the Trace, all three land after the run's input, inside the new turn.
- Aborting during the connect **cancels** the attempt, and the next `run()` connects again.
- The discovered tools are a snapshot for the model context: `tools/list_changed` notifications are ignored. When a compaction opens the next context, a Server whose entry is unchanged keeps its live connection and tools. Removed or changed Servers are closed, and new, changed or previously failed ones connect again. The connect event pair appears only when some Server needs connecting, while `tool_list_ready` is always emitted (see [Compaction](/agent-loop)).
- An unreachable Server or an invalid entry only produces a warning on stderr and is skipped. **The Session is never blocked.**
- Discovered tools join the flat tool namespace as `mcp__<server>__<tool>`. A tool whose full name is not a valid LLM tool name (letters, digits, `_` and `-`, at most 128 characters) or that the Server lists twice is skipped with a warning. The rest go through the same [execution contract](#execution-contract) (timeout, truncation, interruption) and [approval](#approval) flow as built-in tools.

### Permission mapping

- Under the default `permission: auto`, a tool the Server annotates with `readOnlyHint: true` is `r`, which the `read-only` approval mode auto-approves. Everything else is `rw`: annotations are untrusted hints, so the default leans restrictive.
- Setting the entry's `permission` to `r` or `rw` overrides the annotation for **every** tool of that Server. This is the way to handle the many Servers that never set `readOnlyHint` and so land on `rw` entirely.
- `permission` fixes the level each of the Server's tools reports, and exactly one approval mode reads that level. Under `read-only`, an `r` tool is auto-approved and an `rw` tool needs manual confirmation. `allow-all`, `deny-all` and `always-ask` never consult it, so marking an entry `rw` adds no prompt in those modes.
- Beyond that, the key does nothing. It does not sandbox the Server or restrict what its tools do when they run. It is never sent to the Server or checked against it, and the Server keeps whatever capabilities its transport gives it. Marking a Server `r` when it can in fact write removes the confirmation `read-only` would have asked for.

### Results and teardown

- Text blocks are joined into the output text, and image blocks ride along as images (data URLs).
- Audio and binary resources become placeholder lines; a text resource contributes its text; a `resource_link` becomes `[resource: <uri>]` plus its description; an unknown block type becomes `[unsupported content type: <type>]`.
- When the joined text is empty, `structuredContent` is serialized as JSON.
- A Server-reported `isError` ends the call with `stop_reason: "fatal"`, and the Server's error text as the content (`[tool reported an error with no message]` when it sent none).
- Session teardown (`Environment.dispose`) closes every MCP client, and stdio child processes exit with it.
