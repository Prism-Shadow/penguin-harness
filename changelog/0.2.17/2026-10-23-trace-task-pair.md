# The Trace records where each Task starts and ends

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1299](https://github.com/Prism-Shadow/penguin-harness/pull/1299), [#1304](https://github.com/Prism-Shadow/penguin-harness/pull/1304)

[中文版](2026-10-23-trace-task-pair.zh.md)

Core's Session now writes a `task_begin` / `task_end` pair around every Task, to the Trace and to the stream. Every reader accepts the two records; what the chat, the message window and AMSP show is unchanged. Traces written before this change carry none: see [backward compatibility](2026-10-23-backward-compatibility.md).

## Task records

- Two `event_msg` payloads, `{type: "task_begin"}` and `{type: "task_end"}`, with nothing but the type. How a Task ended is still read from the records inside the pair, and who started it from its input.
- One pair per Task: one Prompt's run plus the `hook` records of the stop hooks consulted after it. A Task a stop hook's `continue` drives, such as a goal round, gets its own pair. A manual compaction and a model switch get none.
- `task_begin` comes before everything the Task writes, its input included; `task_end` comes after the stop hooks' `hook` records. An aborted Task, including one aborted while MCP servers connect, still ends with `task_end`. A Task that throws writes none.
- The Session writes them through its own Trace sink, so a Task record never opens a new Trace file. When a Task ends on a completed compaction, its `task_end` and the next Task's `task_begin` land behind the `compaction_end` in the old file, and the next context's first message opens the new one.
- Resume and the server's context composition decide whether a file was closed by a compaction from its last record that is not a Task record. A restart after such a Task still opens the next context with the pending `[context_summary]`.
- Core exports the builders `taskBegin` and `taskEnd` and the readers `isTaskRecord`, `isTaskBegin` and `lastNonTaskRecord`.
- The pair is the second stated exception to the rule that AMSP takes no new record type (owner decision 2026-10-22).

## Stream order

- The server echoes a run's input right after the run's first `task_begin` instead of before the run starts, so the stream has a Task's records in the order its Trace has them. Every launch path does this: prompts, queued follow-ups, retries, schedules, Workbench runs, organization triggers, messaging and goal starts. `GET /messages` still serves the held input while MCP servers connect.
- A subagent's input, forwarded on the parent's stream, now follows the child's own `task_begin`, as in the child's Trace.

## Readers

- The message window, the Web App's chat stream and outline, the CLI renderer and the AMSP translator ignore the records. Window cuts and counts are unchanged, and so is every AMSP event.
- In the Trace analysis a `task_begin` opens the round its input starts, and no Task record moves a round's end time. A file that ends with Task records alone gains no round.
- A fork cut stops before the next Task's `task_begin`, so a forked Session never ends on an unclosed Task.
- The Trace view lists the two records as event rows with their own icons. The gallery's demo Session carries a pair around each of its Tasks.
- The AMSP Records, Sessions & Traces, Message Flow and AMSP pages document the records and the new echo order.
