# The Machines page goes live

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `web`
- **PR:** [#577](https://github.com/Prism-Shadow/penguin-harness/pull/577)

[中文版](2026-09-01-machines-page-on.zh.md)

Two changes, and the feature the stack before it built becomes reachable:

- The Machines page's entry in the web manifest is marked released, so the sidebar shows the row to admins — the gate the manifest already held for exactly this. Its route was mounted all along; only the way in was withheld.
- The sidebar's **new workspace** picker offers the machine row, so a workspace can be created on a machine rather than only here.

Everything either one shows was already built and tested; what was missing was the way in. Kept as a change of its own so that turning the feature on is a decision with a date, separate from the code that makes it possible — and so that turning it back off is a revert of a few lines rather than of a feature.

Both surfaces are admin-only in effect: the list they read answers `403` to everyone else, and a non-admin who types the URL gets the page's own refusal.
