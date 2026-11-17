# An Agent's Plugins tab splits into four sub-pages: Plugins, Skills, Hooks and Workbenches

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`, `docs`
- **PR:** [#1549](https://github.com/Prism-Shadow/penguin-harness/pull/1549)

[中文版](2026-11-12-agent-settings-plugin-subpages.zh.md)

The Agent settings Plugins tab became four sub-pages, switched by a segmented control under the tab strip, with the current sub-page's actions at the end of the same row. Each sub-page is a value of `?tab=`: `plugins` (the default), `skills`, `hooks` and `workbenches`, so the older addresses of the tabs it replaced open the matching sub-page. The four share one read of the Agent's lists.

## Details

- **Plugins** lists the Agent's plugins one compact row each, in the shape of a hook package's row (the icon; the name with the status right after it, then the Plugins page card's tags — category, built in, installed on server, link, shared by all machines — each with its hover hint; the plugin's one-line description under the name; the version; the actions. Installed and Available are said by the section, not again on the row), under **Installed** (every plugin the Agent carries a part of) and **Available** (library plugins the Agent carries nothing of and that ship a Skill, a hook package, an MCP server or a workbench), with a search box and **Open the Plugins page**. Any member installs and updates from a row, the Project owner uninstalls; a stdio server's command, an update's rewritten parts and an uninstall's parts are confirmed first, as on the Plugins page. An Agent on a machine installs from that machine's library, and a machine older than the uninstall reads as needing an update.
- A plugin's detail is the Plugins page's dialog with the Agent's status, no "used by" count, the README and files from the Agent's server, and an **On this agent** section listing its parts by kind, a part the library ships and the Agent lacks marked **Missing**; each kind leads to its sub-page (MCP servers to the Tools tab). The detail has an address of its own, `?tab=plugins&plugin=<name>`.
- **Skills**, **Hooks** and **Workbenches** each hold their switch, every part of their kind in one list, and their own Import button in place of the former Import menu; the Skills sub-page keeps the skills prompt. Selecting a row opens that part's own folder in the Agent State in a read-only file browser (preview and Download; a Markdown preview leaves out its frontmatter, as the plugin detail does), starting at `SKILL.md`, a hook package's `README.md` or `hooks.json`, or a workbench's `README.md` or `package.json`; dot entries and `node_modules` are not listed, and a workbench's **Open** still opens the app. A part a plugin installed carries a puzzle mark after its name that names the plugin; selecting it switches to the Plugins sub-page, clears its search and highlights that plugin's row without opening the detail: the row scrolls to the middle of the window with the focus on its name, wears an accent wash inside a 2px accent ring for about 2 s, then fades. Removing such a part says which plugin installed it.
- On the Plugins sub-page a click anywhere on a plugin's row opens its detail, not only on its name.
- A workbench's App Center switch reads **Show in the App Center** (in Chinese 「展示到应用中心」, formerly 「应用中心」), its hint says what showing there means, and the row's **More** menu gains the same setting as a checkable first item, above a separator; the item writes at once and closes the menu. A machine's Agent has neither.
- The shared list row takes a click on its surface (`onBodyClick`) and can be marked as the row a jump landed on (`marked`, with `useMarkedRow`); the gallery's list-row board shows both.
- Hook package rows use the shared list row, so they read like Skill rows.
- The Agents page's Skill, hook package and workbench counts open their sub-pages, and the App Center's **View in agent settings** opens the Workbenches sub-page.
- Answers read here are handed to the Plugins page's stores, so that page shows an install made here without asking again.
- The docs describe the four sub-pages and name the sub-page that holds each switch.
