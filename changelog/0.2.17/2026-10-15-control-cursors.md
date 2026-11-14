# Steadier cursors across app controls

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `ui`, `web`, `skills`
- **PR:** [#1142](https://github.com/Prism-Shadow/penguin-harness/pull/1142)

[中文版](2026-10-15-control-cursors.zh.md)

Buttons, tabs, navigation entries, file rows and form selectors were switched to the arrow cursor, reducing arrow-to-hand changes when moving across dense controls and their gaps. Content links and inline link actions kept the hand; text entry, drag, resize, zoom and disabled controls kept their specific cursors.

## Shared controls

- Moved the default control cursor rules into the shared UI theme and removed conflicting hand cursors from app controls.
- Updated the frontend skill to require checking and reusing shared UI components first, extending them for common behavior and keeping app-wide interaction rules in the UI package.
