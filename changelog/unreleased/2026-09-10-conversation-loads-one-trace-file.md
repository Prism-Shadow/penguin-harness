# A conversation opens on its newest Trace file, and loads earlier ones on demand

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#664](https://github.com/Prism-Shadow/penguin-harness/pull/664)

[中文版](2026-09-10-conversation-loads-one-trace-file.zh.md)

Opening a conversation in the Web App used to fetch a tail window of 200 Tasks, which for nearly every real Session meant reading and rendering every Trace file at once. It now loads one Trace file at a time: the newest file on open — one file is one model context, the part the model itself still sees — and one more per click of a load-earlier button at the top of the message stream.

## Details

- The conversation page opens on the newest Trace file alone, so a months-long Session opens as fast as a fresh one. The top of the stream carries a **Load earlier messages** button, with **(N segments left)** appended while more than one file remains; each click prepends exactly one file and holds the reading position across the prepend. Nothing loads on scroll any more — a file can hold a whole context's worth of tool output, so paying for it is the reader's choice. The beginning of the transcript is marked once nothing older remains, and a failed load becomes a click-to-retry row.
- `GET /api/sessions/:sessionId/messages` takes a new `unit=task|file` query param beside the existing `tailLimit=n` and `before=<fileIndex>:<ordinal>&limit=n` window forms: `task` (the default) keeps the Task-aligned cut, and `file` makes a unit a whole Trace file — the window opens with that file's own `session_meta` header, its `before` cursors are `<fileIndex>:0`, and `before` without `limit` defaults to one file. The `page` envelope gains `earlierFiles`, the number of Trace files that begin before the window and the count the button shows.
- A compaction that fires mid-run rotates the file, and the new file resumes with the `[context_summary]` injection and the next Request, with no user prompt of its own. The server folds the elapsed, API and tool time of the Task still open at the boundary into that window's `prior`, and the Web reducer opens a round at the continuation's first record so it gets its own stats footer. The cut Task renders as one round per file with the compaction banner between them, and the Session totals add up exactly as they do on a full load.
- Resync after a long disconnect keeps the loaded earlier files only when the refetched newest file starts at the same cursor — true until a compaction rotates the file. When it did rotate, the newest file alone is adopted and the loaded earlier files are dropped (a click brings them back) instead of refetching the whole transcript.
- The parameterless full read is unchanged, so the CLI (`logs`, `--resume`) and any other consumer of the complete history keep the response they had.
- The server API and Web App docs describe the window forms, the `page` envelope and the file-by-file loading of the conversation page.
