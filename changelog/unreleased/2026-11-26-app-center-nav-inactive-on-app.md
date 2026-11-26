# The App Center nav row stands down while an app is open

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `web`

[中文版](2026-11-26-app-center-nav-inactive-on-app.zh.md)

Opening an app from the sidebar's Apps list lit both the app's row and the App Center nav row,
because the app's window lives under `/apps?app=…`. The App Center row is now current only while
its grid shows; with an app (a workbench, one on a machine, or a system app) on screen, the app's
own row is the single current page in the column.
