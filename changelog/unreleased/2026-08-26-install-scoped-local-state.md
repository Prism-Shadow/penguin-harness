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
directory — deleting `PENGUIN_HOME` does not touch a byte of it. Every key names its user
and Project with a compile-time constant (`admin`, `default_project`), so a wipe-and-restart
re-provisions the same ids, the keys line up again, and the old state comes back.

A data root now carries an identity, and the browser scopes that state to it.

## Details

- The server mints an opaque id into `<root>/install-id` the first time a root is used, and
  serves it from the new public `GET /api/install`. It is an identity, not a credential: it
  authorizes nothing, carries no host name, user name or timestamp, and gets ordinary file
  permissions. Public because the Web App has to ask before it knows whether anyone is
  signed in — and a just-wiped root has nobody signed in at all.
- The Web App compares that id against the one it recorded, before React mounts. A
  different id clears the keys that reference server-side entities; the same id — every
  ordinary restart — clears nothing.
- One stored id plus a sweep, rather than the id embedded in every key name: key names are
  unchanged, nothing on disk needs migrating, and orphaned keys left by earlier roots are
  collected in the same pass instead of accumulating forever.
- Browser preferences are kept: theme, language, accent, font scale, display currency,
  terminal appearance, sidebar collapse, panel width, grouping/sorting mode, nav-group
  collapse and the mid-run send mode. None of them names anything on the server, and wiping
  a data root is not a request to reset someone's theme.
- Cleared: chat drafts and parked drafts, the sidebar's Workspace registry, pinned Sessions,
  session and group order, seen markers, collapsed and pinned sidebar groups, the last
  Project and Agent, collapsed Memory scopes, the models page's group expansion and order,
  the dock's per-conversation tab arrangement, and the standalone terminal page's attached
  shell.
- `penguin.chatRouteApplied.*` is untouched: it is `sessionStorage`, scoped to one tab's
  history, and cannot outlive a data root.

## On upgrading

A browser that holds keys but has never recorded an install id is indistinguishable from
one whose root was wiped. It therefore **adopts** the current id and clears nothing —
destroying legitimate state on upgrade would be a worse bug than the one being fixed.

The consequence, stated plainly: **state that is already stale when this ships stays
stale.** A user who wiped their data root before this release still sees the old Workspace,
and the only way to clear it today is by hand — clearing site data for the app's origin in
the browser, which also resets the preferences listed above. Only wipes from this release
onward are handled automatically.

## Not fixed here

The Workspace survives a wipe through a second, independent path: if `web.db` is deleted but
the `default_project` directory is not, `ProjectService.provisionInitialProject` adopts the
existing directory and its `.project_config.toml`, including `[default_chat].workspace`.
That adoption is deliberate and unchanged.
