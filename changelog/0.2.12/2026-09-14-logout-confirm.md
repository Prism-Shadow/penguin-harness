# Signing out asks first

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `web`
- **PR:** [#724](https://github.com/Prism-Shadow/penguin-harness/pull/724)

[中文版](2026-09-14-logout-confirm.zh.md)

## What changed

- **Sign out** in the user menu now opens a confirmation before ending the session. The row sits in a menu of harmless entries, and one slip used to land the user on the login page; the dialog names what happens (the session here ends, running conversations keep going on the server) and Cancel keeps everything as it was.
