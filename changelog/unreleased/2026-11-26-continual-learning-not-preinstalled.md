# External built-in plugins pinned to their final releases; Continual Learning is no longer preinstalled

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`, `cli`, `desktop`, `landing`, `docs`

[中文版](2026-11-26-continual-learning-not-preinstalled.zh.md)

The five plugins the product ships from other repositories moved from release candidates to their final releases, and the Default Agent of a new Project no longer gets the Continual Learning plugin. Its stop hook starts a background Session after every long Task, so it is installed only when a person installs it from the plugin library. The plugin still ships with the product and installs offline. This reverses that part of the [Default Agent plugin baseline](2026-11-23-default-agent-plugin-baseline.md).

## Details

- The server, CLI, desktop and landing packages pinned `a2ui` 0.2.19, `skill-porting` 0.2.19, `use-firecrawl` 0.2.19, `default-rsi-toolkit` 0.2.19 and `continual-learning` 0.2.20; the component gallery pinned the three of them it uses.
- Continual Learning's card had marked it for preinstall on the Default Agent. From 0.2.20 the card says `preinstall: false`.
- Agents that already had the plugin kept it. It can be removed in the agent's settings, under Plugins.
