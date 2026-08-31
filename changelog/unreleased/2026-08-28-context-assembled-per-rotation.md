# Every model context is assembled whole from the Agent State as it is when it opens

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)
- **Breaking:** yes — SDK: `SessionConfig.createLLM` / `ContextEngineDeps.createLLM` became `openNextContext`, `RunOptions.thinkingLevel` and the per-round thinking level of the subagent seams are gone; HTTP API: `POST /tasks` and the subagent message no longer take `thinkingLevel`, and a follow-up recall no longer returns one

[中文版](2026-08-28-context-assembled-per-rotation.zh.md)

A compaction now opens its new model context exactly as a new Session opens its first: everything
under the Agent State is read from disk at that moment — `system_config.yaml` in full (the prompt
template with its section prompts and toggles, the builtin tool entries and MCP Servers, the
compaction settings, `max_turns`, the model defaults), `AGENTS.md`, the vault, the installed
Skills' metadata, the Memory indexes and the schedule roster. An edit made during the old
context — by the model working on its own configuration, or by hand in the Agent settings —
takes effect at the next compaction rather than the next Session. Runtime parameters now fall
into three explicit tiers: **strict** (system prompt, toolset incl. MCP, compaction settings,
model reference — the request prefix, byte-fixed across a whole Trace file so the provider's
prompt cache holds; the vault rotates on the same schedule), **soft** (the thinking level:
changeable mid-context, effective from the next request, at the cost of the provider's cached
context — the pickers advise compacting first), and **unrestricted** (approval mode, per-tool
`r`/`rw` permissions, the command policy: consulted per decision, effective immediately).

## Details

- Three openers assemble a context the same way: Session creation, a completed compaction
  (summarize and discard alike), and a resume that finds its latest Trace file closed by a
  completed compaction. A resume of an open context keeps the prompt and the thinking level its
  file recorded — the replayed history was produced under that prefix — and takes tools,
  Environment, vault and run settings from the current Agent State, as before (the Trace records
  no executable configuration).
- The thinking level is the soft-limited tier: a context opens at the Session's pinned level —
  the Web App's in-chat picker, the CLI's `--thinking` / `/thinking`, the SDK's new
  `Session.pinThinkingLevel` — or, unpinned, at the Agent config's `model.thinking_level`, and
  records what it opened with as `session_meta.thinking_level` (`"default"` for none). A re-pin
  applies from the very next LLM request, mid-context included; because that invalidates the
  provider's cached context, the change points remind the user first (the web picker's menu
  note, the CLI `/thinking` reply) that compacting is recommended. Compaction requests keep the
  context's own level — their prefix must stay byte-identical. Nothing rides a run or a task.
- The unrestricted tier is consulted per decision: the approval mode was already re-read from
  the DB on every decision; a tool's `r`/`rw` permission is now read from the Agent State as it
  is on disk at each lookup (`Session.toolPermission`, async), and the command policy is read
  from `.project_config.toml` at every approval — an edit to any of them reaches every running
  Session's very next tool call, no rotation, no reload.
- Fixed for the Session's lifetime: its id, Workspace, model entry (credentials, window and
  per-model annotations included), origin, the Project's command policy, and the Environment's
  process host — background commands, subagent child sessions and their listeners survive the
  rotation.
- The Environment is re-equipped for the new context (`Environment.reconfigure`): the vault's
  values go straight into the command environment of every command spawned from then on
  (processes already running keep the environment they started with). MCP connections are cached
  by config: a server whose entry is unchanged keeps its live connection and discovered tools —
  a Session that compacts every turn does not respawn its servers — a removed or changed one is
  closed, and only new, changed or previously failed servers connect, bracketed by the same
  `mcp_connect_begin` / `mcp_connect_end` pair the first run streams (naming just those servers),
  followed by the new `tool_list_ready`; the engine yields them live.
- Each Trace file a compaction's rotation opens starts with the `session_meta` recording the
  prompt and level its context runs with, then the connect pair (if any) and the toolset record;
  `Session.metaMessage` follows the running context.
- An Agent State that cannot be assembled when a context opens (a `system_config.yaml` that no
  longer parses) fails the run with that error and the engine stays on the old context — the same
  error a new Session would hit; there is no silent fallback.
- Agent State loading is one function: `loadAgentState` — with `init` it is the
  create-or-load entry (`createAgent`, provisioning; `loadOrInitAgentState` is gone), without
  it a missing Agent throws, which is what a model context opening mid-session must see. So
  `createSession` and `resumeSession` read the disk too, and an Agent object held across
  edits — a self-spawned subagent's, for instance — no longer starts Sessions on its
  load-time snapshot.
- Opening a context is one procedure as well: the first run's bootstrap and the
  post-compaction `openNextContext` share the same implementation (connect what is pending,
  publish the connect pair and the toolset record through `emit`, build the LLM), delivered
  live by the same merge-queue pump on both paths.
- The server no longer rebuilds an Agent's cached Session runtimes when its vault is updated: the
  new values reach a running Session at its next compaction, the same timing the CLI's
  in-process Session has. The Agent settings pages (prompt, runtime, tools and MCP, memory,
  schedules, vault, skills), the CLI's `config vault set/remove` and the in-chat thinking picker
  say so where the change is made: new conversations pick a change up right away, running ones
  after their next compaction.

## Compatibility

- SDK: `SessionConfig.createLLM` and `ContextEngineDeps.createLLM` are replaced by
  `openNextContext(sessionTokens, { emit }) => OpenedContext | Promise<OpenedContext>`, with
  `OpenedContext` being `{ llm, sessionMeta?, maxTurns?, compaction? }`; records passed to
  `emit` are yielded on the run stream and written at the head of the rotated Trace file. Code
  that constructs `Session` or `ContextEngine` directly returns `{ llm }` where it returned the
  LLM before; the `Agent.createSession` / `resumeSession` path needs no change. `Environment`
  gains `reconfigure({ toolConfig, vault })` and `pendingMcpServerNames()`.
- SDK: `loadOrInitAgentState` is folded into `loadAgentState` — pass `init: {}` (or
  `init: { preset }`) for the create-or-load behavior; without `init` a missing Agent throws.
  `SessionConfig.bootstrap` now takes `{ emit }` and returns `{ tools, llm }` (no `mcp`
  field), publishing its connect pair and toolset record through `emit`; the
  `SessionConfig.mcpServers` field is gone — the bootstrap knows what it is connecting.
- SDK: `RunOptions.thinkingLevel`, `SubagentHandle.run`'s `thinkingLevel` and
  `SubagentMessageOptions.thinkingLevel` are removed; a host that changed the level per run
  pins the Session with `Session.pinThinkingLevel(level)` instead, and the level applies from
  the next LLM request (the engine reads the live pin through `ContextEngineDeps.thinkingLevel`).
- SDK: `Session.toolPermission` is now async (live per-decision lookup);
  `SessionConfig.commandPolicy` takes a source function evaluated per approval instead of a
  static config; `SessionConfig.toolPermission` carries the live permission lookup.
- HTTP API: `TaskCreateRequest.thinkingLevel` and the subagent message's `thinkingLevel` are
  no longer read (a client still sending them is ignored), and `RecalledMessageResponse` no
  longer carries one. `PATCH /sessions/:id { thinkingLevel }` is the way to set a level; it
  applies from the Session's next model context.
- Traces: no format change and nothing to migrate. `session_meta` gains `thinking_level`; a
  file written before it exists resolves the level as a new context would. A Trace file's
  `session_meta.system_prompt` has always been the prompt that file's context ran with; it now
  differs between the files of one Session when the Agent State changed in between, and a
  rotated file's head carries the context's connect pair before its `tool_list_ready`. A reader
  that took the first file's prompt or toolset as the Session's only one should read the file
  it is rendering.
