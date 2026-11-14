# The machine's environment-keys notice can be closed, and closable notices share one component

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `ui`, `web`, `server`, `ui-gallery`
- **PR:** [#1156](https://github.com/Prism-Shadow/penguin-harness/pull/1156)

[中文版](2026-10-15-dismissible-notices.zh.md)

The Machine dialog's notice that model keys from this server's environment cannot be synced to the
machine now has a close cross, as the initial-password banner does. Closing it is remembered for
your account and that machine, against the keys it named: it stays closed while the sync leaves
the same keys behind, and comes back when another model takes its key from the environment. It
stays off screen until your preferences are read, so a closed notice never flashes in, and shows
as before when they cannot be read. The list of models the machine would not take stays beside it
as it was.

## Details

- The shared UI package's `Notice` is the one closable notice: its close cross is flat and takes
  the notice's own ink, and a new `banner` variant lays a notice edge to edge across a column with
  its action word after the sentence and the cross at the far edge.
- The initial-password banner and the composer's notice about a model window below the compaction
  threshold now render through `Notice`; what they do and how their dismissal is kept are
  unchanged.
- The account's preferences gain `noticesDismissed`, a map from notice to what it named when it was
  closed. The initial-password banner keeps its own `initialPasswordBannerDismissed`, read as before.
- The UI gallery's Notices board shows the banner and closable notices, and its demo machine
  carries a config sync with both notices.
