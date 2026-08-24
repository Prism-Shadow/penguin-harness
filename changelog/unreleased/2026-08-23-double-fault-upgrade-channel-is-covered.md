# The double-fault path is covered by tests

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `server`

[中文版](2026-08-23-double-fault-upgrade-channel-is-covered.zh.md)

Boot-failure recovery [answers a push that cannot boot](2026-08-20-hot-update-failure-modes.md)
by re-booting the version that was running. What happens when that re-boot fails too was
stated at the code — warn, keep `/api/hmr` reachable for a follow-up push, and let a restart
restore the committed version — and asserted nowhere: the recovery tests all stopped at the
first fault.

Tests now drive the second one, using a platform that boots once and refuses every boot after
that.

## Details

- A failed push whose recovery also fails answers with the pushed bundle's own boot error,
  writes the recovery failure to the machine's log, and leaves the disposed instance in place.
- A good push over that state lands and serves, without a restart.
- A restart over that state resumes the version `harness.json` names.
