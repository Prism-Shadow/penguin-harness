# Models and core: file tools, mid-run steering, model-switch forks, and free models

## File tools: read_file, edit_file, write_file (#62)

The builtin toolset gains three file tools. `read_file` returns a `cat -n`-style line-numbered view with `offset`/`limit` paging (2000 lines by default), truncates overlong single lines, and rejects binary content with a pointer to the shell and image tools. `edit_file` performs exact `old_string` → `new_string` replacement: the string must occur exactly once — zero occurrences and duplicates both fail with an explanation — `replace_all` covers bulk changes, and success echoes a line-numbered snippet around the edit for verification. `write_file` writes a whole file, creating parent directories as needed, and reports whether it created or overwrote. All three resolve relative paths against the Workspace and accept absolute paths under the same trust model as the shell tool, which remains the general-purpose fallback for everything else. The docs' framing — which used to present "no file tools at all" as a design tenet — was rewritten around the nine-tool builtin set (zh + en).

## exec_command becomes run_command, with no config broken (#62)

The primary shell tool is renamed `exec_command` → `run_command`. Existing agents load their `system_config.yaml` verbatim, so the rename is fully backward compatible: assembled tools now take their runtime name from the config entry, and the registry keeps `exec_command` as a documented legacy alias for the same factory — an old config keeps its name in dispatch, the LLM tool list and error strings, and old Traces keep rendering correctly.

## Model-written call descriptions (#62)

The four command/subagent tools — `run_command`, `input_command`, `run_subagent`, `input_subagent` — accept an optional `description` argument: one model-written sentence, in the user's language, saying what the call is doing, shown in the UIs while it runs. The schema is injected at assembly time and controlled by a new `tools.call_descriptions` toggle in `system_config.yaml` — missing means enabled, so every existing agent gets the feature; the injection is in-memory only and never written back to the YAML. The file tools take no `description`: their path argument is self-describing.

## Steering: message a running task (#63)

A running task used to be untouchable until it finished or was stopped. `Session.steer` and `POST /api/sessions/:id/steer` now let the user message a RUNNING task: the engine queues the text and appends it to the next completed `tool_call_output`, wrapped in a paired `[user_steering]` marker, before that message is traced, streamed, or fed back — the model sees the guidance mid-loop without the loop being interrupted, and Trace, the live stream and the next-turn input all carry the same message. A turn that ends with the queue still non-empty continues with the queued text as a normal user turn; an abort discards the queue. The marker is documented in the default prompt's System markers section, and in the CLI a line typed while a task runs becomes steering, acknowledged as queued.

## System markers move to paired square brackets (#63)

Every system-synthesized marker switches from the angle-bracket to the paired square-bracket form: `[turn_aborted]`, `[turn_retried]`, `[context_summary]`, `[summary]`, `[use_skills]`, `[handoff_from]`, `[scheduled_task]`, `[developer_instructions]`, plus the inner transcript tags inside synthetic blocks. Producers emit only the new form; every parser that can meet old data — Traces written before the change, compaction prompts persisted in existing agents' `system_config.yaml` — accepts the legacy angle form permanently. The docs' marker literals were updated accordingly (zh + en), noting that the old form is still recognized.

## Thinking level is per-request; session_meta keeps invariants only (#64)

`thinking_level` is removed from `session_meta`: the meta now holds only per-session invariants, and anything the user can change mid-conversation is either a per-turn parameter or a new session. The level threads through as a per-request parameter instead — `GenerativeModelParameters`, `RunOptions` and `TaskCreateRequest` — with the construction-time value acting as just the default; compaction requests deliberately keep the default. Legacy traces that recorded the field are still honored on resume.

## Model-switch forks (#64)

`Agent.forkSession` and `POST /api/sessions/:id/fork` open a NEW session for the same agent and Workspace on a different model, carrying the full conversation as real history. The committed history is sanitized unconditionally — thinking messages are dropped and `fidelity` stripped, since thinking payloads carry provider- and model-bound fidelity that breaks when replayed elsewhere; `token_usage` and subagent pointer events are removed too — then written as the fork's own trace and replayed into the new model, so the trace on disk equals the injected context and the fork is itself resumable. A new invariant meta field `forked_from` records the source; forking answers 409 while the source is running. The sessions-and-traces docs gain a model-switch fork section (zh + en).

## The default prompt exposes the Agents Dir, not the project dir (#61)

Models kept mistaking the Environment section's Project Dir for the user's working directory (which is `CWD`) and read or wrote files at the wrong root. The default system prompt now exposes Agents Dir — the project dir's `agents/` folder — via a new `{{AGENTS_DIR}}` placeholder, and every prompt path (Agent State, other agents' assets, skills, scratchpad) is phrased relative to it. `{{PROJECT_DIR}}` still substitutes for legacy configs' custom prompts but is no longer advertised; the six builtin skills' texts and the web system-prompt editor's placeholder hints follow suit.

## OpenRouter free models (#60)

The catalog gains two $0 OpenRouter rows: `inclusionai/ling-3.0-flash:free` — the free tier of Ling 3.0 Flash, a 124B-parameter MoE, context 262,144 — and `openrouter/free`, the Free Models Router that sends each request to a random free model. The router records no fixed context window (the routed target varies per request) and deliberately claims no vision support, since the harness must not send images to a router whose target may be text-only. The catalog test's free-pricing invariant now covers the `/free` router id alongside the `:free` suffix, and the models docs (zh + en) note the free variants, their zero cost, and OpenRouter's free-tier rate limits and data policy.
