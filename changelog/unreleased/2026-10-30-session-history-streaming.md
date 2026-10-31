# Session history loads as frames instead of one whole response

- **Date:** 2026-10-30
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1407](https://github.com/Prism-Shadow/penguin-harness/pull/1407)

[中文版](2026-10-30-session-history-streaming.zh.md)

A large transcript (one measured session: 2,493,866 B across 2,274 messages) answered the history read as a single JSON body, and the client timed out before the body finished arriving. The windowed history read is now answered as NDJSON frames, written line by line so the first frame flushes while the rest is still being built.

A response carries three kinds of frames. A `page` frame holds the window's envelope — the fields the JSON read returned, with the live tail attached on tail reads. `skeleton` frames hold every unit opener of the whole transcript: the plain prompts and the inserted kinds (steering chips, context summaries, in-task background notices) together, so a client fixes every row's position in one pass, and an inserted kind's row lands at its final position immediately instead of being re-inserted later. `meat` frames hold the window's remaining messages in time order, cut only at group boundaries — a tool_call is never separated from its tool_call_output — each frame under a 64 KB soft cap and always holding at least one group.

Every frame carries the cursor that re-enters its window. An interrupted stream resumes through the ordinary windowed-read protocol: the replay carries the frames the client already holds, its dedup drops those, and the sequence continues where the stream stopped. The heaviest measured unit (563 KB, 614 messages, 74 consecutive tool rounds, uncuttable) splits into nine frames of 64–74 KB instead of stalling one response.

The web consumer reads the frames as each line arrives: the skeleton lays out every row at once, and the meat frames fill the placed rows without moving any — a collapsed group's fill only moves its badge count.
