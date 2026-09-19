---
title: The Agent Loop
description: How session.run drives Tasks and turns: approval flow, concurrent tool execution, hooks, mid-run steering, automatic reconnect, and compaction.
---

The SDK's single execution entry point is `session.run(newMessages, opts?)`. The input is the list of new OmniMessages, called the Prompt. The return value is an async generator that streams [OmniMessage](/omni-message) outputs. One `run` call drives one complete Task, which ends when the model produces a final answer with no tool calls. A [stop hook](#stop-hooks) can ask for more, in which case the same `run` call drives several Tasks in a row.

This page shows the `context_engine`'s overall flow first, then breaks down each stage. The message-level observable timeline and the ordering guarantees are covered on [Message Flow & Ordering](/message-flow). Source: `packages/core/src/engine/context-engine.ts`.

## The loop at a glance

The diagram traces one `run` call from entry to return.

```text
session.run(newMessages, { approve, signal })
  │  carry-over from a previous interrupt? → prepend to this run's input
  ▼
┌── turn loop (≤ max_turns; default -1 = no cap) ───────────────┐
│                                                               │
│  request_begin                                                │
│  LLM.streamGenerate(newMessages)                              │
│    ├─ streams partial_* fragments + complete msgs             │
│    ├─ for each complete tool_call:                            │
│    │     pre_tool_use hooks (if installed), then              │
│    │     approve(toolCall) ──deny──► synthetic aborted output │
│    │          │allow           (approvals sequential;         │
│    │          ▼                 decision audited)             │
│    │     Environment.executeTool ──► runs concurrently,       │
│    │                                 output streams back      │
│    └─ LLMOutcome:                                             │
│         retryable ──► reconnect within the turn               │
│          (≤5 fruitless, with [turn_retried]; tools not rerun) │
│         fatal ──► keep carry-over, run returns (no abort)     │
│  token_usage + request_end (at LLM-stream end; not waiting    │
│                              for tools)                       │
│                                                               │
│  tool outputs reordered to original call order ──► next turn  │
│  no tool_call this turn? ──► Task ends                        │
│  compaction trigger (context/turns)? ──► summarize/discard    │
│                                          + Trace rotation     │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
stop hooks (each answer → a `hook` event; the first `continue` ──► its input
becomes the next Task's user message, same run) ── no continue? ──► run returns

signal fires (any point) ──► emit abort + build carry-over ──► run returns
```

Every message and event flows to two destinations at once: streamed live to the Human, and written to the [Trace](/sessions-and-traces).

## Inputs and outputs

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Clean up the CSV files under data/")], {
  approve: async (toolCall) => "allow",
  signal: abortController.signal,
})) {
  // output: partial_* fragments, complete model_msg, event_msg
}
```

```ts
interface RunOptions {
  signal?: AbortSignal;       // interrupt (e.g. Ctrl-C)
  approve?: ApproveFn;        // per-tool approval; denies everything when omitted (conservative default)
  preToolUse?: PreToolUseFn;  // pre-tool-use hook consult, called before approve for each complete tool_call
}
```

The Session fills in `preToolUse` itself from the agent's installed hook packages (see [Pre-tool-use hooks](#pre-tool-use-hooks)).

The generator's return value says how the run ended: `null` when it ran to completion, otherwise a `RunCutoff`:

```ts
interface RunCutoff {
  kind: "abort" | "llm_failure" | "compaction_failure" | "max_turns";
  errorCode?: ErrorCode;
  errorMessage?: string;
}
```

## Lifecycle of a turn

A Task consists of consecutive Requests, also called turns. Each turn proceeds as follows:

1. The engine emits `request_begin`.
2. The LLM streams back `partial_*` fragments, followed by complete messages.
3. Every complete `tool_call` is first offered to the installed `pre_tool_use` hooks, then triggers exactly one `approve` callback, unless a hook already decided. The decision is recorded as an `approval_decision` event.
4. Approved calls run concurrently in the Environment. The approvals themselves happen one at a time. Tool outputs stream out in completion order.
5. When the LLM stream ends, a completed request emits its final `token_usage`, and `request_end(status)` follows at once. This happens **without waiting for tools**: a tool that is still running may emit output after `request_end`. A request that did not complete emits no `token_usage`.
6. Once the whole batch of tool calls is terminal, the tool results are **reordered to the original call order** and become the next turn's input. The next Request never fires before that.

The Task ends when a turn produces no `tool_call`.

A denial produces a synthetic `aborted` tool output that the model reacts to. The output text depends on what denied the call:

| Denial source | Tool output the model receives |
| --- | --- |
| The approval callback | `Tool call denied by user.` |
| The [command policy](/configuration#command-policy)'s `forbidden` decision (see [ApproveFn](/interfaces#approvefn)) | `Tool call denied by policy.` |
| A `pre_tool_use` hook | `Tool call denied by the <name> hook: <reason>.` |

## Interruption and carry-over

When `signal` fires, the engine emits an `abort` event and returns immediately. It also constructs carry-over content for the next `run` call. A request that ends `fatal` builds the same carry-over but emits no `abort` event (see [Automatic reconnect](#automatic-reconnect)).

What the carry-over contains depends on how far the turn had got:

| Case | When | Carry-over |
| --- | --- | --- |
| A | The model's output had completed: the turn's `tool_call`s were committed | Finished tool results are re-sent as structured `tool_call_output`s. Unfinished calls get an `[interrupted: tool aborted by user]` placeholder, keeping `tool_call`/output pairing strictly intact. |
| B | The model's output was incomplete | The whole turn is flattened into one `[turn_aborted]` user text carrying whatever partial output existed. |

An interruption that lands before the Request is issued keeps the input as-is as carry-over, without flattening it, so multimodal input is not lost.

Carry-over enters the model context only. It is never written to the Trace, which records only what actually happened.

## Hooks

A **hook** is a function the Session runs at a fixed point of the loop. Three points exist today:

| Hook point | When it runs | Section |
| --- | --- | --- |
| `stop` | The moment a Task ends: the model's final reply with no tool call, or a cutoff — user abort, LLM failure, or the `max_turns` cap | [Stop hooks](#stop-hooks) |
| `pre_tool_use` | Before each tool call's approval | [Pre-tool-use hooks](#pre-tool-use-hooks) |
| `user_prompt` | When a prompt is submitted | [User-prompt hooks](#user-prompt-hooks) |

The hooks a Session consults are the hook packages installed in the agent's `agent_state/hooks/` directory. A [plugin](/skills#hook-packages) ships such packages, and the Session reads them fresh per Session, like Skills. SDK embedders can also register in-process functions through `SessionConfig.hooks.stop` / `.preToolUse` / `.userPrompt`.

An installed hook is a plain Node script, run as a subprocess the way Claude Code runs its command hooks. The script is told only where to look; it derives everything else from the Trace: Token usage, turn counts, how the Task ended, and its own state file. A non-zero exit is a failure, and the tail of stderr becomes the reason. A timeout kills the script; the timeout comes from the manifest's `timeout` field and defaults to 60 s.

### Stop hooks

```text
stdin   { "hook": "stop", "session_id": "…", "trace_path": "/abs/…/<session>_001.jsonl" }
stdout  nothing = no opinion; otherwise
        { "decision": "continue" | "stop",   // continue: `input` becomes the next Task's user message
          "input": "…",
          "reason": "one line for people",
          "output": { "…": scalars },        // the hook's own record
          "subagent": { "prompt": "…", "agent_id": "…" } }   // ask for a detached background subagent
exit    non-zero = failure (stderr's tail becomes the reason); a timeout (default 60 s) kills it
```

`trace_path` is the Trace file being written, which is the current context segment. A compaction rotates it to a new file. The field is absent for a Session without a Trace.

The rules:

- Hooks run in registration order after every Task.
- Every non-empty answer is recorded as one [`hook` event](/omni-message#eventmsg) with the fields `hook`, `name` (the package name), `decision`, `reason` and `output`. The event is streamed and written to the Trace. The injected input is not in the event; it is the user message that follows it.
- The first `continue` wins. Its input is stamped [`sender: "harness"`](/omni-message#modelmsg-complete-payloads) and yielded onto the stream, and it drives the next Task inside the same `run` call. A plain run never yields its own input; hosts render the injected one from the stream, and the stamp — not the text — is what says the harness sent it. With no `continue`, the call returns.
- After a cutoff, or once the signal is aborted, a `continue` is recorded but never run. A user's interruption outranks every hook.
- A `subagent` answer makes the Session spawn a detached background child Session. It runs the same agent, or the `agent_id` from the answer, and its first user message is the prompt. The child inherits the run's approval callback. Its stream is dropped; its own Trace is the record. Its Session id is recorded on the event as `output.session_id`.
- A hook that fails — it crashes, prints something that is not JSON, or times out — is recorded with the error as its `reason` and treated as having no opinion. It never takes the run down.

Two hook packages ship in the plugin library:

- [Goal mode](/goal-mode): its stop hook reads the goal file, decides, and hands back the next round's protocol message.
- The **`continual-learning`** plugin (not preinstalled): it fires when the Task that just ended ran more than 30 completed turns and the agent has at least one installed Skill. It condenses that Task into an excerpt — user and assistant text, tool calls with their arguments, and tool outputs, each clipped, with no thinking or images — and answers with a `subagent` request. The request's prompt names the skills directory and the Skills the Task invoked, and asks the child to fold the durable findings into the relevant `SKILL.md` files, or to change nothing.

The continual-learning window is the Task itself: its records in the Trace, starting from its input message. If a compaction rotates the Trace file mid-Task, the window is what the new file holds. A Task therefore triggers the hook at most once, at its end, and short Tasks never do.

### Pre-tool-use hooks

A hook package can also name `pre_tool_use` commands: they appear in its `hooks.json`, generated from the plugin's `hooks.pre_tool_use`. The engine consults them once per complete tool call, **before** the approval callback. They use the same subprocess contract, with the call itself inline:

```text
stdin   { "hook": "pre_tool_use", "session_id", "trace_path",
          "tool_name": "exec_command", "tool_call_id": "…", "arguments": "<raw argument JSON>" }
stdout  nothing = no opinion; otherwise
        { "decision": "allow" | "deny",   // deny: refuse the call; allow: approve it without asking
          "reason": "one line for people",
          "output": { "…": scalars } }    // the hook's own record
```

The rules mirror the stop point's: every non-empty answer is one `hook` event, the first decision wins, and a crash, non-JSON output or timeout is recorded and treated as no opinion. Three rules are specific to this point:

- A **deny** refuses the call without consulting the approval callback. The model reads the refusal as the tool's output, with the hook's name and `reason` included.
- An **allow** approves the call without asking the host. The [command policy](/configuration#command-policy) still outranks it: hook packages live in agent-writable state, while the policy is Project-owned security config, so a policy-vetoed call stays `forbidden` no matter what a hook answers. A deny can only ever narrow what would have run.
- The scripts run **on the hot path**: one consult per tool call, before anything executes. Keep them fast, and set a tight `timeout` in the manifest.

No built-in plugin ships one. The point exists for custom guards: a project-specific sandbox rule, an audit log, or an allowlist that skips the approval prompt for known-safe calls.

### User-prompt hooks

The third point, `user_prompt`, expands a submitted prompt. These hooks run in core and nowhere else. The host triggers the point through `Session.runUserPromptHook(name, prompt, extras)` when it accepts a user prompt for the flow that the package owns. The Session supplies its own id and scratchpad directory.

```text
stdin   { "hook": "user_prompt", "session_id", "scratchpad_dir", "prompt", …host extras (goal: "budget") }
stdout  { "context": "<text appended after the user's message>" }
```

The answer's `context` is sent right behind the user's own message as a harness-stamped message, which hosts render as a compact collapsed card. The call returns `null` when the package is not installed or names no `user_prompt` command. It records no `hook` event; the expansion message is the record.

[Goal mode](/goal-mode) is the one shipped use. The goal plugin's `start.mjs` is its `user_prompt` command. The Server asks the Session to run it for `goal: { budget }`; the command writes `GOAL.json` and answers with round 1's protocol message.

## Mid-run steering

While a Task is running, the host can queue a user message with `session.steer(input)`. The input is a list of OmniMessages, the same shape `run` takes a Prompt in. Steering does not interrupt the loop. At the next input assembly, the engine delivers the queued input as part of that turn.

### How a steering message is delivered

- The engine wraps the input's user text in a **standalone user text message** delimited by `[user_steering]…[/user_steering]`.
- The message is sent alongside that turn's tool outputs. When the turn produced no tool calls, the steering message is sent alone as the continuation input; the Task keeps going instead of ending.

### Text and images in a steering message

- The input's user text becomes the body of the `[user_steering]` block.
- Its images follow it as ordinary user image messages, so an image with no caption is a complete steering message.
- On a model without vision, images fold into `[attached image: <path>]` lines **inside** the block, exactly as a Prompt's images do. The block must stay the whole text; otherwise the message would lose its steering identity and read as a new Task.

### Delivery guarantees

- Steering is real user input: it is written to the Trace like any Prompt, yielded to the output stream, and replayed as ordinary turn input on resume. Tool outputs are never rewritten.
- The queue is drained at **every** input assembly, including right after a mid-run compaction. Steering that arrives during the compaction request is delivered, never swallowed.
- Queued background-task completion notices are delivered at the same assembly points, ahead of the steering, so the user's own words come last.
- The queue is discarded only when the run exits, abort included.

### The steering API

| Call | Effect | Return value |
| --- | --- | --- |
| `session.steer(input)` | Queues the input while a Task is running | `false` when no Task is running; hosts then submit a normal task |
| `session.unsteer(input)` | Withdraws a queued input before it is delivered | `false` once the input was delivered or the run exited |

## Input images

An input image either rides the request as an image message or becomes an `[attached image: <path>]` line pointing at a file in the Session scratchpad. The model then views the file with `read_file`, and the Web App restores the thumbnail from the path. The conversion is one function, bound once per Session; it is the only layer that knows both the scratchpad and the model's capability. Each input path decides for itself whether to apply it:

| Input | Folds when | Applied at |
| --- | --- | --- |
| Prompt (`run`) | the model has no vision | run entry, before Trace and title material |
| Steering (`steer`) | the model has no vision | delivery, at the turn boundary — queuing must stay synchronous, and a queue discarded on abort would otherwise leave orphan files |

Goal mode adds no rule of its own. Images attached to a goal ride round 1 with the user's message and fold like a Prompt's images; later rounds re-inject the objective text only. See [Goal mode](/goal-mode).

## Automatic reconnect

Only a `retryable` LLM failure triggers an in-run reconnect; a `fatal` one ends the run at once.

### Retryable and fatal failures

The `retryable` class is deliberately wide. It covers:

- transport drops and idle timeouts;
- `408`, `429` and `5xx` responses;
- malformed or truncated responses, such as a response JSON parse failure or a cleanly truncated stream;
- every error the classifier cannot place.

The fatal detector is a deterministic allowlist. A gateway that phrases a transient fault its own way — `Upstream HTTP/2 stream failed`, say — therefore keeps its retries. The concrete cause of a retryable failure rides on the request's `error_code` (`timeout`, `network` or `malformed`) and `error_message`.

A `fatal` failure stops the run at once, without retrying. It covers:

- a definitive provider `4xx` rejection, such as invalid parameters or an exhausted quota; `408` and `429` are excluded from this class;
- a credential failure (`auth`);
- a deterministic client-side rejection, such as fast mode on a model without a fast tier (`unsupported`);
- input that cannot be assembled into a request (`invalid_input`).

An identical request can only fail the same way, so the ladder would only delay the actionable error.

### How a turn is retried

On a reconnect, the engine re-sends the original input plus a `[turn_retried]` block carrying the previous partial output. The block carries the accumulated output into every retry. Tools are never re-executed.

### The backoff ladder

The default limits and waits:

| Property | Value |
| --- | --- |
| Consecutive fruitless reconnects allowed | 5 |
| Backoff base | 2 s |
| Backoff cap | 30 s |
| Wait sequence | 2 s, 4 s, 8 s, 16 s, 30 s |
| Total patience | ≈ 60 s |
| Absolute ceiling per turn | 20 attempts |

There is one shared schedule for every retryable failure. It is sized so that transient provider failures such as restarts and rate limits get a real recovery window, and so every planned wait clears the Web App's 2 s countdown floor and stays visible.

An attempt that **received content** before dropping — a `terminated: other side closed (UND_ERR_SOCKET)` mid-response, say — had a working connection and a model writing into it. Its failure restarts the ladder at 2 s instead of climbing it, because two socket drops in one turn should not add up to a reason to give up. The bound on that reset is the separate absolute ceiling of 20 attempts per turn, which only an endpoint that streams a little and drops every time ever reaches. `attempt` keeps counting every attempt and never rewinds when the ladder resets.

### When the run gives up

A run gives up in two cases: a `fatal` failure, and a `retryable` failure whose retries ran out. In both, the run ends without an `abort` event, because `abort` marks only a user interruption. The `request_end` is the terminal record, and the turn's pending state is kept as carry-over for the next run.

- A `fatal` failure's terminal `request_end` carries status `fatal` with `error_code` and `error_message`.
- When the retries run out, the terminal `request_end` is `retryable`, with `attempt` and the error pair but no `retry_in_ms`. The retry input — the original input plus its `[turn_retried]` block — is kept as carry-over.

Only the model reference is fixed at Session creation. Credentials are read from the current Project config when the Session loads, so after a credential failure the user updates the model's API key and sends again.

### Retry status and user controls

Each failure that will be retried announces the planned wait on its `request_end` as `retry_in_ms`, using the same formula as the sleep. Every failure stamps `attempt`, the authoritative 1-based ordinal of the request within its retry run; the CLI and the Web App display it verbatim. The wait is visible by design: a retry the user cannot see is a stalled session with no explanation and no way out.

The Web App renders the wait as a live countdown with two controls:

| Control | Effect |
| --- | --- |
| **Retry now** | Skips the remaining wait via `Session.skipReconnectWait`; the attempt counter is unchanged |
| **Give up** | The ordinary abort; the engine's abort-during-backoff path ends the turn |

The CLI prints its own `[retry]` line.

### Retries for compaction requests

A compaction request is an ordinary LLM request. By default it retries on the same cap and ladder; an unusable summary draws on the same budget (see [Compaction](#compaction)). One exception: received content never resets a compaction's ladder. A compaction that gives up keeps the original context and tries again at the next trigger.

Tool errors are never retried. They are fed back to the model as `tool_call_output`, and the model decides what to do next.

## Compaction

Compaction does more than shorten the history: **every compaction rotates in a brand-new model context**. Once it completes, the agent's entire runtime configuration is reassembled from the Agent State as it is at that moment, exactly like a new Session's first context, and the Trace starts a new file. One Trace file always equals one model context.

An edit made to the agent's configuration mid-conversation therefore takes effect after the next compaction. There is one exception: the `compaction` section itself, which the engine re-reads at every compaction checkpoint and applies to the running conversation at once.

### Settings, triggers and modes

Compaction settings are filled in from `system_config.yaml` by the composition layer:

```ts
interface CompactionSettings {
  maxContextLength: number;   // context-token threshold (last token_usage's request.total); <=0 disables
  maxSessionTurns: number;    // cumulative Session turn threshold (counted across Tasks); <=0 = unlimited
  mode: "summarize" | "discard";
  prompt: string;             // the Prompt used by summarize compaction
}
```

Three triggers exist, recorded as `compaction_begin.reason`:

| reason | Condition |
| --- | --- |
| `context` | the last turn's `token_usage.request.total` ≥ the effective context threshold |
| `turns` | Session turn count ≥ `maxSessionTurns` (default -1 = unlimited) |
| `manual` | the user runs `/compact` or calls `session.compact()`, or switches the model inside the Session (the switch compacts on the current model first) |

The effective context threshold for the `context` trigger is the smaller of `maxContextLength` (default 256000) and the model's `context_window` − 2048. A 32k local vLLM therefore compacts at ~30.7k instead of overflowing the window first, while a 1M-window model fires at the configured 256000. An entry without a usable `context_window` — unset, or below 4096 — derives from an assumed 128000 window, i.e. ~126k.

Two modes exist:

| Mode | Behavior |
| --- | --- |
| `summarize` (default) | Appends the compaction Prompt to the old context, extracts the `[summary]`, wraps it as a `[context_summary]` user text, and continues in a fresh model context |
| `discard` | Drops the old context. Mid-Task it waits until the Task ends, since dropping the context would lose the Task |

System markers are written as `[tag]…[/tag]`. The earlier angle-bracket form (`<summary>`, `<context_summary>`, …) is still recognized when reading old Traces and old persisted compaction prompts.

Summary extraction applies a tolerance ladder:

1. The first non-empty `[summary]` tag pair wins.
2. When every pair is empty, the text left after stripping the tags is used instead. This rescues models that write the body after the closing tag.
3. With no tags at all, the whole output is used verbatim.

Compaction rotates the [Trace file](/sessions-and-traces) (`_002`, `_003`, …); one Trace file always equals one complete model context. `compactability()` probes feasibility before `session.compact()` (`ok | unsupported | empty | just_compacted`).

### Assembling the new context

The new context is **assembled from the Agent State as it is at that moment**, exactly as a new Session's first context is. It takes:

- `system_config.yaml` in full: the prompt template with its section prompts and toggles, the builtin tool entries and MCP Servers, the compaction settings, `max_turns`, and the model defaults;
- `AGENTS.md`;
- the vault;
- the installed Skills' metadata;
- the Memory indexes;
- the schedule roster;
- the Environment's date.

An edit made during the old context — by the model working on its own configuration, or by hand in the agent settings — therefore takes effect at the next compaction rather than the next Session.

### Runtime parameter tiers

Runtime parameters fall into three tiers:

| Tier | Parameters | Rule |
| --- | --- | --- |
| Strict | The system prompt, the toolset (MCP included), the model reference | Never change inside a running context. They shape the request prefix, and a context's prefix is fixed from open to close, so the provider's prompt cache stays valid across the whole Trace file. |
| Soft | The thinking level | A purely per-request parameter, changeable mid-context and never recorded in the Trace, at the cost of the provider's cached messages. |
| Unrestricted | The approval mode; the `compaction` section (`max_context_length`, `max_session_turns`, `mode`, `prompt`) | Re-read per decision or per compaction checkpoint. Changes apply at once and never touch the request. |

- Every LLM request takes the Session's pinned thinking level: the Web App's in-chat picker, or the CLI's `--thinking` / `/thinking`. Unpinned, it takes the agent config default read when the context opened. The pickers advise compacting first because a mid-context change costs the provider's cached messages.
- The approval mode is re-read from the database per decision, so an edit applies immediately.
- The engine re-reads the `compaction` section from `system_config.yaml` at every compaction checkpoint: after each request reports its Token usage, and on a manual `/compact`. The read is cached by the file's mtime, so lowering an agent's threshold applies to conversations already running instead of waiting for a rotation. A read that fails keeps the settings already in force rather than failing the run.
- Compaction settings never belonged to the request prefix: they decide when a context ends, not what it looks like.
- The vault, a tool's `r`/`rw` permission, and the Project's command policy never reach the model. They are read once per context, on the same rotation schedule as the strict tier.

### Re-equipping the Environment

The Environment is re-equipped at a rotation:

- The vault's values go straight into the command environment of every command spawned from then on. Processes already running keep the environment they were started with.
- MCP Servers are cached by config. An entry that did not change keeps its live connection and discovered tools; a removed or changed one is closed. Only new, changed, or previously failed ones connect, and the wait streams as the same `mcp_connect_begin` / `mcp_connect_end` pair the first run brackets it with, followed by the new `tool_list_ready`.

The rotated Trace file opens with the `session_meta` recording the prompt this context runs with, then the connect pair (if any) and the toolset record.

What stays fixed for the Session's lifetime is the Session itself: its id, Workspace and origin. The model entry (credentials, window and per-model annotations included) is per context: an ordinary rotation keeps the current entry, and an in-session model switch resolves the target entry from the Project config on disk (see [Sessions & Traces](/sessions-and-traces#in-session-model-switch)).

An Agent State that cannot be assembled — a config that no longer parses — fails the run with that error, and the engine stays on the old context. This is the same error a new Session would hit. The same rule opens a context that resume finds closed by a completed compaction (see [Sessions & Traces](/sessions-and-traces)).

### The compaction request

The compaction request keeps the Session's toolset **unchanged**. The request prefix, tool list included, stays byte-identical to ordinary turns, so the provider's prompt cache remains valid at the moment the context is largest.

Compaction succeeds only with a valid summary. A response that calls a tool, or whose extracted summary is empty, counts as one more failed attempt:

- Any tool calls in such a response are answered with synthesized failed outputs, keeping `tool_use`/`tool_result` pairing intact.
- The resent request carries a corrective note ahead of the compaction Prompt, because committed history can only be appended to; rewriting it would invalidate the prompt cache.

Unusable summaries and `retryable` failures alike draw on the one reconnect budget and backoff ladder described under [Automatic reconnect](#automatic-reconnect).

The first **committed** attempt — adopted or rejected — also absorbs whatever turn input was folded into the compaction request into the old context's history, such as mid-Task tool results or the carry-over a manual `/compact` folds in. Retries resend only the repairs and the Prompt; nothing resends the absorbed input afterwards.

### When a compaction gives up

Once the budget is exhausted, the compaction ends `retryable` — abandoned this time. It keeps the original context and Trace file until the next trigger. A `fatal` failure ends the compaction at once as `fatal`; the next trigger would hit the same wall until the configuration or credential changes. A user interruption ends it as `aborted`.

`compaction_end` reuses the unified retry detail block: `attempt` (the final attempt's ordinal, failed attempts included) and, on failure, the last `error_code` and `error_message`, shown on the chat banner and the CLI line. A `retryable` or `fatal` compaction also lands in the cost center as a `compaction_failed` error record.

An abandoned compaction is **made up later**, never patched over:

- Mid-Task, the run ends. The turn's still-pending state is held as carry-over under the same committed/not-committed rule, and the next message resends that carry-over merged with the user's input — where the still-standing threshold triggers the compaction again. The `compaction_end` is the terminal record of such a run; an `abort` event follows only when the user interrupted the compaction.
- At a Task boundary, the run simply ends with the original context kept.

Either way, nothing synthetic is invented to keep the loop running on a context that was supposed to shrink.

### Tools and a mid-Task compaction

Compaction triggered **mid-Task** never preempts the tools. `runTurn` returns only once every tool call of the turn has completed, so the results are ready and paired before the checkpoint is even reached.

The results then ride the compaction request itself, ahead of the compaction Prompt, in their original call order. Whatever a tool produced — a normal result, a `[tool error]`, a denial — is what the summary is written from. A tool that waits on approval or runs for minutes simply delays the compaction; no clock is running on it, because the compaction request has not been issued yet. Nothing synthetic is inserted to close the exchange.

### Observing a compaction

While the compaction request runs, each attempt's `token_usage`, and the thinking and summary it writes, ride the output stream. The thinking and summary appear as ordinary `partial_thinking` and `partial_text` — or the complete `thinking` / `text` for LLM implementations that stream nothing — positioned between the paired compaction events. There is no separate event type, and the compaction request's other raw messages stay Trace-only as before. The request carries the Session's pinned thinking level, exactly as every other LLM request does; with no pin, the level the model context was opened with applies.

The Web App renders the compaction row like a running work group and expands exactly one of its two layers:

- The header's title doubles as its status: **Compacting** (or **Clearing**) while it runs, **Compacted** (or **Cleared**) once done — the work-group header's own **Running**/**Done** idiom. The header also carries the wall time, ticking while it runs and settled once done.
- While the compaction runs, the row is open and its sections are not: **Thinking** (present only when the request produced any) and **Result**, each a closed row carrying its own label and its own wall time. The reader can see that they are there and how long each is taking, without the request's raw workings landing in the transcript.

Once the compaction settles, the row closes itself again, leaving the one-line summary. The chevron is there from the start of a summarize compaction, so the reader can open either section to watch the request work, or read the outcome afterwards.

A history rebuild reads the same content back from the compaction span's recorded thinking and output, so a reload shows exactly what the live viewer saw. Consumers that render a transcript already treat model messages inside the span as compaction-internal, so nothing leaks into the conversation, and the CLI prints none of it.

### An unfinished compaction span

A compaction the user quit out of — the process died mid-request, leaving a `compaction_begin` with no matching end — is an **abandoned compaction**. When the Session next loads, resume closes the span with a `retryable` `compaction_end` before appending anything else, and **discards the half-written summary**. Nothing is reconstructed from it, the original context stands, and the standing threshold makes the compaction up at the next trigger.

Closing the span is what keeps the conversation that follows visible: every reader treats messages between the paired events as compaction-internal. The Web App drops the partial draft from the row rather than showing a truncated summary as if it had been adopted.

## Concurrency model

- Within a turn: approvals are sequential, execution is concurrent, and the next turn's input keeps the original order.
- Within a Session: only one Task or one compaction runs at a time. The Server answers a new Task with `409` while one is running or compacting, unless the request sets `queueIfBusy`, which queues it as a follow-up.
- A [Subagent](/tools) is an independent Session with its own Trace and loop. Its messages are forwarded to the parent tagged with `origin`.

## Side channels

- **Session titles**: `session.generateTitle()` is a one-shot out-of-band LLM call — no tools, no system Prompt, thinking off. It never enters history or Trace.
- **Usage accounting**: each turn's `token_usage` events are persisted row by row by the Server. This is the raw data behind the cost statistics.
