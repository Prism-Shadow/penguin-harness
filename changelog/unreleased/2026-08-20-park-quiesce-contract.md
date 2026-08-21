# A hot swap now parks by inventory: deliver, suspend, and leave the process clean

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `server`

Replacing the platform used to stop the old App loosely: the scheduler was stopped and
agent runs were aborted, but the abort was fire-and-forget — the new App could be serving
while the old one's runs were still winding down — and several resources fell through the
cracks. A dev server a conversation had started kept running with no successor able to see
or stop it, and the old App's pty reap timers and exit listeners kept firing from a dead
generation, disposing sessions and releasing registry ids the new App now owned.

Every resource the App creates is now on a written inventory (hmr/platform.ts) with one of
three fates, and the swap executes it:

- **Delivered** — ptys survive through the registry and are adopted by the successor; the
  runtime's own singletons are re-claimed.
- **Suspended** — the scheduler stops, runs abort, and each Session's environment is
  disposed (killing its background commands); the successor rebuilds all of it fresh.
- **Detached** — the old App unsubscribes its pty exit listeners, so nothing of a dead
  generation ever acts on an object the new one owns.

The list is the contract rather than a description of today's services: a build that adds a
service with state of its own puts it on the right list, or the swap leaks it.

The synchronous part runs at dispose; the asynchronous rest — waiting for aborted runs to
actually end — rides the current-App pointer as a `drained` promise the successor
claims and awaits before building
anything. The process is therefore clean between generations: the new App starts the
suspended machinery and takes over the delivered resources, never racing the old one.
