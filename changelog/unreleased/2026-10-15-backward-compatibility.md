# Data compatibility

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166), [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — only the server migrates Penguin Go's pre-MMSP routes; a load through the SDK alone leaves them as written

[中文版](2026-10-15-backward-compatibility.zh.md)

## The DeepSeek and MiniMax presets' vendor endpoints

The DeepSeek presets carried `base_url = "https://api.deepseek.com"` from 2026-09-10 and the MiniMax preset `base_url = "https://api.minimax.io/v1"` from 2026-08-18, until 2026-10-03, each with the vendor's client pinned beside it (`deepseek-v4` / `minimax-m3`, since renamed `deepseek-official` / `minimax-official`). Group-level connections then hoisted such a pair onto `[providers.deepseek]` or `[providers.minimax]`. Under the [new credential rule](2026-10-15-environment-keys-without-base-url.md), a keyless model sent to a base URL from the file is refused, so such a Project's default model would stop on the first Session after the upgrade.

- **Old shape tolerated:** that pair — the vendor URL with the vendor's client pinned on the same table — on the `deepseek` or `minimax` group or on one of its rows. The server's read path, and its read of every Project as it starts, deletes the pair and writes the file back. Keys and everything else stay as written. A URL with no vendor pin beside it (one typed in the Models page, which offers no vendor client), a proxy, the vendor's second host and other groups stay too, so the migration happens once and never undoes a later choice.
- **Scope:** only where dropping the pair moves nothing. The ids involved must reach the vendor's official client by themselves, whose default endpoint is that URL; a row's pair goes only when its group names no other URL or protocol; the group's goes only when every model following it ends on that client and no model keeps a base URL of its own on the group's origin, which would lose the group key.
- **User action:** none for a Project opened through the server or the desktop app. A Project used only by the CLI or the SDK keeps the URL, and its keyless models are refused with a message naming both fixes: clear the base URL (`penguin config model add --provider deepseek --clear-base-url`) or put the key in the file.
- **Edge:** a `DEEPSEEK_BASE_URL` or `MINIMAX_BASE_URL` set in the server environment (a proxy, for example) now takes effect for those models, since the file no longer names their endpoint.

### Lifetime

Remove at the 0.3.0 release preparation, by whoever prepares it, together with core's `migrateProjectConfigTable`: `migratePresetVendorEndpoints` and its call in `ProjectConfigService.readTable`, the `MINIMAX_BASE_URL` export of the catalog, the startup sweep (`ProjectConfigStore.migrateStoredConfigs` and its call in `Startup.setup`, which exists for the one-time migrations alone), and the server `project-config-migrations.test.ts` scenarios.

## Penguin Go's pre-MMSP routes

The one-time migration of Penguin Go routes stored before the MMSP switch (`google-genai` / `deepseek-official` on `token.penguin.ooo/api`) now runs only in the server's read path, including the startup sweep. Core's `loadProjectConfig` no longer migrates them. A file read by the SDK alone keeps its old routes until a server reads it. The tolerated shape, its scope and the user action are unchanged from [the 0.2.15 entry](../0.2.15/2026-10-12-backward-compatibility.md): nothing to do when the file is opened through the server, the desktop app or the CLI.

### Lifetime

Remove the no-`endpoint` call in `ProjectConfigService.readTable`, the `endpoint === undefined` branch of `migratePenguinGoRoutes` and the pre-MMSP origin and paths in `isPenguinGoEndpoint` at the 0.3.0 release preparation, together with core's `migrateProjectConfigTable`; whoever prepares 0.3.0 removes them. The `endpoint` path stays. The startup sweep that applies both server migrations goes with them (see above).
