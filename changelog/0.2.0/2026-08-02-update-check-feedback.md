# Web App: the manual update check reports every outcome

- **Date:** 2026-08-02
- **Type:** fix
- **Scope:** `web`
- **PR:** [#142](https://github.com/Prism-Shadow/penguin-harness/pull/142)

[中文版](2026-08-02-update-check-feedback.zh.md)

The sidebar user menu's "Check for updates" row used to notify only when nothing changed visibly; finding a newer release changed the row silently. The manual check now gives explicit feedback for every outcome: a spinner and busy label while the check runs, a success toast when already up to date, and a success toast naming the release when a newer one is found — at which point the same row turns into the persistent "New version vX available" entry that opens the update dialog (release-notes link, admin-only self-update). Failed lookups and disabled checks keep their error/info toasts. The outcome mapping is a pure, unit-tested classifier: disabled beats failed beats found, and "found" must name a version so neither the toast nor the row is ever blank.
