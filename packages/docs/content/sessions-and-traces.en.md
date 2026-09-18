---
title: Sessions & Traces
description: The six-level run model, the data layout on disk, how the append-only Trace is written, and how a Session is recovered from it.
---

All PenguinHarness runtime data lives on the local file system. Configuration is editable files, and history is an append-only **Trace**. This page defines each level of the run model and the layout on disk, then explains how the Trace serves as history, recovery source and statistics source at once.

## Run model

The run model has six levels: Project → Agent → Workspace → Session → Task → Request.

| Concept | Definition |
| --- | --- |
| Project | Top-level unit that organizes agents; owns the model and credential configuration; in a multi-user Web deployment, users and Projects are many-to-many |
| Agent | The executing subject; has exactly one Agent State (a persistent directory); one agent can serve many Workspaces |
| Workspace | The working directory of one run — the only file scope the model sees; an explicit `workspaceDir` must already exist; when none is given, a temporary Workspace `workspaces/tmp-<8hex>` is created |
| Session | A continuous conversation under one (Agent, Workspace); model and Workspace are locked at Session creation; ids look like `session-YYYY-MM-DD-HH-mm-ss-<8hex>` |
| Task | One execution goal started by one Prompt; consists of one or more consecutive Requests |
| Request | One LLM API call: context and tool definitions in, streamed output out |

For how the levels work together, see [Architecture](/architecture). For how Requests advance within a Task, see [The Agent Loop](/agent-loop).

## Data layout

The data root is the `PENGUIN_HOME` environment variable, `~/.penguin/data` by default. The layout is defined in one place, `packages/core/src/state/paths.ts`:

```text
<root>/<project>/
├── .project_config.toml          # Project-level models & credentials (hidden file, 0600)
├── benchmarks/                   # capability Benchmark cases and scores, one directory per
│                                 # Benchmark — a peer of the Agents, evaluating any of them
└── agents/
    └── <agent>/
        ├── agent_state/              # system_config.yaml, AGENTS.md, .vault.toml,
        │                             # tools/, skills/, hooks/, schedule/
        │   └── memory/               # Memory: user/ plus one directory per Workspace,
        │                             # each with its own MEMORY.md index
        ├── traces/
        │   └── <yyyy-mm-dd>/<sessionId>_<index3>.jsonl
        ├── scratchpad/               # temp files, one subdirectory per Session id (e.g. pasted images)
        ├── shared_env/               # shared interpreter/tool environments (virtualenvs, pipx,
        │                             # caches) the Agent creates on demand — a system prompt
        │                             # convention, not a path the code creates, so tooling is
        │                             # installed once for any task; project dependencies stay
        │                             # in the project
        ├── workspaces/               # temporary Workspaces (tmp-<8hex>)
        └── snapshots/                # Agent State version snapshots
```

For the fields of each config file, see the [Configuration Reference](/configuration).

## Trace design

A Trace is an append-only JSON Lines file. Each line is one OmniMessage envelope; see the [OmniMessage Protocol](/omni-message). History is only ever appended, never modified in place.

- One Trace file corresponds to one complete model context. When compaction produces a new context segment, the writer rotates to a new file with an incrementing index: `_002`, `_003`, …
- Recorded: `session_meta`, complete `model_msg`, and all `event_msg`.
- Not recorded:
  - Streaming `partial_*` fragments. The producer appends the complete message once the segment ends.
  - Nested messages tagged with `origin`. A subagent's messages go to the child Session's own Trace. The parent Trace keeps a single `subagent` pointer event at the spawn site, recording the child Session id.
- `request_begin` and `request_end(status)` come in pairs and delimit one Request. Replay uses `request_end.status === "completed"` as the commit criterion for that turn.
- Appends are serialized inside the writer. Records from concurrent producers (the model stream, parallel tool executions) land strictly one after another, each as a single uninterrupted line. A multi-megabyte record, such as a base64 image Data URL, can never be torn apart by a concurrent append. File rotation never splits a record.
- Each record is appended with a single `write(2)`, not `fs.appendFile`, which splits payloads larger than 512 KiB into several underlying writes. An abnormal process exit can therefore at most truncate the last record; it can never tear one apart in the middle.
- Before Session resumption continues an existing file, the writer probes the file tail. If a previous crash left a torn line (no trailing newline), the next record is preceded by a newline, so the torn line never swallows the records appended after it.

See `packages/core/src/trace/writer.ts` for the implementation.

### Head of a Trace

An illustrative Trace head follows, one OmniMessage envelope per line. Note the order:

- The user's input is written before the `request_begin` it is sent with.
- On the first run, the toolset follows the input as a `tool_list_ready` event, after an `mcp_connect_begin` / `mcp_connect_end` pair when MCP servers are configured. `session_meta` does not carry the tool definitions.

```jsonl
{"timestamp":"2026-07-18T03:10:22.531Z","type":"session_meta","payload":{"session_id":"session-2026-07-18-11-10-22-3f8a1c2d","provider":"deepseek","model_id":"deepseek-v4-pro","model_context_window":1000000,"system_prompt":"…","agent_state":"/home/u/.penguin/data/default_project/agents/default_agent/agent_state","workspace":"/home/u/work"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Create hello.txt"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"tool_list_ready","tools":[…]}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_begin"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"cmd\":\"printf hi > hello.txt\"}","tool_call_id":"call_0","stop_reason":"completed"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"approval_decision","decision":"allow","tool_call_id":"call_0"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"token_usage","session":{…},"request":{…}}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_end","status":"completed"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"[no output]","tool_call_id":"call_0","stop_reason":"completed"}}
```

### Truncated tool output

When tool output exceeds `maxOutputLength`, the Trace records what the model, the Web App and the CLI see: the bounded head, the truncation marker and the absolute Session recovery path. It does not store a second copy of the archived text.

The path exposes the host's data-root layout. It stays valid across Tasks and Session resume, because the unredacted recovery file lives in that Session's scratchpad, and deleting the Session removes the scratchpad and the recovery file together. Replaying the Trace therefore restores both what the model saw and a usable pointer for later follow-up.

## Session recovery

The Trace is the single source of truth for recovery. There is no separate session database to keep in sync. `resumeSession` works as follows:

1. Locate the highest-index Trace file of the Session.
2. Read the runtime configuration from its `session_meta`:
   - the model and the Workspace, which are immutable for the lifetime of the Session;
   - the system prompt that the context opened with.
3. Replay the committed history into a fresh LLM context.
4. Reconstruct the carry-over (undelivered tool outputs, interruption markers) and the turn and Token counters.
5. Continue appending to the same Trace file.

> [!NOTE]
> The thinking level is not part of `session_meta`. It resolves again from the Session's pin, else the agent config, else the Project default.

### Requirements and guarantees

Recovery requires that the Workspace still exists and the model is still configured in the Project.

Recovery guarantees structural legality:

- Only committed turns are replayed, with `tool_call` / `tool_call_output` pairing intact.
- Incomplete model output (thinking, text) is allowed to be lost.

### Damaged files

- A truncated last line left by an abnormal process exit is tolerated and ignored.
- A malformed line in the middle of a file, for example in a file damaged before the writer serialized appends, is skipped with a diagnostic on stderr. Every parseable record is kept.

See `packages/core/src/trace/resume.ts`.

### After a completed compaction

If the latest Trace file ends with a completed compaction, that context is closed as a whole. Resume starts from an empty context.

In summarize mode, the `[context_summary]` is reconstructed and prepended to the first input after resume. Older Traces using the earlier angle-bracket `<summary>` form are still understood.

The empty context is opened like any context a compaction opens. It is assembled whole from the current Agent State (prompt, toolset, vault and run settings), not from the closed file's recorded prompt. See [Compaction](/agent-loop).

An open context behaves differently: it keeps the prompt its file recorded. Its tools, Environment and vault can only come from the current Agent State, because the Trace records no executable configuration.

## Model switch (/model)

In the Web App, the `/model` command changes models the way the `/agent` handoff does:

1. Picking a model stages it in the composer.
2. Sending creates a new Session under the same agent through the ordinary session-creation API. The new Session uses the chosen model and the source session's Workspace, so files stay reachable.
3. The first message opens with a `[model_switch_from]` source block, followed by whatever the user typed. The block records the source session id, the absolute path of its latest Trace file, the Workspace, and the previous model pair.

The history is not injected into the new context. Some models require thinking payloads and `fidelity` byte-for-byte when history is replayed, and that cannot cross models. Instead, the model reads the source Trace file itself (JSONL, one message envelope per line) when it needs the earlier context; see [Field fidelity](#field-fidelity). The source session and its Trace are untouched. For how to use the command, see [Switch the model](/chat#switch-the-model).

## Field fidelity

Each content message carries an opaque provider `fidelity` payload: thinking signatures, phase labels, encrypted reasoning, and similar data. The Trace preserves this payload verbatim and sends it back verbatim.

- Some models require it byte-for-byte on history replay.
- Any rewriting would break compatibility.

This is one reason the Trace stores raw OmniMessage envelopes rather than a post-processed format.

## Observability

Every approval decision, abort, compaction, and Token usage lands in the Trace as an event:

| Occurrence | Event |
| --- | --- |
| Approval decision | `approval_decision` |
| Abort | `abort` |
| Compaction | `compaction_begin` / `compaction_end` |
| Token usage | `token_usage` |

The Web App's Trace views and the usage and cost statistics are all derived from this data. There is no second source of truth.

Both are priced by the same rule: the Project's current rates for the model, at the tier each request's own timestamp fell in. A Trace file's per-turn costs therefore add up to what the conversation header and the Cost Center show for the same requests. See [Conversations](/chat) and the [Cost Center](/usage).

The approval mechanism itself is covered in [Tools & Approval](/tools).

### Moving Trace files across deployments

- **Export:** in a conversation's Trace panel, **Export** downloads the selected file verbatim as JSONL.
- **Import:** in [System settings](/settings#import-a-trace) → **General**, **Import Trace** adds a file to the Project and agent you choose, as a new conversation. Files can be up to 14 MB.

An import whose session id already exists anywhere in this installation is rejected, so an imported file always becomes index 001 of a new Session.
