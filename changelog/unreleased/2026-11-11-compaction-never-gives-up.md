# Compaction hands files to the next context and always opens it; a refused request hands off too

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `core`, `amsp`, `server`, `web`, `cli`
- **PR:** [#1491](https://github.com/Prism-Shadow/penguin-harness/pull/1491)

[中文版](2026-11-11-compaction-never-gives-up.zh.md)

A `summarize` compaction can now save detail worth more than a paragraph to hand-off files under its Session's scratchpad, in the same reply as its summary or in tool rounds that the harness counts. Its flow is one rule, and the three texts it uses are in the Agent's `system_config.yaml`: the harness sends `compaction.prompt`; a reply that is not the summary has its tool calls answered and is followed by `compaction.reminder`, at most `compaction.max_rounds` times (default 8); when the summary comes, the next context opens with it and one line naming the closed Trace file; when it does not, the next context opens with `compaction.handoff_note`, filled from that Trace file. A compaction that has started no longer gives up: the old context is kept only when the user stops the compaction or when no next context can be opened at all. A request the provider refuses as sent, on a context that has completed a turn, no longer ends the run: the context is handed off with the same note and the Task carries on.

## The flow and its three texts

- The new default `compaction.prompt` asks for a summary in six sections (request, decisions and constraints, progress, errors and fixes, files, next steps) and for hand-off files under `<scratchpad>/handoff/`, written with `write_file` / `edit_file` in the same reply as the summary when the model can, each under a new name so none has to be read first. It asks the model to finish within about three tool rounds and names no limit.
- During a compaction the model may call `read_file`, and `write_file` / `edit_file` on an absolute path inside its Session's scratchpad. Any other call is answered with a `fatal` `[tool error]` without being run or asked about. An allowed call goes through the Session's approval mode like any other call.
- A committed reply is the summary or it is not. One that is not, while fewer than `max_rounds` replies have been answered, has its calls answered, followed by `compaction.reminder` (by default `Tool round {{ROUNDS_USED}} done. Reply with the summary as soon as the hand-off files are written.`); an empty reply, or one whose calls were all refused, uses a round too. Once the rounds are used up, a call is answered with `[tool error] the compaction request expects a summary, not tool calls`, and a reply that is still not the summary ends the compaction with the hand-off note. A reply that holds a closed summary and also calls tools ends the compaction in that one request: its calls are answered and nothing more is sent to the old model.
- Transport failures retry on `compactionMaxReconnects` (default 5). A compaction request refused over an image is sent again with the image replaced and recorded `retryable` / `image_rejected`, as a turn's is. Nothing else is sent again: a reply cut at the output limit, a refusal and a spent ladder end the compaction with the hand-off note.
- A summary closed with a mixed-bracket tag (`[/summary>` or `</summary]`) is read as closed, and a stray one no longer rides into the next context.
- The `[context_summary]` block holds the summary, a blank line and `Trace file of the compacted context (JSONL, one record per line): <path>`. How to query that file is the business of the `trace-lookup` Skill (see [the trace-lookup plugin](2026-11-12-trace-lookup-skill.md)); neither the line nor the note names it.
- The harness fills `{{SCRATCHPAD_DIR}}` in all three texts, `{{ROUNDS_USED}}` and `{{ROUNDS_LEFT}}` in `reminder`, and `{{ERROR}}`, `{{USER_MESSAGES}}`, `{{LAST_TURN}}` and `{{TRACE_PATH}}` in `handoff_note`; a placeholder with nothing to quote reads `(not recorded)`. A blank `reminder` sends a round's tool outputs alone, and a blank `handoff_note` gives the quoted data alone. A compaction uses the section as read at the checkpoint that started it.

## When no full summary can be had

- The next context opens with the hand-off note. The default `compaction.handoff_note` says why there is no summary, in the provider's words when it refused a request, and not to rebuild the same input; quotes the compacted context's first user message and its last three, cut at 1,500 characters, and the last completed turn's text with its last four tool calls and outputs, cut at 500; names the Trace file and the hand-off directory; and asks the model to carry on. Building it makes no model call and cannot fail.
- A compaction request the provider refuses, whatever the code (an unauthorised or unavailable compacting model included), and a reply cut at the output limit, take this fallback at once.
- Such a compaction ends `compaction_end{status: completed}` carrying the unified error pair (`error_code` / `error_message`) of the last failure. Replay reads that pair to rebuild the note from the file, with the `handoff_note` in force at resume. A completed end without the pair replays as before.
- A model switch whose summary cannot be had opens the target with its `[model_switch_from]` block, as before.
- The next context is opened before `compaction_end` is written, so the Trace never records a completed compaction for a context that does not exist. When the Agent State cannot be read at a same-model rotation, the next context reopens the configuration in force and one line goes to stderr. When no next context can be opened, the compaction ends `fatal`, the old context stays current, and a run in the middle of a Task ends with `RunCutoff{kind: "compaction_failure"}`. A model switch in that case keeps its model, and `session.switchModel` returns `fatal` instead of throwing.

## A refused request hands off

- A definitive provider 4xx is now classified by its HTTP status: 400, 413, 415 and 422 are `rejected` (the request as sent was refused); every other one (402, 403, 404, …) gets the new `error_code` `denied` (the provider will not serve this account or model). 401 stays `auth`; 408 and 429 are retried as before.
- An ordinary request refused `rejected` on a context that has completed a turn, with no image in its input, no longer ends the run. The attempt is recorded `request_end{retryable, error_code: rejected, retry_in_ms: 0}`, the context is closed by a compaction pair that holds no request (`compaction_end{completed}` with the provider's error and no `attempt`), and the next context opens with the hand-off note. The same turn is sent again behind the note, with the refused input's text only: it does not count against `max_turns`. This happens whatever `compaction.mode` is and whether or not the threshold is switched off, at most three times per run.
- A refusal of a context's first request, a fourth refusal in one run, and every `denied`, `auth`, `unsupported` or `invalid_input` request still end the run and keep the context. A refused request whose input holds an image is first sent again with the image replaced, and hands off only if it is refused again. When the next context cannot be opened, the run ends with `RunCutoff{kind: "compaction_failure"}` on the kept context.

## Threshold

- The effective compaction threshold became `min(max_context_length, context_window − reserve)` with `reserve = min(clamp(context_window / 8, 8192, 32768), context_window / 2)`, replacing the fixed 2048. Models whose window binds the threshold compact earlier: a 200k window at 175,000 instead of 197,952, an entry with no window at 112,000 instead of 125,952, a 32k window at 24,576 instead of 30,720, a 262k window at 229,376 instead of 256,000. Windows of 288,768 tokens and more are unchanged. The Web App's context ring moves with the threshold.

## Stream, Web App, CLI and server

- Between `compaction_begin` and `compaction_end` the stream now carries each compaction request's `request_begin` / `request_end`, its thinking and text, and every tool call with its approval decision and output, whether it ran or was refused. The compaction prompt and the reminders stay in the Trace only. The opener's MCP connect pair and `tool_list_ready` follow `compaction_end`.
- The Web App's compaction row lists the calls in a Work section; a refused call is a failed work card. A full completion shows the summary in its Result section. A completion without a full summary has one presentation: the title stays 压缩完毕 / "Compacted", there is no Result section, and the status icon turns to the attention tone with a tooltip saying the next context opens with a Trace hand-off note, and why. A `fatal` end says the next context could not be opened and the current one is kept.
- When too little room was left for the compaction (`error_code` `rejected`, or `output_truncated`), the tooltip advises correcting the model's context window or lowering the compaction threshold, with the provider's own words when it refused. On a refusal the composer also shows a notice with **Open agent settings**, in the place of the small-window notice; it goes away when dismissed or after a later compaction that ends otherwise.
- A refused request that hands off shows as one "[Retried]" line (the provider rejected the request) with no error banner, and the Task stays open. A `fatal` end settles a retry line still waiting. `denied` has its own cause wording in the retry and error lines of the Web App and the CLI.
- The CLI's completion line gains "(no full summary: a Trace hand-off note — <reason>)", followed by the same room advice when too little room was left, and its `fatal` line says the context was kept.
- The server records a completion without a full summary as `compaction_degraded` (expected), one that answered a refused request as `context_refused` (expected, naming the window to correct), and a `fatal` end as `compaction_failed` (unexpected). The refused ordinary request itself is recorded as `llm_retried`, never `llm_fatal`; a `denied` request is `llm_fatal`. A call the harness refused during a compaction is no longer recorded as a tool failure.
- A fork rewrites the hand-off file paths, including their JSON-escaped spelling inside quoted call arguments, and the Trace path in its summaries and hand-off notes to the fork's own copies.

## Behaviour changes

- Window-bound models compact earlier, as listed under Threshold.
- A compaction whose summary fails no longer ends the run or leaves the context in place to be tried again: the conversation continues in a new context that opens with the hand-off note. Only a stop, or a next context that cannot be opened, keeps the current context.
- A request refused with HTTP 400, 413, 415 or 422 in the middle of a conversation no longer stops the run: the context is handed off and the Task carries on. A 402, 403 or 404 reads as `denied` instead of `rejected` and is no longer sent again without its images.
- A compaction that calls tools no longer has its reply rejected: the calls are answered or refused and the compaction carries on.
- A broken `system_config.yaml` no longer ends a run at a rotation; the next context reopens the configuration in force.

## Kernel and stored configuration

- The kernel moved to `2026-11-12` on the runtime tab: `compaction.max_rounds`, `compaction.reminder`, `compaction.handoff_note` and the new prompt. An unedited runtime tab advances on the next kernel update; an edited one is kept.
- Stored configs are not migrated. A config without `max_rounds`, `reminder` or `handoff_note` reads each as its default, and a stored `prompt` the user edited is used as written.
