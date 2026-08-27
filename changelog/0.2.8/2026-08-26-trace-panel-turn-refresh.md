# The Trace panel refreshes when a turn ends

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#492](https://github.com/Prism-Shadow/penguin-harness/pull/492)

[中文版](2026-08-26-trace-panel-turn-refresh.zh.md)

The Trace dock panel used to fetch only when its tab became visible, so a Trace opened while the
Session kept working stayed at the size and the contents it had been read at. It was hooked up to
the settled-turn signal the Files panel already reads: a turn ending while the Trace tab is
showing re-lists the Session's Trace files and re-reads the selected one.

## Details

- The chat page's settled-turn counter — bumped on the `running` → `idle` edge of the selected
  Session, and guarded against the phantom `idle` a detaching stream emits — was handed to the
  Trace panel beside the Files browser, and renamed for its two readers.
- A settled turn arriving while the tab is hidden fetched nothing. The hidden → visible edge kept
  its own re-fetch, so the panel came up current on return whatever went by in between, in one
  request rather than one per turn.
- A re-list left the selection alone: the pill the user had clicked survived while its file was
  still listed, and a selection whose file had vanished fell back to the newest one. The default
  was pinned to the newest file the moment the first listing arrived, rather than left to resolve
  itself on every re-list — unpinned, a compaction shard appearing mid-run would have walked a
  reader who had never clicked a pill onto the new file.
- The selected file's contents were re-read on the same edge. A Trace file is appended to while
  the Session runs, so the ordinary refresh is the same file grown rather than a new file
  appearing, and a load keyed on the file's index alone never re-ran for it.
- Refreshing the file already on screen stopped clearing the view: the skeleton, the collapsed
  round cards and the pinned timeline row are dropped only when a different file is selected.
- A refresh that failed kept what was on screen. The failed re-list reported itself as a strip
  above the file pills and the failed re-read as a line above the file's summary, both leaving
  the panel below them standing; only a load with nothing to keep yet — no listing, or a listing
  with no file in it — gave the whole panel over to the failure. With no manual refresh control
  to fall back on, an emptied panel would have stood until the next turn ended.
- The project's model catalog moved to a fetch of its own, keyed on the project. Pricing is a
  catalog the project owns rather than something a turn produces, so it stopped riding along with
  the selected file's load and a refresh went from three requests to two.
