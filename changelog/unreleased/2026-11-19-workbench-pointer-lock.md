# Mouse look in a workbench game

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `server`

[中文版](2026-11-19-workbench-pointer-lock.zh.md)

A workbench game can request pointer lock for its own tab by setting `renderer.iframe.pointerLock` to `true` in its session-tab contribution. Click inside the game to capture the mouse for continuous camera movement. Press Escape to release it.
