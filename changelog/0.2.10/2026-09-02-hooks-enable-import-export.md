# Hooks: one Agent-level switch, zip import/export and a chat import on the Hooks tab

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#592](https://github.com/Prism-Shadow/penguin-harness/pull/592)

[中文版](2026-09-02-hooks-enable-import-export.zh.md)

Hooks gained an on/off switch, the way Skills have one: a single Agent-level setting rather than a flag per installed package. The Agent settings Hooks tab also gained what the Skills tab already had — export as a zip, and the Skills tab's import dialog, a recommended chat import above a zip upload. The hook-point chips now read the bare point name and sit beside the package name.

## Details

- `hooks.enabled` is a new section of `system_config.yaml` (absent means on) with no prompt half — a hook package is scripts run at the loop's hook points, not text in the context. With it off, a Session created from then on assembles no hooks at all and every installed package stays on disk, listed and exportable. Core reads it fresh when it builds a Session, beside the packages themselves.
- Server: the switch rides on the Agent config route (`PUT …/config` with `{ config: { hooks: { enabled } } }`, echoed by GET as `config.hooks`), and a config write that carries it invalidates the Agent's cached runtimes — hook packages are bound when a Session is built, so a cached runtime would otherwise keep the set it was built with. New hook routes: `POST …/hooks/archive` (a zip with hooks.json and the scripts at the root or in one top-level directory; the manifest's name, display fields and every hook-point command are validated — a command must name a file inside the archive; 409 `hook_exists` unless `overwrite`) and `GET …/hooks/:name/archive` (the installed directory as a zip, re-importable byte-compatibly). The hooks routes moved from `routes/plugins.ts` to `routes/hooks.ts`.
- Web: the Hooks tab opens with the enable-switch card the Skills tab has (Project owner only; members see the state), then a row per package showing the hook-point chips (`stop`, `user_prompt`, `pre_tool_use`) right after the package name, the description below, and the version, export and uninstall in the trailing slot. "Import hook" opens the Skills tab's dialog shape: the recommended chat import leads with a hook source field (a URL, a repository, a local path, a description, or another tool's hooks config — the pasted config is why the field is a textarea), previews the prompt it generates (the source's lead sentence plus a fixed tail stating the review step, the package format, the script contract and the install target), and offers "Copy prompt" and "Open a new chat" with this agent, both greyed while the source is empty; the zip upload sits below it. The Skills dialog's "Open a new chat" is now greyed together with its "Copy prompt" for the same reason — an empty source used to open a blank chat and drop the prompt. The plugin detail Modal's chips lost their "hook" suffix too, and `S.plugins.hookBadge` is gone. The archive download the Skills tab used became `archive-download.ts`, shared by both tabs.
- Docs: the skills page's hook-package section, the configuration table, the Web App's Hooks row and the server API table describe the switch, the import dialog and the archive routes.
