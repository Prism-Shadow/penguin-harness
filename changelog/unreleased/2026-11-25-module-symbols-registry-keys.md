# The fixed module sentinels are registry keys

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `server`, `cli`

[中文版](2026-11-25-module-symbols-registry-keys.zh.md)

An install can link one package twice — a direct link and a pnpm virtual-store copy — and two module instances do not share plain `Symbol()` values, so a fixed sentinel that one module instance creates and another reads silently fails. The four fixed module sentinels now come from the registry (`Symbol.for`) under `penguin-harness.*` keys: the CLI chat's busy marker, the Agent API run-stream's heartbeat ping, and the two npm-packlist rule-set identities. Scoped generated symbols — an Escape layer id, an unsaved-form entry handle, a browser slot or workbench group id, a per-call stop sentinel — are born, used and dropped inside one module and one call, so they stay plain `Symbol()`.
