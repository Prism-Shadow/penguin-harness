# The hot update path answers its three failure modes

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `core`, `server`

Pushing a platform ([hot update](../0.2.3/2026-08-18-hot-update.md)) had three ways to go
wrong that ended somewhere other than "the push failed": a bundle the target could not run
landed as half a version, a swap left the old App's work running behind the new one's back,
and a bundle that failed to boot took the business surface down until a restart. Each is now
a definite outcome.

## A bundle the target cannot run

Pushing a current bundle to an installation whose runtime predates the resource-interface
handshake left the machine serving the **new** frontend against the **old** API — the browser
crashed with `Cannot read properties of undefined (reading 'attachmentLimitMinMb')` on opening
Upload limits, because `/api/me` was still the previous version's. The push is atomic, but the
platform it delivers has to *claim* the runtime's business capabilities before it can serve the
business API, and a runtime too old to publish them made that claim fail. The platform's answer
was to degrade to a terminals-only App: it declined every business route, the seam handed those
requests back, and the older runtime answered them out of its own built-in routes. One atomic
push therefore landed as half a version, silently, reported as a success.

A platform that cannot claim the capabilities now refuses to boot, so the upgrade rolls back
the way any failed boot does — the running version keeps serving, the web dist is not
committed, nothing is persisted — and the push reports the reason: the installation itself has
to be updated, because a push replaces the platform and never the runtime. A machine already
carrying such a half version needs that update too; its committed bundle predates the check, so
a restart restores it degraded again, and updating the installation lets the same bundle claim
successfully and serve whole (clearing `<data root>/hmr/harness.json` falls back to the
packaged version instead).

A host that genuinely has no business runtime behind it declares that in the same interface
descriptor every host describes itself with, and still gets a terminals-only platform. Being
*unable to answer* stopped being read as *asking for terminals only*.

## The handover between generations

Replacing the platform used to stop the old App loosely: the scheduler was stopped and agent
runs were aborted, but the abort was fire-and-forget, so the new App could serve while the old
one's runs were still winding down. Resources fell through the cracks with it — a dev server a
conversation had started kept running with no successor able to see or stop it, and the old
App's pty reap timers and exit listeners kept firing from a dead generation, disposing sessions
and removing registry entries the new App owned.

Every resource an App creates was put on a written inventory with one of three fates, and the
swap executes it:

- **Delivered** — ptys survive through the resource registry and are adopted by the successor;
  the runtime's own singletons are re-claimed.
- **Suspended** — the scheduler stops, runs abort, and each Session's environment is disposed,
  killing the background commands it owns; the successor rebuilds all of it.
- **Detached** — the old App unsubscribes its pty exit listeners, so nothing of a dead
  generation acts on an object the new one owns.

The list is the contract rather than a description of the services that exist today: a build
adding a service with state of its own puts it on the right list, or the swap leaks it.

Dispose is synchronous, so the asynchronous rest — waiting for aborted runs to actually end —
is exposed by the App and awaited by the kernel between disposing the old tree and booting the
new one. A successor therefore never races its predecessor.

## A bundle that fails to boot

The kernel's swap is validate-then-swap: the old App is disposed first, so the new one can
adopt what it delivered. When the new platform's boot then threw, there was no way back — the
error surfaced as a throw with the parked state lost inside it, and the process was left
half-dead, the disposed App's routes still answering out of closures while its manager was
closed (new work got 503), until someone restarted the server.

The kernel now returns that failure — `status: "failed"`, carrying the boot error and the
parked document — instead of throwing, and the host answers it by re-booting the version that
was running before, from that parked document. The inventory above is what makes the recovery
an ordinary load: the disposed App had already suspended and detached, so the recovered App
adopts the delivered resources and restarts the suspended machinery like any successor. The
pusher still gets an error, because the push did fail, but the machine keeps working with its
live state carried through. A double fault only warns: `/api/hmr` is runtime-owned and stays
reachable for a follow-up push, and a restart restores the committed version regardless.
