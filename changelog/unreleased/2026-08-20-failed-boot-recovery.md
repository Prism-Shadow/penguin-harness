# A push whose platform fails to boot no longer leaves the server half-dead

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `core`, `server`

The kernel's swap is validate-then-swap: the old App is disposed first, so the new one can
adopt what it delivered. When the new platform's boot then threw, there was no way back —
the kernel surfaced the error as a throw, the parked state was lost inside it, and the
process was left half-dead: the old App's routes still answered out of closures, but its
manager was closed (new work got 503) and the current-App pointer was gone, until someone
restarted the server. The kernel's own module doc had already named this residual risk and
promised the parked doc back to the caller; the throw path broke that promise.

The kernel now returns the failure (`status: "failed"`, carrying the boot error and the
parked document) instead of throwing, and the host answers it with a recovery boot: the
version that was running before — the committed manifest still names it, since a failed
push persists nothing — is re-booted from its own parked document. The park inventory is
what makes that an ordinary load: the disposed App had already suspended, detached and
registered its drain, so the recovered App consumes the drain, adopts the delivered
resources (ptys, tunnels) and restarts the suspended machinery like any successor.

The pusher still gets the error — the push did fail — but the machine it failed on keeps
working, with live state carried through. A double fault (the recovery boot failing too)
only warns: `/api/hmr` is runtime-owned and stays reachable for a follow-up push, and a
restart restores the committed version regardless.
