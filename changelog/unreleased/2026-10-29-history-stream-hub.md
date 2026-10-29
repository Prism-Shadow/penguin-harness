# The hub keeps a copy of its machines' Trace lines and streams a remote conversation's history from it

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1392](https://github.com/Prism-Shadow/penguin-harness/pull/1392)

[中文版](2026-10-29-history-stream-hub.zh.md)

A server that connects machines kept a copy of the Trace lines each machine sent it, under `<data root>/machines/traces/`, and answered a remote conversation's history from that copy as a stream with progress. A conversation opened again asked the machine only for the lines it did not hold yet, and a machine on an older build still loaded its history.

## Details

- `GET /api/sessions/:id/history` streamed a window as whole-record lines with its bulky values elided, under the same query as `/messages` (`tailLimit`, `before` and `limit`, none for the whole transcript) plus `budget` and `fill=1`. Each event carried `<windowId>:<offset>` as its id, and a stream issued again with that id within two minutes continued the same window, for the same Session, user and query only. Every failure ended the stream with an `error` event, and an HTTP stream ended when its user was signed out. A local Session was answered from its own Trace.
- For a machine's Session, the hub asked the machine's `history-lines` route over the API socket, committed whole lines into a byte-exact copy, and assembled the window from it. One sync job per conversation ran one machine stream at a time: a window or a body went first and the background fill gave way to it, and a fill ended once nobody stayed for it. A stream that moved was reopened from the copy at once; one that did not, and a machine that was away, were retried from 1 s doubling to 30 s with the wait reported as `progress.waiting`. The last reader leaving cancelled the machine stream at once, and a replaced server generation ended its streams without an error so their readers asked again.
- Each file's `have` named every run held and a line held in part, and a conversation's whole `have` stayed within the machine's limit, its own files first. A copy that could not be written did not stop a read: the window was assembled from the stream itself.
- The copy was checked on every open: a file that the machine had rewritten or replaced started over, and one the machine no longer listed was dropped. Its directories were named by hashes of the ids. It was capped at 1 GiB, counting each file up to its highest offset held and evicting the least recently read conversations first. A machine's copy was dropped when the machine was uninstalled with its data, and at the next start once the machine was no longer in this server's list; nothing was dropped at start while the ssh config could not be read.
- `GET /api/sessions/:id/trace-body?ref=` sent one elided value whole, from the copy or after fetching its line, with one progress total. Images by reference, and the Trace panel's events of a rotated file held whole, were answered from the copy too; a Project-scoped Trace path for another Project found nothing. Everything else, the live file's events included, was forwarded to the machine as before.
- A machine without `history-lines`, or one this server held no API socket to, had its window read from its `/messages` over HTTP inside the same stream, with the bytes counted as they arrived and nothing cached. A machine that turned this server's session away ended the stream with `machine_refused`, one being upgraded was waited for, and one no longer in this server's list ended it with `machine_not_found`.
