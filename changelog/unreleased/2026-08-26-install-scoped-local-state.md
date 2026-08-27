# Deleting the data root now also clears the browser-side UI state that belonged to it

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#508](https://github.com/Prism-Shadow/penguin-harness/pull/508)

[中文版](2026-08-26-install-scoped-local-state.zh.md)

Deleting the data files and restarting brought the app back with the old Workspace still
selected. Part of that state was never in the data root at all: the Web App keeps the
new-chat draft, the sidebar's registered Workspaces, pinned Sessions, read markers and the
last Project/Agent in `localStorage`, which in the desktop app lives in Electron's userData
directory — deleting `PENGUIN_HOME` does not touch a byte of it. Every key named its user and
Project with a compile-time constant (`admin`, `default_project`), so a wipe-and-restart
re-provisioned the same ids, the keys lined up again, and the old state came back.

The data root was given an identity, and the browser was made to scope that state to it.

## Details

- An opaque id was minted into `<root>/install-id` the first time a root was used, and
  served from a new public `GET /api/install`. It was made an identity rather than a
  credential — it authorizes nothing, carries no host name, user name or timestamp, and got
  ordinary file permissions instead of `api-token`'s handling. Public, because the Web App
  has to ask before it knows whether anyone is signed in, and a just-wiped root has nobody
  signed in at all.
- The Web App compared that id against the one it had recorded, before React mounted. A
  different id cleared the keys that reference server-side entities; the same id — every
  ordinary restart — cleared nothing.
- One stored id plus a sweep, rather than the id embedded in every key name: key names were
  left as they were, so nothing already on disk needed migrating, and orphaned keys left
  behind by earlier roots were collected in the same pass instead of accumulating forever.
- Browser preferences were kept: theme, language, accent, font scale, display currency,
  terminal appearance, sidebar collapse, panel width, grouping/sorting mode, nav-group
  collapse and the mid-run send mode. None of them names anything on the server, and wiping
  a data root is not a request to reset someone's theme.
- Cleared: chat drafts and parked drafts, the sidebar's Workspace registry, pinned Sessions,
  session and group order, seen markers, collapsed and pinned sidebar groups, the last
  Project and Agent, collapsed Memory scopes, the models page's group expansion and order,
  the dock's per-conversation tab arrangement, and the standalone terminal page's attached
  shell.
- A boot that actually swept reloaded instead of rendering. Module evaluation of the whole
  static import graph finishes before the entry point runs a statement, so a module that
  read `localStorage` at module scope — the dock's per-conversation tab arrangement did —
  was already holding a parsed copy of keys the sweep then removed, and its first scope
  switch would have written the entire pre-wipe map back, under an id that matched by then
  and would never be swept again. The reload re-evaluated every module against the cleaned
  store, and the second pass reconciled to "unchanged" and rendered.
- A tab left open across the wipe reloaded too. The sweep runs once per page load, so a tab
  still open against the old root kept that state in memory and would have written it back
  on the next pin, reorder or draft keystroke; the cross-tab `storage` event for the
  recorded id became a sweep-and-reload in every other tab.
- The route was mounted in the platform rather than the runtime shell. A hot update carries
  platform, CLI and web bundle as one version and never the runtime, so the endpoint now
  travels with the bundle that calls it — mounted in the runtime it would have been missing
  on exactly the installations that received the new Web App by hot update, and the fix
  would have been silently inert there until the next runtime install.
- `penguin.chatRouteApplied.*` was left untouched: it is `sessionStorage`, scoped to one
  tab's history, and cannot outlive a data root.
- The classification table was made self-enforcing rather than self-reported: a test reads
  the Web App source, collects every `penguin.*` key literal, and fails on any the table
  does not cover, since a forgotten install-scoped key silently reintroduces this bug.
- The second path a Workspace survives a wipe by was deliberately not touched: with `web.db`
  deleted but the `default_project` directory kept, `ProjectService.provisionInitialProject`
  adopts the existing directory and its `.project_config.toml`, including
  `[default_chat].workspace`. That adoption is intended, and was left as it was.

## Compatibility

Nothing already on disk was migrated and nothing was destroyed on upgrade. The decision
behind that, and the one thing a user who wiped a data root *before* this release has to do
by hand, are in [backward compatibility](2026-08-27-backward-compatibility.md).
