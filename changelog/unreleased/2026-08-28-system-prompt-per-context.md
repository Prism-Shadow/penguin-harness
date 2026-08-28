# The system prompt is re-assembled for every model context

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`, `docs`
- **Breaking:** yes — `SessionConfig.createLLM` / `ContextEngineDeps.createLLM` became `openContext`, returning the new LLM together with the context's `session_meta`

[中文版](2026-08-28-system-prompt-per-context.zh.md)

A compaction now opens its new model context with a system prompt assembled from the Agent
State as it is at that moment, instead of the text the Session was created with. An
`AGENTS.md` edit made during the old context — by the model working on its own instructions,
or by hand in the Agent settings — takes effect at the next compaction rather than the next
Session.

## Details

- `AGENTS.md`, the installed Skills' metadata, the Memory indexes, the schedule roster and the
  Environment's date are re-read when a context opens: at Session creation, when a completed
  compaction opens the next context, and when a resume finds its latest Trace file closed by a
  completed compaction (that context is opened for the first time there, so it gets the
  current prompt; an open context keeps the recorded text its replayed history was produced
  under).
- The template and the feature toggles stay as the Session loaded them (`system_config.yaml`
  is baked per Session — it also drives the toolset and the compaction settings), and so does
  the vault key list, which names the keys the Session's command environment actually carries.
- Each Trace file a compaction's rotation opens starts with a `session_meta` recording the
  prompt its context runs with; `Session.metaMessage` follows it.
- If the Agent State cannot be read when the context opens, the previous prompt is kept and a
  warning is logged — the compaction has already succeeded and is not failed after the fact.
- `AgentState.agentsMd` remains the load-time snapshot; the new `readAgentsMd` reads the file,
  and `Agent.createSession` reads it too, so an Agent object held across edits (a self-spawned
  subagent, for instance) no longer starts Sessions on a stale copy.

## Compatibility

- SDK: `SessionConfig.createLLM` and `ContextEngineDeps.createLLM` are replaced by
  `openContext(sessionTokens) => OpenedContext | Promise<OpenedContext>`, with `OpenedContext`
  being `{ llm, sessionMeta? }`. Code that constructs `Session` or `ContextEngine` directly
  returns `{ llm }` where it returned the LLM before; the `Agent.createSession` /
  `resumeSession` path needs no change.
- Traces: no format change and nothing to migrate. A Trace file's `session_meta.system_prompt`
  has always been the prompt that file's context ran with; it now differs between the files of
  one Session when the Agent State changed in between. A reader that took the first file's
  prompt as the Session's only prompt should read the file it is rendering.
