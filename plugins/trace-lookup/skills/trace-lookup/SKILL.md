---
name: trace-lookup
description: Look up what happened earlier in a conversation from its Trace file (JSONL under traces/) when a [context_summary] or [model_switch_from] block names one or a detail the summary dropped is needed — search for line numbers, then read only those lines.
version: 2026.11.12.1
---

# Trace Lookup

A Trace file is the full record of one model context: every message, tool call, tool output and harness event, one JSON record per line. Use it to recover an exact detail — a command, an error text, a path, what the user said — that is no longer in your context.

## Before you start

If the user's message only invokes this skill without a concrete question, ask what they want looked up.

## Where the files are

`<app_data_dir>/agents/<agent_id>/traces/<yyyy-mm-dd>/<session_id>_<NNN>.jsonl`

- One file per model context. `NNN` counts up (`_001`, `_002`, …) each time the Session's context is compacted or its model is switched. The file a `[context_summary]` or `[model_switch_from]` block names is the context you continue from; earlier ones have the same name with a lower number, in the same or an earlier date folder.
- The highest number under your own Session ID is the file being written now: it is this context, already in front of you.
- The other names in `traces/` are this Agent's other Sessions. A Session ID starts with the time it began: `session-<yyyy-mm-dd-hh-mm-ss>-…`.

## Rules

- Never read or `cat` a whole Trace file. A record can be very long (a `write_file` call carries the whole file), and `read_file` cuts each line at 2,000 characters.
- Two steps: list the matching line numbers with a search that prints only the match, then read those lines.
- Read only. Never edit, move or delete a Trace file.

## Step 1: find the lines

Use the form for your shell (the Environment section's `Shell:` line). `<file>` is the Trace path.

| Shell | Command |
| --- | --- |
| bash, zsh, sh | `rg -n -o -F '<pattern>' '<file>'` (or `grep -n -o -F '<pattern>' '<file>'`) |
| pwsh, powershell | `(Select-String -Path '<file>' -SimpleMatch -Pattern '<pattern>').LineNumber` |
| cmd | `powershell -NoProfile -Command "(Select-String -Path '<file>' -Pattern '<pattern>').LineNumber"`, with every `"` of the pattern written as `.` (`role.:.user.,.text`) |

| To find | Pattern |
| --- | --- |
| what the user said (the harness's own lines, such as the compaction prompt and `[context_summary]`, are user text too) | `"role":"user","text"` |
| what you replied | `"role":"assistant","text"` |
| the calls of one tool | `"name":"exec_command","arguments"` (any tool name) |
| tool outputs | `"type":"tool_call_output"` |
| one call and its output | `"tool_call_id":"<id>"`, with the id from the call's line |
| where a compaction began and ended | `"type":"compaction_begin"`, `"type":"compaction_end"` |
| requests that failed | `"type":"request_end","status":"retryable"` (or `"fatal"`) |
| anything you remember | a short piece of the text itself: a file name, an error word. Inside a record a `"` is written `\"` and a line break `\n` |

A pattern that may match hundreds of lines is counted first (`| wc -l`; PowerShell `.Count`) and narrowed.

## Step 2: read them

`read_file` with `file_path` the Trace file, `offset` a line number from step 1 and `limit` 1. When the 2,000-character cut hides what you need, print that part of the line: `sed -n '<N>p' '<file>' | cut -c<from>-<to>` (PowerShell: `@(Get-Content '<file>' -TotalCount <N>)[-1].Substring(<from>, <length>)`).
