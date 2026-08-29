# Every model context is assembled whole from the Agent State as it is when it opens

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`, `cli`, `docs`
- **PR:** [#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)
- **Breaking:** yes — `SessionConfig.createLLM` / `ContextEngineDeps.createLLM` became `openContext`, which returns the new LLM together with the context's `session_meta` and engine settings and publishes its records through `opts.emit`

[中文版](2026-08-28-context-assembled-per-rotation.zh.md)

A compaction now opens its new model context exactly as a new Session opens its first: everything
under the Agent State is read from disk at that moment — `system_config.yaml` in full (the prompt
template with its section prompts and toggles, the builtin tool entries and MCP Servers, the
compaction settings, `max_turns`, the model defaults), `AGENTS.md`, the vault, the installed
Skills' metadata, the Memory indexes and the schedule roster. An edit made during the old
context — by the model working on its own configuration, or by hand in the Agent settings —
takes effect at the next compaction rather than the next Session, and never inside the context
that is running: a context's prompt, toolset and vault are fixed from the moment it opens until
it closes.

## Details

- Three openers assemble a context the same way: Session creation, a completed compaction
  (summarize and discard alike), and a resume that finds its latest Trace file closed by a
  completed compaction. A resume of an open context keeps the prompt its file recorded — the
  replayed history was produced under it — and takes tools, Environment, vault and run settings
  from the current Agent State, as before (the Trace records no executable configuration).
- Fixed for the Session's lifetime: its id, Workspace, model entry (credentials, window and
  per-model annotations included), origin, an explicitly pinned thinking level, the Project's
  command policy, and the Environment's process host — background commands, subagent child
  sessions and their listeners survive the rotation.
- The Environment is re-equipped for the new context (`Environment.reconfigure`): the vault's
  values go straight into the command environment of every command spawned from then on
  (processes already running keep the environment they started with), and the MCP Servers
  reconnect from the new config — the wait streams as the same `mcp_connect_begin` /
  `mcp_connect_end` pair the first run brackets it with, followed by the new `tool_list_ready`,
  yielded live by the engine.
- Each Trace file a compaction's rotation opens starts with the `session_meta` recording the
  prompt its context runs with, then the connect pair (if any) and the toolset record;
  `Session.metaMessage` follows the running context.
- If the Agent State cannot be read when the context opens (a config that no longer parses,
  say), the previous context's whole configuration is kept and a warning is logged — the
  compaction has already succeeded and is not failed after the fact.
- `createSession` and `resumeSession` load the Agent State from disk too (new
  `loadAgentState`), so an Agent object held across edits — a self-spawned subagent's, for
  instance — no longer starts Sessions on its load-time snapshot.

## Compatibility

- SDK: `SessionConfig.createLLM` and `ContextEngineDeps.createLLM` are replaced by
  `openContext(sessionTokens, { emit }) => OpenedContext | Promise<OpenedContext>`, with
  `OpenedContext` being `{ llm, sessionMeta?, maxTurns?, compaction? }`; records passed to
  `emit` are yielded on the run stream and written at the head of the rotated Trace file. Code
  that constructs `Session` or `ContextEngine` directly returns `{ llm }` where it returned the
  LLM before; the `Agent.createSession` / `resumeSession` path needs no change. `Environment`
  gains `reconfigure({ toolConfig, vault })`.
- Traces: no format change and nothing to migrate. A Trace file's `session_meta.system_prompt`
  has always been the prompt that file's context ran with; it now differs between the files of
  one Session when the Agent State changed in between, and a rotated file's head carries the
  context's connect pair before its `tool_list_ready`. A reader that took the first file's prompt
  or toolset as the Session's only one should read the file it is rendering.
