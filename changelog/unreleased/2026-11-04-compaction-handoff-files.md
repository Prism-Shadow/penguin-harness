# Compaction writes hand-off files before its summary

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `amsp`, `server`, `web`, `docs`

[中文版](2026-11-04-compaction-handoff-files.zh.md)

A `summarize` compaction may now take up to `compaction.max_rounds` tool rounds (default 3) before its summary. The new default compaction prompt asks the model to write detail worth more than a paragraph (a plan, findings, a decision log, drafts) to files under its Session's scratchpad, `<scratchpad>/handoff/`, and then to reply with a summary in fixed sections: request, decisions and constraints, progress, errors and fixes, files, next steps. The summary handed to the next context ends with the path of the Trace file the compaction closed and how to query it line by line.

## Details

- In a round the model may call `read_file`, and `write_file` / `edit_file` on an absolute path inside its Session's scratchpad. Any other call is answered with a `fatal` `[tool error]` naming what is allowed, without being run or asked about. An allowed call goes through the Session's approval mode like any other: under `always-ask` the user approves each hand-off write, on the compaction row's Work section in the Web App.
- The round's outputs are the next request's whole input, on the same model object, so each request still extends the cached prefix. Each round re-reads the whole context at the cache-read price: three rounds at a 250k context add about 0.75 M cache-read tokens per compaction. `max_rounds: 0` restores the single text-only request and its cost.
- Rounds do not count against the five-attempt retry budget. Once they are spent, a response with tool calls is rejected as before.
- The `[context_summary]` block ends with a short trailer: the closed Trace file's path, where its earlier files are, and the guidance to list matching line numbers first (`rg -n -o` / `grep -n -o`, or `Select-String … .LineNumber` in PowerShell, worded for the Session's shell) and then read only those lines with `read_file` `offset` / `limit`, never the whole file. A model switch's Trace handoff (`[model_switch_from]`) carries the same guidance.
- Between `compaction_begin` and `compaction_end` the stream now also carries each compaction request's `request_begin` / `request_end` and the rounds' tool calls, approval decisions and outputs. The compaction prompt, the repairs of a rejected response and the corrective note stay in the Trace only.
- The Web App's compaction row lists the rounds in a Work section, one tool row per call; its Result section shows the last request's text. The CLI prints nothing new.
- Resume takes the summary from the closing span's last completed request and rebuilds the trailer from the file's own path. A fork rewrites the hand-off file paths and the trailer's Trace path in its summaries to the fork's own copies.
- The kernel moves to `2026-11-04` on the runtime tab (`compaction.max_rounds` and the new prompt). Existing agents keep their stored prompt until a kernel update; their config has no `max_rounds`, which reads as 3.
