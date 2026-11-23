# The agent, workspace and setting domains' services join the library packages

- **Date:** 2026-11-20
- **Type:** refactor
- **Scope:** `server`, `library/agent`, `library/workspace`, `library/setting`, `library/benchmark`
- **PR:** [#1666](https://github.com/Prism-Shadow/penguin-harness/pull/1666)

[中文版](2026-11-20-library-agent-workspace-setting.zh.md)

The server's agent-config, memory, export, avatar, workspace-files and setting services move beside the vocabulary packages that landed before them. `@prismshadow/penguin-library-agent` takes the agent domain's config service, the memory machinery (scopes, transfer documents, the vault), the export/zip packaging and the avatar file handling; `@prismshadow/penguin-library-workspace` takes the workspace files service, its mechanism and the files vocabulary; `@prismshadow/penguin-library-setting` takes the theme store, the keybindings bounds and the desktop shell relay (the updater, tray, folder-access and host-command messages); `@prismshadow/penguin-library-benchmark` takes the benchmark service, its archive code and its mechanism contract. The archive caps and zip-entry checks move into `@prismshadow/penguin-library-http` first, so the benchmark archive and the agent export enforce one set of limits.

The server imports these; nothing in the library imports the server. A moved service keeps its server-side assembly where it binds a server capability (the paths port): the provider Modules stay, the service classes move. The API's export surface stays whole through re-exports — `@prismshadow/penguin-server/api` and the in-repo forwards still in use (`services/agent-config-service.ts`, `services/theme-store.ts`, and the rest of the `services/*` assemblies) keep the old import paths resolving — and everything else imports the library packages directly.

## Details

- `library/agent` (new): `agent-config-service` (with the paths port), `memory-service`, `memory-archive`, `memory-transfer-document`, `agent-export`, `agent-zip`, `avatar-file`, the agent vocabulary (`agent-vocab`, `types`, `contract`), and the `agent-api` companion package's repo face.
- `library/workspace` (new): `workspace-files-service`, the files mechanism, the files vocabulary (`types`, `contract`); the benchmark domain's narrowed workspace port gives way to the real service.
- `library/setting` grows: `theme-store` (with the pack-cleanliness rules read from the UI package's table), `keybindings`, `desktop-service`, `desktop-update-port`, and the desktop/settings wire vocabulary in `types`.
- `library/benchmark` (new): `benchmark-service`, `benchmark-archive`, the mechanism contract (`contract`, `ports`, `types`).
- `library/http` grows: `skill-import-limits` (the caps) and `zip-entries` (the entry checks), moved out of the server's services so every archive path shares them.
- The server's vitest config inlines the new library packages, whose package exports are TypeScript sources; left external, the run's Node loader refuses the extension.

## Compatibility

Nothing in this batch changes behavior: the moved code is the same code at a new address. Package subpaths that existed before — `@prismshadow/penguin-server/api`, `@prismshadow/penguin-server/model-catalog` — still export the moved names, re-exported from the library; the in-repo forwards keep the old source paths resolving. The forwards will be deleted in penguin v0.3 together with the in-repo imports that still go through them; import a moved module from its library package.
