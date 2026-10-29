# The hub keeps a copy of its machines' Trace lines and streams a remote conversation's history from it

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`

[中文版](2026-10-29-history-stream-hub.zh.md)

A server that connects machines kept a copy of the Trace lines each machine sent it, under `<data root>/machines/traces/`, and answered a remote conversation's history from that copy as a stream with progress. A conversation opened again asked the machine only for the lines it did not hold yet, and a machine on an older build still loaded its history.

## Details

- `GET /api/sessions/:id/history` streamed a window as whole-record lines with its bulky values elided, under the same query as `/messages` (`tailLimit`, `before` and `limit`, none for the whole transcript) plus `budget` and `fill=1`. Each event carried `<windowId>:<offset>` as its id, and a stream issued again with that id within two minutes continued the same window. A local Session was answered from its own Trace.
- For a machine's Session, the hub asked the machine's `history-lines` route over the API socket, committed whole lines into a sparse byte-exact copy, and assembled the window from it. One sync job per conversation ran one machine stream at a time: a window or a body went first and the background fill gave way to it. A stream silent for 15 s was cut and reopened from the copy, a machine that was away was retried from 1 s doubling to 30 s with the wait reported as `progress.waiting`, and the last reader leaving cancelled the machine stream at once.
- The copy was checked on every open: a file that the machine had rewritten or replaced started over, and one the machine no longer listed was dropped. It was capped at 1 GiB, evicting the least recently read conversations first, and a machine's copy was dropped when it was uninstalled with its data or no longer in this server's list.
- `GET /api/sessions/:id/trace-body?ref=` sent one elided value whole, from the copy or after fetching its line. Images by reference and the Trace panel's events of a whole file were answered from the copy as well. Everything else was forwarded to the machine as before.
- A machine without `history-lines` had its window read from its `/messages` over HTTP inside the same stream, with the bytes counted as they arrived and nothing cached.
