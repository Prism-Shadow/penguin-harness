# The terminal resync test stopped reading screen residue

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`, `ci`
- **PR:** [#516](https://github.com/Prism-Shadow/penguin-harness/pull/516)

[中文版](2026-08-27-terminal-resync-flake.zh.md)

`terminal stream backpressure > resyncs a lagging viewer with a fresh Restore instead of
disconnecting it` failed five times in one day on macOS CI, on five pull requests that touched no
terminal code, and passed on every rerun. Its resync assertion read a marker the flood prints once
at the end, which is only still on a 24-row screen if the server happened to take its snapshot
after the burst settled — an instant the test does not get to choose. The assertion was rewritten
to read what a resync actually promises, and the two mechanics that turned one such flake into a
minutes-long hard failure were removed with it.

## Details

- The resync Restore is now asserted to be the self-contained repaint `renderRestoreAnsi` emits —
  reset, leave the alternate buffer, clear screen and scrollback — carrying consecutive rows of the
  burst's own fill line. Both hold at every instant the viewer's socket can drain past the low
  watermark at, mid-burst included; the `BURST-DONE-` tail marker held only after it settled. What
  the test pins did not change: the server still has to mark the paused viewer as lagging, the
  socket still has to be `OPEN` rather than disconnected, a second Restore still has to arrive, and
  the stream still has to carry live output afterwards.
- Lag detection was scoped to the attempt that is running. The suite's captured server log outlives
  a single attempt and vitest retries this file on macOS, so a second attempt read the first one's
  `pausing for resync` line, skipped the flood loop altogether, and then sat out a 60-second
  deadline waiting for a resync on a terminal nothing had ever flooded.
- The stream client is closed in a `finally`. A failing assertion used to skip the inline `close()`
  and leave the socket attached, so `server.close()` in `afterAll` never called back and the run
  reported a 10-second hook timeout stacked on top of the real failure.
- The burst is paused with `ws.pause()` instead of a pause on the socket underneath it. `ws` pauses
  that socket on its own whenever its receiver backs up and resumes it again on the receiver's
  `drain`, respecting only a pause the caller asked for.
