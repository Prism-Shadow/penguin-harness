# The Trace view loads every page of a file

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#710](https://github.com/Prism-Shadow/penguin-harness/pull/710)

[中文版](2026-09-12-trace-view-all-events.zh.md)

A long Trace file's later rounds — the compaction round among them, which sits at the end of the
file — showed a timeline with zero messages: the analysis described the whole file and attributed
messages to rounds by index range, while only the first 1000 events were ever fetched, so every
round whose range started past that page had nothing to list. The view pages through the whole
file now, and no round of a loaded file shows an empty message list.

## Details

- `features/traces/trace-events-loader.ts` walks the events endpoint: page after page from offset
  0, each next offset taken from what the previous page actually delivered, ending when the walk
  reaches the latest page's `total`. The total is re-read per page, so a file appended to while
  the walk runs is followed to its new end; a page carrying no events ends the walk, the number
  of requests one walk may make is capped, and the walk resolves with the last page's `total`.
- The file view renders progressively: each page is spliced into the list at its own offset, so
  the start of a long file is readable while the rest arrives. A refresh — the panel re-reads the
  file on every settled turn — therefore updates the list in place rather than dropping it back
  to a single page, and the completed walk trims the list to the length it has just read.
- Switching files, unmounting the panel or a refresh cancels the walk in flight, and a page that
  fails reports its error beside the part already loaded rather than clearing it.
- The footer below the message list changed from "showing first N" to a loading note
  (`Loaded 5 / 12 messages…`), and disappears once every message is on screen.
- `test/trace-events-loader.test.ts` covers the walk against a fake endpoint: a 2500-event file
  paged in three requests, a page shortened by the server's own limit, a file that grew mid-walk,
  a truncated file whose pages run out before its `total`, cancellation between two pages, the
  request cap, and the length the walk resolves with.
