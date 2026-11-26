# The browser panel opens its first tab by itself

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `web`, `browser`

[中文版](2026-11-26-browser-auto-first-tab.zh.md)

- Opening the Browser panel with no tab creates one new tab, as the terminal panel does with its first shell. It happens once per time the panel is shown; it does not run when tabs exist or when the built-in browser is unavailable, and closing the last tab leaves the New tab button instead of opening another.
- A new tab's globe icon in the tab strip takes the `done` semantic tone instead of the faint subtle foreground, so it reads in all four themes and in dark mode.
