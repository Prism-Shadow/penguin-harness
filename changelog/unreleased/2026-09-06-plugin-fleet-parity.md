# One plugin list for a Project, applied without a restart, kept the same on its machines

- **Date:** 2026-09-06
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#627](https://github.com/Prism-Shadow/penguin-harness/pull/627)
- **Breaking:** the data root's `plugins.json` is no longer read

[中文版](2026-09-06-plugin-fleet-parity.zh.md)

Plugins were a per-deployment file that only took effect at process start. Neither holds once there is a fleet: machines are lent to Projects, and there is no path in the product to log into each machine's server and enable a plugin there. See PRFC-0010.

## The list belongs to a Project; the process runs the closure

A Project's plugins live in its own config (`plugins` in `.project_config.toml`), beside its models — because machines are lent to Projects, so a Project's list is what says which machines a plugin has to reach. Loading is per process, though: there is one module tree. So what a deployment runs is the **closure**, the union over its Projects, and what a plugin contributes is visible to all of them. A row on the plugins page is therefore two facts joined: this Project asked for it, and the process has it.

The routes move to `/api/projects/:projectId/plugins/installed`. A package is removed from disk only once no Project asks for it.

## Applied without a restart

A write re-reads the closure into a fresh plugin host and asks the runtime to re-assemble the App from the same bundle — the swap a hot push already performs, so ptys and machine connections cross it exactly as they cross a push. No process restart.

`Hmr.reload` is an optional **field** rather than a method, and that is load-bearing: the signature check tolerates a field a runtime does not declare, and refuses a platform whose required method is missing. A runtime older than this keeps taking pushes and simply reports that it is waiting for a restart, which is what every runtime did before.

The page says the same: the Installed plugins dialog no longer describes a data-root `plugins.json` or a pending restart, and the catalogue points at the row's own Install control. The one place a restart is still named is the runtime that cannot re-assemble — the case that produces it.

## The same list on a Project's machines

A Project's list is handed to the machines it uses, on the same trip its Model credentials already take and at the same moments: when the list changes, and again on connect. Parity is **strict** — the Project's list is the truth and what a machine has beyond it is removed.

That has a cost worth knowing: a platform-specific sandbox backend is not in the other platform's list and is therefore taken away. Keeping one means listing it fleet-wide; a machine that cannot resolve it shows an inert error row rather than losing the backend it can use. The sync reports per machine what it added, what it removed, what that machine lists but cannot resolve (most often a machine that needs updating first), and whether it still has to restart.

## Compatibility

**The data root's `plugins.json` is no longer read, and nothing migrates it.** A deployment that had one starts with **no plugins**: sandbox backends, languages and session surfaces are all absent from the tree until each Project asks again on the plugins page. The old file is left on disk untouched, so rolling back to an earlier platform finds it exactly as it was.

There is no compatibility code to carry, and therefore nothing to remove later — which is why this route was chosen over a migration or a dual read.
