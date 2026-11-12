# Compaction hands files to the next context and always opens it; a refused request hands off too

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `core`, `amsp`, `server`, `web`, `cli`
- **PR:** [#1491](https://github.com/Prism-Shadow/penguin-harness/pull/1491)

[中文版](2026-11-11-compaction-never-gives-up.zh.md)

A `summarize` compaction can now save detail worth more than a paragraph to hand-off files under its Session's scratchpad, in the same reply as its summary or in tool rounds that the harness counts: the prompt aims at about three, and `compaction.max_rounds` (default 8) is the hard cap. The summary is written in fixed sections and ends with the path of the Trace file the compaction closed and how to query it. A compaction that has started no longer gives up: the next context opens with the full summary, with a summary cut off before its end, or with a hand-off note the harness builds from the Trace file. The old context is kept only when the user stops the compaction or when no next context can be opened at all. A request the provider refuses as sent, on a context that has completed a turn, no longer ends the run: the context is handed off with that note and the Task carries on.

## Hand-off files and rounds

- The new default compaction prompt asks for a summary in six sections (request, decisions and constraints, progress, errors and fixes, files, next steps) and for hand-off files under `<scratchpad>/handoff/`, written with `write_file` / `edit_file` in the same reply as the summary when the model can, each under a new name so none has to be read first. It asks the model to finish within about three tool rounds and names no limit. Its one placeholder is `{{SCRATCHPAD_DIR}}`.
- During a compaction the model may call `read_file`, and `write_file` / `edit_file` on an absolute path inside its Session's scratchpad. Any other call is answered with a `fatal` `[tool error]` without being run or asked about. An allowed call goes through the Session's approval mode like any other call.
- The harness counts the rounds. After each round's outputs it appends one line saying how many rounds are used; from the third round on, the line asks for the summary now and says how many more rounds the harness runs. Once none is left, or the context has reached `context_window − 12288`, or `max_rounds` is `0`, every further call is refused with `[tool error] no tool round is left in this compaction; reply with the summary`.
- A reply that holds a tagged summary and also calls tools ends the compaction in that one request: its calls are answered and nothing more is sent to the old model.
- A reply that advanced nothing (no summary, calls that were all refused, or a reply cut at the output limit) is asked again at once with one corrective line, at most twice. Transport failures retry on `compactionMaxReconnects` (default 5). A compaction request refused over an image is sent again with the image replaced and recorded `retryable` / `image_rejected`, as a turn's is.
- A summary closed with a mixed-bracket tag (`[/summary>` or `</summary]`) is read as closed, and a stray one no longer rides into the next context.
- Under the summary the harness lists the compaction's tool calls with their outputs (the last 12 at most), so the next context sees which hand-off writes actually succeeded. The `[context_summary]` block then names the closed Trace file, where its earlier files are, and how to list matching line numbers before reading only those lines with `read_file` `offset` / `limit`, worded for the Session's shell. A model switch's `[model_switch_from]` block carries the same guidance.

## When no full summary can be had

- The next context opens with the longest summary a cut-off reply wrote, when it holds at least 400 characters inside the `[summary]` tag, marked as cut off. Without one it opens with a hand-off note that quotes the compacted context's first user message and its last eight, the last completed turn and the compaction's tool calls, within 4,000 tokens, and points at the Trace file. When the provider refused a request, the note also quotes its error and tells the model not to rebuild the same input. Building the note makes no model call and cannot fail.
- A compaction request the provider refuses, whatever the code (an unauthorised or unavailable compacting model included), takes the same fallback at once.
- Such a compaction ends `compaction_end{status: completed}` carrying the unified error pair (`error_code` / `error_message`) of the last failure. Replay reads that pair to rebuild the same opening from the file. A completed end without the pair replays as before.
- A model switch whose summary cannot be had opens the target with a salvaged summary when there is one, and otherwise with its `[model_switch_from]` block, as before.
- The next context is opened before `compaction_end` is written, so the Trace never records a completed compaction for a context that does not exist. When the Agent State cannot be read at a same-model rotation, the next context reopens the configuration in force, one line goes to stderr and the opening carries a harness notice that tells the model to fix `system_config.yaml`. When no next context can be opened, the compaction ends `fatal`, the old context stays current, and a run in the middle of a Task ends with `RunCutoff{kind: "compaction_failure"}`. A model switch in that case keeps its model, and `session.switchModel` returns `fatal` instead of throwing.

## A refused request hands off

- A definitive provider 4xx is now classified by its HTTP status: 400, 413, 415 and 422 are `rejected` (the request as sent was refused); every other one (402, 403, 404, …) gets the new `error_code` `denied` (the provider will not serve this account or model). 401 stays `auth`; 408 and 429 are retried as before.
- An ordinary request refused `rejected` on a context that has completed a turn, with no image in its input, no longer ends the run. The attempt is recorded `request_end{retryable, error_code: rejected, retry_in_ms: 0}`, the context is closed by a compaction pair that holds no request (`compaction_end{completed}` with the provider's error and no `attempt`), and the next context opens with the hand-off note. The same turn is sent again behind the note, with the refused input's text only: it does not count against `max_turns`. This happens whatever `compaction.mode` is and whether or not the threshold is switched off, at most three times per run.
- A refusal of a context's first request, a fourth refusal in one run, and every `denied`, `auth`, `unsupported` or `invalid_input` request still end the run and keep the context. A refused request whose input holds an image is first sent again with the image replaced, and hands off only if it is refused again. When the next context cannot be opened, the run ends with `RunCutoff{kind: "compaction_failure"}` on the kept context.

## Threshold

- The effective compaction threshold became `min(max_context_length, context_window − reserve)` with `reserve = min(clamp(context_window / 8, 8192, 32768), context_window / 2)`, replacing the fixed 2048. Models whose window binds the threshold compact earlier: a 200k window at 175,000 instead of 197,952, an entry with no window at 112,000 instead of 125,952, a 32k window at 24,576 instead of 30,720, a 262k window at 229,376 instead of 256,000. Windows of 288,768 tokens and more are unchanged. The Web App's context ring moves with the threshold.

## Stream, Web App, CLI and server

- Between `compaction_begin` and `compaction_end` the stream now carries each compaction request's `request_begin` / `request_end`, its thinking and text, and every tool call with its approval decision and output, whether it ran or was refused. The compaction prompt, the round lines and the corrective lines stay in the Trace only. The opener's MCP connect pair and `tool_list_ready` follow `compaction_end`.
- The Web App's compaction row lists the calls in a Work section; a refused call is a failed work card. A full completion shows the summary in its Result section. A completion without a full summary has one presentation: the title stays 压缩完毕 / "Compacted", there is no Result section, and the status icon turns to the attention tone with a tooltip saying the next context opens with what was written of the summary or with a Trace hand-off note, and why. A `fatal` end says the next context could not be opened and the current one is kept.
- When too little room was left for the compaction (`error_code` `rejected`, or `output_truncated`), the tooltip advises correcting the model's context window or lowering the compaction threshold, with the provider's own words when it refused. On a refusal the composer also shows a notice with **Open agent settings**, in the place of the small-window notice; it goes away when dismissed or after a later compaction that ends otherwise.
- A refused request that hands off shows as one "[Retried]" line (the provider rejected the request) with no error banner, and the Task stays open. A `fatal` end settles a retry line still waiting. `denied` has its own cause wording in the retry and error lines of the Web App and the CLI.
- The CLI's completion line gains "(no full summary: what was written of it, or a Trace hand-off — <reason>)", followed by the same room advice when too little room was left, and its `fatal` line says the context was kept.
- The server records a completion without a full summary as `compaction_degraded` (expected), one that answered a refused request as `context_refused` (expected, naming the window to correct), and a `fatal` end as `compaction_failed` (unexpected). The refused ordinary request itself is recorded as `llm_retried`, never `llm_fatal`; a `denied` request is `llm_fatal`. A call the harness refused during a compaction is no longer recorded as a tool failure.
- A fork rewrites the hand-off file paths, including their JSON-escaped spelling inside quoted call arguments, and the Trace path in its summaries and hand-off notes to the fork's own copies.

## Behaviour changes

- Window-bound models compact earlier, as listed under Threshold.
- A compaction whose summary fails no longer ends the run or leaves the context in place to be tried again: the conversation continues in a new context that opens with a cut-off summary or the hand-off note. Only a stop, or a next context that cannot be opened, keeps the current context.
- A request refused with HTTP 400, 413, 415 or 422 in the middle of a conversation no longer stops the run: the context is handed off and the Task carries on. A 402, 403 or 404 reads as `denied` instead of `rejected` and is no longer sent again without its images.
- A compaction that calls tools no longer has its reply rejected: the calls are answered or refused and the compaction carries on.
- A broken `system_config.yaml` no longer ends a run at a rotation; the next context reopens the configuration in force.

## Kernel

- The kernel moved to `2026-11-11` on the runtime tab (`compaction.max_rounds` and the new prompt). An unedited runtime tab advances on the next kernel update; an edited one is kept. A stored prompt keeps working, and a config without `max_rounds` reads it as 8.
