# Install a plugin on a new blank Agent from the plugin market

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1659](https://github.com/Prism-Shadow/penguin-harness/pull/1659)

[中文版](2026-11-19-install-to-blank-agent.zh.md)

The plugin market's manage-installs dialog has a first row, "New blank agent". Its "Create and install" opens the Create agent dialog over the list, with the plugin's title as the name and the plugin ticked. The dialog's own id check, stdio MCP Server confirmation and errors apply. Once created, the dialog closes and the list stays open, with the new Agent in it marked installed. One Escape closes the Create agent dialog and leaves the list open.
