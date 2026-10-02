# Long conversations and long Trace files open without stalling

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `server`, `docs`

[中文版](2026-10-03-load-performance.zh.md)

A long conversation, and a long Trace file in the Trace panel, no longer stall the page while
they load. The chat opens on fewer Tasks, a history page is bounded in bytes and carries its
pictures as links, and the Trace panel reads one round at a time instead of the whole file.

## History window

- A conversation opens on its newest 20 Q&A pairs (was 50), and each scroll to the top loads 20
  more (was 50).
- A windowed history page (`GET /api/sessions/:sessionId/messages` with `tailLimit` or `before`)
  also stops before the Task that would take it past 4 MiB of serialized messages, but always
  holds at least one Task. A page cut short carries its `before` cursor like any other.

## Trace panel

- Opening the panel requests the file's analysis only. The newest round opens expanded; the
  others stay collapsed and read their own events, by message range, when expanded.
- The panel draws the newest 50 round cards, with an "N earlier rounds" control that shows 50
  more. During a run it re-reads only the expanded rounds whose range grew.
- The analysis carries the head `session_meta`'s `modelContextWindow`, which the context ring
  reads.

## Trace events endpoint

- The Trace event reads (`GET /api/projects/:projectId/agents/:agentId/traces/:sessionId/:index`
  and `GET /api/sessions/:sessionId/traces/:index`) serve each page from a per-file line index
  (record byte offsets, kept for 32 files and extended as a file grows) with one ranged read,
  instead of parsing the whole file for every page.

## Images by reference

- A windowed history page replaces each PNG, JPEG, GIF or WebP `data:` URL of a main-session
  record (a user's `image_url`, or an entry of a tool output's `images`) with
  `/api/sessions/:sessionId/trace-image?file=<fileIndex>&ordinal=<ordinal>[&i=<k>]`. The new route
  decodes that image from the Trace record and answers it with an immutable private cache.
  Subagent messages, held inputs not yet in the Trace, other image types and the parameterless
  full read keep their `data:` URLs.
- The chat fetches these images from the machine the Session lives on, and only as they near the
  viewport. An image the stream delivered inline while the page was being read still shows once.
