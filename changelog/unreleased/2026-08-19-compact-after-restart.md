# Compaction after a client restart, and localized reasons when it refuses

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#342](https://github.com/Prism-Shadow/penguin-harness/pull/342)
- **Breaking:** yes — two of the three `POST /compact` refusals moved off the shared `nothing_to_compact` error code onto `compaction_not_configured` and `already_compacted`.

[中文版](2026-08-19-compact-after-restart.zh.md)

Asking a Session to compact right after restarting the client was refused with "The current context has nothing to compact (no completed conversation turns yet)", however long the conversation actually was. `Session.compactability()` delegated to the `ContextEngine`, which the first run's bootstrap builds — so between a process restart and the next Task there was no engine to ask, and the delegation fell back to a literal "empty". Availability is now answered from the state the Trace replay recovered, and the three reasons a compaction can be refused reach the UI in the reader's language instead of as English prose.

## Details

- `Session.compactability()` reads the replayed `sessionTurns` when no engine has been built yet, so a resumed conversation is compactable without running a Task first. A Session created in this process still reports `empty`, and one whose only request was interrupted still reports `empty` — those are the cases the reason exists for.
- `Session.compact()` builds the engine when compaction is available, letting the bootstrap seed the resumed history into the LLM, instead of returning an empty stream and leaving the caller waiting for a compaction banner that never arrived. A Session that has never run stays a strict no-op that writes no Trace records, so an untouched session does not become resumable by being compacted.
- The availability rule moved into an exported `compactAvailability` in `context-engine.ts`, shared by the engine and by a resumed Session, so the two answers cannot drift apart.
- Resume restores `fromCompaction` from the Trace's closing compaction (`EngineInitialState.fromCompaction`, derived from `contextClosed`). A restart immediately after compacting reports "just compacted" rather than telling the user they have not spoken yet — both states have zero turns and are not the same message.
- `POST /compact` gives each refusal its own error code instead of sharing one: `compaction_not_configured`, `nothing_to_compact` (no completed turn yet), and `already_compacted`. Clients localize by code, so a single shared code forced a choice between one vague sentence for three situations and untranslated English in a non-English UI.
- The Web's error-code table gained those three reasons plus the codes an ordinary session meets and had no translation for — stale-resource races (`session_not_found`, `approval_not_found`, `process_not_found`, `process_running`, `trace_not_found`, `memory_file_not_found`, `memory_scope_not_found`), Project membership and deletion refusals (`already_member`, `already_owner`, `project_not_found`, `cannot_delete_last_project`), shutdown and deletion races (`shutting_down`, `agent_deleting`, `session_deleting`), plus `workspace_not_found`, `skill_too_large` and the `internal` catch-all — in both locales.

## Compatibility

Two of the three `/compact` refusals changed error code: a 409 that used to arrive as `nothing_to_compact` now arrives as `compaction_not_configured` or `already_compacted` when that is the reason. `nothing_to_compact` keeps its meaning — no completed conversation turn yet — and its HTTP status is unchanged, as is the shape of the error body. A client that only rendered `error.message` needs no change.
