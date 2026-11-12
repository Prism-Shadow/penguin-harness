# An Agent's Plugins tab splits into four sub-pages: Plugins, Skills, Hooks and Workbenches

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-11-12-agent-settings-plugin-subpages.zh.md)

The Agent settings Plugins tab became four sub-pages, switched by a segmented control under the tab strip, with the current sub-page's actions at the end of the same row. Each sub-page is a value of `?tab=`: `plugins` (the default), `skills`, `hooks` and `workbenches`, so the older addresses of the tabs it replaced open the matching sub-page. The four share one read of the Agent's lists.

## Details

- **Plugins** lists the Agent's plugins as the Plugins page's cards, under **Installed** (every plugin the Agent carries a part of) and **Available** (library plugins the Agent carries nothing of and that ship a Skill, a hook package, an MCP server or a workbench), with a search box and **Open the Plugins page**. Any member installs and updates from a card, the Project owner uninstalls; a stdio server's command, an update's rewritten parts and an uninstall's parts are confirmed first, as on the Plugins page. An Agent on a machine installs from that machine's library, and a machine older than the uninstall reads as needing an update.
- A plugin's detail is the Plugins page's dialog with the Agent's status, no "used by" count, the README and files from the Agent's server, and an **On this agent** section listing its parts by kind, a part the library ships and the Agent lacks marked **Missing**; each kind leads to its sub-page (MCP servers to the Tools tab). The detail has an address of its own, `?tab=plugins&plugin=<name>`.
- **Skills**, **Hooks** and **Workbenches** each hold their switch, every part of their kind in one list, and their own Import button in place of the former Import menu; the Skills sub-page keeps the skills prompt. A part a plugin installed carries a puzzle mark after its name that names the plugin and opens its detail, and removing such a part says which plugin installed it.
- Hook package rows use the shared list row, so they read like Skill rows.
- The Agents page's Skill, hook package and workbench counts open their sub-pages, and the App Center's **View in agent settings** opens the Workbenches sub-page.
- Answers read here are handed to the Plugins page's stores, so that page shows an install made here without asking again.
- The docs describe the four sub-pages and name the sub-page that holds each switch.
