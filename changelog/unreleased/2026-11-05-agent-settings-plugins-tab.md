# Agent settings gain a Plugins tab, and workbenches can be switched off

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1497](https://github.com/Prism-Shadow/penguin-harness/pull/1497)

[中文版](2026-11-05-agent-settings-plugins-tab.zh.md)

The Agent settings page has a **Plugins** tab in place of the **Skills**, **Hooks** and **Workbenches** tabs. It lists the plugins installed on the agent, each with what it brought (Skills, hook packages, MCP servers, workbenches) and a status: **Installed**, **Update available**, **Incomplete** or **Not in library**. A plugin's row offers **Update** when it is behind the library or missing a part, and the Project owner's **Uninstall**, which removes every part in one request after a confirmation that lists them. Skills, hook packages and workbenches made or imported by hand are listed last, under **Not from a plugin**. The `?tab=skills`, `?tab=hooks` and `?tab=workbenches` addresses open the Plugins tab, and stay that way.

## Details

- The tab's header holds **Import** (a Skill, a hook package or a workbench, through the dialogs the old tabs had) and **Browse plugin library**, which opens the Plugins page with this agent as the current one.
- **Enable skills** with the **Skills prompt**, **Enable hooks** and the new **Enable workbenches** sit together on the tab. All of them are the Project owner's; a member sees their state. **Enable skills** and the **Skills prompt** were open to every member before.
- Each workbench has its own switch. A switched-off workbench, or every workbench while **Enable workbenches** is off, shows no tab beside the chat and cannot be opened as a full page; its history, restore, export and removal stay. A machine running an older version shows no switches.
- The Plugins page's **Uninstall** sends the same single request instead of one per part, and is offered to the Project owner only. An uninstall that could not remove a part names it with the reason; a machine too old for the request is said to need an update.
- An MCP server a plugin installed is listed under the plugin with what it still needs, and links to the **Tools** tab, where it is edited.
