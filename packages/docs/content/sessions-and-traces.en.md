---
title: Sessions & Traces
description: The six-level run model, local data directory layout, Trace file design, and Session recovery.
---

All PenguinHarness runtime data lives on the local file system: configuration is editable files, history is append-only Traces. This page defines each level of the run model and explains how the Trace serves as history, recovery source, and statistics source at once.

## Run model

Six levels: Project → Agent → Workspace → Session → Task → Request.

| Concept | Definition |
| --- | --- |
| Project | Top-level unit organizing Agents; owns the model and credential configuration; in the multi-user Web setup, users and Projects are many-to-many |
| Agent | The executing subject; has exactly one Agent State (a persistent directory); one Agent can serve many Workspaces |
| Workspace | The working directory of one run — the only file scope the model sees; an explicit `workspaceDir` must already exist, otherwise a temp Workspace `workspaces/tmp-<8hex>` is created |
| Session | A continuous conversation under one (Agent, Workspace); model and Workspace are locked at Session creation; ids look like `session-YYYY-MM-DD-HH-mm-ss-<8hex>` |
| Task | One execution goal started by one Prompt; consists of one or more consecutive Requests |
| Request | One LLM API call: context and tool definitions in, streamed output out |

See the [Architecture](/architecture) page for how the levels cooperate, and the [Agent Loop](/agent-loop) for how Requests advance within a Task.

## Data layout

The data root is the `PENGUIN_HOME` environment variable, defaulting to `~/.penguin/data`. The layout is defined in one place, `packages/core/src/state/paths.ts`:

```text
<root>/<project>/
├── .project_config.toml          # Project-level models & credentials (hidden file, 0600)
└── agents/
    └── <agent>/
        ├── agent_state/              # system_config.yaml, AGENTS.md, .vault.toml,
        │                             # tools/, memory/, skills/, schedule/
        ├── traces/
        │   └── <yyyy-mm-dd>/<sessionId>_<index3>.jsonl
        ├── scratchpad/               # temp files, one subdirectory per Session id (e.g. pasted images)
        ├── workspaces/               # temp Workspaces (tmp-<8hex>)
        ├── benchmarks/               # capability Benchmark cases and scores
        └── snapshots/                # Agent State version snapshots
```

See the [Configuration Reference](/configuration) for the fields of each config file.

## Trace design

A Trace is an append-only JSON Lines file; each line is one OmniMessage envelope (see the [OmniMessage Protocol](/omni-message)). History is only ever appended, never modified in place.

- One Trace file corresponds to one complete model context. When compaction produces a new context segment, the writer rotates to a new file — `_002`, `_003`, … — with an incrementing index.
- Recorded: `session_meta`, complete `model_msg`, and all `event_msg`.
- Not recorded: streaming `partial_*` fragments (the producer appends the complete message once the segment ends), and nested messages tagged with `origin` — a subagent's messages go to the child Session's own Trace, while the parent Trace keeps a single `subagent` pointer event at the spawn site recording the child Session id.
- `request_begin` and `request_end(status)` come in pairs delimiting one Request; replay uses `request_end.status === "completed"` as the commit criterion for that turn.

See `packages/core/src/trace/writer.ts` for the implementation.

The head of a Trace (illustrative; one OmniMessage envelope per line):

```jsonl
{"timestamp":"2026-07-18T03:10:22.531Z","type":"session_meta","payload":{"session_id":"session-2026-07-18-11-10-22-3f8a1c2d","provider":"deepseek","model_id":"deepseek-v4-pro","model_context_window":1000000,"system_prompt":"…","tools":[…],"thinking_level":"medium","agent_state":"/home/u/.penguin/data/default_project/agents/default_agent/agent_state","workspace":"/home/u/work"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_begin"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Create hello.txt"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"cmd\":\"printf hi > hello.txt\"}","tool_call_id":"call_0"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"approval_decision","decision":"allow","tool_call_id":"call_0"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"[no output]","tool_call_id":"call_0"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_end","status":"completed"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"token_usage","session":{…},"request":{…}}}
```

## Session recovery

The Trace is the single source of truth for recovery — there is no separate session database to keep in sync. `resumeSession` works as follows:

1. Locate the highest-index Trace file of the Session;
2. Read the runtime configuration from its `session_meta` — model, system prompt, Workspace — all immutable for the lifetime of the Session;
3. Replay the committed history into a fresh LLM context;
4. Reconstruct the carry-over (undelivered tool outputs, interruption markers) plus turn and Token counters;
5. Continue appending to the same Trace file.

Recovery requires that the Workspace and the model still exist. What recovery guarantees is structural legality: only committed turns are replayed, with `tool_call` / `tool_call_output` pairing intact; incomplete model output (thinking, text) is allowed to be lost. A truncated last line left by an abnormal process exit is tolerated and ignored. See `packages/core/src/trace/resume.ts`.

Special case: if the latest Trace file ends with a completed compaction, that context is closed as a whole — resume starts from an empty context; in summarize mode the `[context_summary]` is reconstructed and prepended to the first input after resume (old Traces using the earlier angle-bracket `<summary>` form are still understood).

## Field fidelity

Each content message's opaque provider `fidelity` payload (thinking signatures, phase labels, encrypted reasoning, …) is preserved verbatim in the Trace and sent back verbatim — some models require it byte-for-byte on history replay, and any rewriting would break compatibility. This is one reason the Trace stores raw OmniMessage envelopes rather than a post-processed format.

## Observability

Every approval decision (`approval_decision`), abort (`abort`), compaction (`compaction_begin` / `compaction_end`), and `token_usage` lands in the Trace as an event. The Web Trace view and the usage/cost statistics are both derived from this same data — there is no second source of truth; see the [Web App Guide](/web-app). The approval mechanism itself is covered in [Tools & Approval](/tools).
