# A failed hot update no longer takes the running App down with it

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `server`

[中文版](2026-08-23-hmr-teardown-transaction.zh.md)

Three paths through a hot update could leave the process half-dead: serving HTTP out of closures while its session manager, scheduler and terminals were stopped, with nothing able to bring them back short of a restart. All three shared one shape — an irreversible step taken before the thing that justifies it had succeeded — and all three now treat a swap's teardown as a single transaction.

## Details

- `upgrade()` disposed the running tree and awaited its drain outside the block that converts failure into a recoverable result. A throwing disposer or a rejected drain escaped as a rejection instead, after the old tree was already down, so the caller held no parked document and the host's recovery never ran. Both steps moved inside: once the old tree starts coming down, every failure hands back the document recovery needs.
- `bootNode` booted children and collected `ctx.effect` disposers, then ran the implementation's `create()` and the method-set check, with no unwind on failure. A node that failed half-built left children booted and effects registered with nothing able to reach them — a watcher, an exit listener or a child process leaked for the life of the process, and each retry stacked another. It now unwinds in the same children-first order a successful dispose uses.
- The platform disposed the resource groups a new build could not speak for as its first act, before plugin delivery, the business assembly and the scheduler — any of which can throw. A bundle that changed its resource declaration and then failed took the previous App's terminals down with it, and the host's re-boot of the previous bundle could not bring them back, because recovery re-adopts by handle. Reconciliation now computes the fates and touches nothing; adoption skips a doomed group explicitly; disposal and the declaration overwrite happen once the App is built and nothing left can throw.
