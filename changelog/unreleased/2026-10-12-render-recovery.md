# Keep recovery controls available after a render failure

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-12-render-recovery.zh.md)

The app mounted one command palette beside a route error boundary. A failed route retained reload and harness history. Full-page workflows registered their exit action with the shared palette; the palette remained reachable over dialogs with the existing configurable shortcut.

## Safe mode and startup recovery

Safe mode persisted per tab, accepted `?safe`, suppressed workflow contribution requests and frames, and could be exited from the marker or palette. The modular adaptation also cleared pages, organization pages, session surfaces and quick starts. Startup failures retained the recovery panel. The palette default changed to Mod+Shift+KeyP; user overrides were retained, and Firefox can reserve this chord for a private window.
