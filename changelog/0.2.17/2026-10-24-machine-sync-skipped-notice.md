# The machine's skipped-models notice can be closed, and says when the machine's build is behind

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `ui`, `server`, `docs`, `ui-gallery`
- **PR:** [#1317](https://github.com/Prism-Shadow/penguin-harness/pull/1317)

[中文版](2026-10-24-machine-sync-skipped-notice.zh.md)

The Machine dialog's notice listing the models a config sync could not carry to the machine now
has a close cross, like the environment-keys notice beside it. Closing it is remembered for your
account, that machine and the Project, against the models it listed and why each was refused. It
stays closed while later syncs refuse the same models for the same reasons, and comes back when
another model is refused or a listed one is refused for another reason.

A built-in model of this server that the machine refuses as not addable to its group no longer
reads as a hand-added model to move into a custom group. The machine's build does not include
that model yet, and the notice says so: update the machine, then sync config again.

## Details

- The skipped-models list renders through the shared `Notice`, with its title and the close
  cross, in the same store as the environment-keys notice (`ui_prefs.noticesDismissed`, under
  `machine-skipped:<machine id>:<project id>`).
- A machine's `configSync.skipped` rows gain `builtInHere: true` when the refused entry is one of
  this server's built-in models for its group, and the connect log says the machine must be
  updated instead of quoting the machine's advice to use a custom group.
- A `Notice` whose only action is its close cross keeps the cross at the end of the body's line
  and wraps the body beside it; before, a body too long for one line pushed the cross onto a row
  of its own under it. Notices with buttons still give their buttons a row of their own.
- The Server API page documents `builtInHere`, and the UI gallery's demo machine lists a built-in
  model among its skipped ones.
