# Every module symbol is a registry key

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `core`, `server`, `cli`, `ui`, `plugins`

[中文版](2026-11-25-module-symbols-registry-keys.zh.md)

An install can link one package twice — a direct link and a pnpm virtual-store copy — and two module instances do not share plain `Symbol()` values, so any identity carried under them silently fails across the boundary. All remaining module symbols now come from the registry (`Symbol.for`) under `penguin-harness.*` keys: fixed sentinels take fixed keys, and per-instance identities (a layer, an unsaved entry, a browser slot or workbench group, a per-call stop sentinel) take keys salted per module copy and counted per call, so they stay unique.
