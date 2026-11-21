# An app's window opens without waiting for the Agent's other workbenches

- **Date:** 2026-11-21
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-11-21-app-window-loads-one-workbench.zh.md)

The App Center's window and the full page read the app they show from the Agent's workbench list, and the server compiled every workbench of the Agent before it answered that list. The first time an app was opened after a restart or an update, its window stayed empty behind "Opening the page…" for as long as all of those compiles took. AI Slides showed this most, on an Agent that also carries the everyday workbenches. The window now asks for its own workbench alone (`GET …/workbenches?id=<id>`), and only that one is compiled. A server that does not know `id` still answers the full list, which the window reads as before.
