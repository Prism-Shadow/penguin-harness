# Every new Agent gets goal mode and Plan mode

- **Date:** 2026-11-19
- **Type:** feat
- **Scope:** `core`, `server`, `cli`, `web`, `plugins`, `docs`
- **PR:** [#1651](https://github.com/Prism-Shadow/penguin-harness/pull/1651)

[中文版](2026-11-19-default-install-plugins.zh.md)

A plugin card can declare `defaultInstall: true`, and the `goal` and `plan` cards do: every Agent created from now on has goal mode and Plan mode installed. Their hooks do nothing until the mode is picked.

## Details

- **Card field.** `defaultInstall` (default false) sits beside `preinstall`, which still decides only `default_agent`'s set. A package an admin installed on the server is never a default install, whatever its card says. The library listing marks these plugins with `PluginItem.defaultInstall`.
- **Create route.** `POST /api/projects/:projectId/agents` takes `defaultPlugins` (default true). When it is true, the default-install plugins join `plugins`, and a plugin named in both is installed once. Organization hires go through the same path and get them too. An Agent imported from a package keeps the plugins the package carries.
- **CLI.** `penguin agent create --no-default-plugins` leaves them out. The help names them.
- **Create dialog.** The Plugins field starts with Goal mode and Plan mode ticked, and they can be unticked. A dialog with nothing else changed still closes without asking. Create sends the list on screen with `defaultPlugins: false`.
- **Existing Agents.** Nothing is installed on them. The composer's "+" menu also lists the library's composer modes the Agent lacks, greyed, with **Install**. Picking one installs it on the Agent the conversation runs on, the same way goal mode's install offer does, and turns the mode on.
