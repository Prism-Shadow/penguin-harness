# Data compatibility

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — only the server migrates Penguin Go's pre-MMSP routes; a load through the SDK alone leaves them as written

[中文版](2026-10-15-backward-compatibility.zh.md)

## Penguin Go's pre-MMSP routes

The one-time migration of Penguin Go routes stored before the MMSP switch (`google-genai` / `deepseek-official` on `token.penguin.ooo/api`) now runs only in the server's read path, and in the App's startup read of every Project, which writes the migrated file back before anything else opens it. Core's `loadProjectConfig` no longer migrates them. A file read only by the CLI or the SDK keeps its old routes until a server reads it. The tolerated shape and its scope are unchanged from [the 0.2.15 entry](../0.2.15/2026-10-12-backward-compatibility.md); the user action narrows to: nothing to do when the file is opened through the server or the desktop app.

### Lifetime

Remove at the 0.3.0 release preparation, by whoever prepares it, together with core's `migrateProjectConfigTable`: the no-`endpoint` call in `ProjectConfigService.readTable`, the `endpoint === undefined` branch of `migratePenguinGoRoutes`, the pre-MMSP origin and paths in `isPenguinGoEndpoint`, the startup read (`ProjectConfigStore.migrateStoredConfigs` and its call in `Startup.setup`, which exists for the one-time migrations alone), and the migration cases in server `penguin-go-mmsp.test.ts`. The `endpoint` path stays.
