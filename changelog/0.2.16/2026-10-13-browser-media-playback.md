# Keep browser media playing across app navigation

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1105](https://github.com/Prism-Shadow/penguin-harness/pull/1105)

[中文版](2026-10-13-browser-media-playback.zh.md)

Fixed media playback being interrupted when switching tabs, opening another menu or entering company mode in the desktop app.

## Details

- Removed the forced page freeze when a browser tab moved into the background.
- Kept tabs with playing media at full speed, including muted video and pages with multiple players. Native background throttling resumed after the last player stopped, taking effect on the next visibility change.
- Added Electron playback checks for audio and live video across repeated foreground and background switches, pauses, resumes and renderer crashes.
