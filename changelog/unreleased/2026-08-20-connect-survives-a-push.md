# A machine connect in flight now survives a hot push

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`

Connecting to a machine can take minutes — it may be installing a Node runtime on the far
side — and a platform push landing in the middle of it used to be the end of that work: the
new App knew nothing about the connect, and the old App's job kept running with nobody
reading it.

The connect is now parked state, like the sandbox settings and the workflow refs: the
machine, its options and its progress log ride the swap in the platform document, and the
new App picks the connect up and runs it to completion. Re-running is safe and cheap
because every step is idempotent by design — "connect means make it so" — so a matching
version skips the install, a live server is used as is, and a live tunnel is adopted. The
window polling for progress sees one continuous job with its history intact, not a blank
restart.

The tunnels themselves were already delivered rather than closed (the ssh processes must
outlive the swap, or every window looking at that machine drops), and the old App's exit
handlers are detached so a dead generation stops mutating the state file the new one
adopts from.

The `connect` field is omitted whenever no connect is running, so an ordinary push parks
exactly the document it always did.
