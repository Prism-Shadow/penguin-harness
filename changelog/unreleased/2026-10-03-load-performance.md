# Long conversations and long Trace files open without stalling

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `server`, `docs`
- **PR:** [#958](https://github.com/Prism-Shadow/penguin-harness/pull/958)

[中文版](2026-10-03-load-performance.zh.md)

A long conversation, and a long Trace file in the Trace panel, no longer stall the page while
they load. The chat opens on fewer Tasks, a history page is bounded in bytes and carries its
pictures as links, and the Trace panel reads one turn at a time instead of the whole file.

## History window

- A conversation opens on its newest 20 Q&A pairs (was 50), and each scroll to the top loads 20
  more (was 50).
- A windowed history page (`GET /api/sessions/:sessionId/messages` with `tailLimit` or `before`)
  also stops before the Task that would take it past 4 MiB of serialized messages, but always
  holds at least one Task. A page cut short carries its `before` cursor like any other.

## Trace panel

- Opening a Trace file requests its analysis, then the events of its newest turn only, by that
  turn's message range (at most 1000 events per request), instead of every event in the file.
  The newest turn opens expanded and is scrolled into view; the others stay collapsed with their
  chips and read their own range the first time they are expanded.
- The panel draws the newest 50 turn cards; an "N earlier turns" control above them draws 50
  more per click.
- A refresh during a run re-reads the analysis and only the expanded turns whose range moved,
  keeping their rows on screen until the read lands; a new turn opens expanded only when the
  newest one was open. A turn whose read failed shows the error in place of its rows and is
  retried when reopened or on the next refresh.
- The context ring reads the analysis' new `modelContextWindow` (the window in the file's head
  `session_meta`), and 128k when an older server sends none.
- A turn's events still carry their images inline as `data:` URLs, so a turn holding
  screenshots can weigh megabytes; reading them by reference is left to a follow-up.

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
