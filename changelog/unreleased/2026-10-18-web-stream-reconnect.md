# The transcript stops spinning after a server restart, and a refused stream id is not offered again

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1198](https://github.com/Prism-Shadow/penguin-harness/pull/1198)

[中文版](2026-10-18-web-stream-reconnect.zh.md)

Opening a Session after the server restarted no longer leaves its transcript spinning forever, and the output stream no longer reconnects with the session id the server has just refused.

## Details

- `loading` — the flag the consumer renders its skeleton from — is settled in `load()`'s own `finally` instead of on the two "clean" exits it used to be cleared on. `load()` has five more early `return`s (an epoch bumped by a rebuild mid-flight, a disposed controller, the replay loop handing the rest to a newer round), and every one of them left the flag at true: a spinner that never ended, with no error and no retry entry point. A pending-load count decides which round owns the flag: a superseded round does not clear it while a newer load is still fetching its history, and the last round to settle clears it exactly once. A disposed controller skips the update, as nothing is on screen to settle.
- A `resync_required` event voids the stream's remembered event id until a new connection has actually been opened, so the reconnect arrives as a fresh subscription instead of offering the id the server just refused. Recording resumes once a connection is granted, which makes the reconnect after that one resumable as before. Ids still arriving on the refused connection are not recorded either — a real `EventSource` reports the last id it saw on every frame, pings included.
