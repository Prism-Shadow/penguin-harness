# Data compatibility

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — only the server migrates Penguin Go's pre-MMSP routes; a load through the SDK alone leaves them as written

[中文版](2026-10-15-backward-compatibility.zh.md)

## Penguin Go's pre-MMSP routes

The one-time migration of Penguin Go routes stored before the MMSP switch (`google-genai` / `deepseek-official` on `token.penguin.ooo/api`) now runs only in the server's read path, including the startup sweep. Core's `loadProjectConfig` no longer migrates them. A file read by the SDK alone keeps its old routes until a server reads it. The tolerated shape, its scope and the user action are unchanged from [the 0.2.15 entry](../0.2.15/2026-10-12-backward-compatibility.md): nothing to do when the file is opened through the server, the desktop app or the CLI.

### Lifetime

Remove the no-`endpoint` call in `ProjectConfigService.readTable`, the `endpoint === undefined` branch of `migratePenguinGoRoutes` and the pre-MMSP origin and paths in `isPenguinGoEndpoint` at the 0.3.0 release preparation, together with core's `migrateProjectConfigTable`; whoever prepares 0.3.0 removes them. The `endpoint` path stays.
