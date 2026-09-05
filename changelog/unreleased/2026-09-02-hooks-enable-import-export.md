# Hook packages: an enable switch, zip import/export and AI import on the Hooks tab

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#592](https://github.com/Prism-Shadow/penguin-harness/pull/592)

[中文版](2026-09-02-hooks-enable-import-export.zh.md)

Installed hook packages gained a switch, and the Agent settings Hooks tab gained what the Skills tab already had: export as a zip, and an import dialog that takes a zip upload or hands the job to an agent through the "Create with AI" kit. The hook-point chips now read the bare point name and sit beside the package name.

## Details

- `hooks.json` accepts `enabled: false`; an absent field means enabled. Core leaves a switched-off package out when it assembles a Session's hooks, and a library reinstall keeps the switch as it was. `setHookEnabled` writes the flag and removes it again on enable; `hookPackageEnabled` is the one reader.
- Server: `PATCH /api/projects/:p/agents/:a/hooks/:name { enabled }` (Project owner only), `POST …/hooks/archive` (a zip with hooks.json and the scripts at the root or in one top-level directory; the manifest's name, display fields, `enabled` and every hook-point command are validated — a command must name a file inside the archive; 409 `hook_exists` unless `overwrite`) and `GET …/hooks/:name/archive` (the installed directory as a zip, re-importable byte-compatibly). Every mutation invalidates the Agent's cached runtimes, as install and uninstall did. The hooks routes moved from `routes/plugins.ts` to `routes/hooks.ts`, and `HookItem` carries `enabled`.
- Web: a Hooks tab row shows the hook-point chips (`stop`, `user_prompt`, `pre_tool_use`) right after the package name, the description below, and the version, the switch (owners; members see a "Disabled" badge on a switched-off row, which reads dimmed for everyone), export and uninstall in the trailing slot. "Import hook" opens a modal with an "Upload a zip" / "Let AI import" segmented control; the AI mode is an `AiCreatePanel` with three examples and a fixed tail stating the review step, the package format, the script contract and the install target, sent to the Project's default agent (Send to agent / Edit in a new chat / Copy prompt). The plugin detail Modal's chips lost their "hook" suffix too, and `S.plugins.hookBadge` is gone. The archive download the Skills tab used became `archive-download.ts`, shared by both tabs.
- Docs: the skills page's hook-package section, the Web App's Hooks row and the server API table describe the switch, the import modes and the archive routes.
