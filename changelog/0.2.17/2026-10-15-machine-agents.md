# A machine's Agents are that machine's own

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `web`, `ui`, `docs`
- **PR:** [#1152](https://github.com/Prism-Shadow/penguin-harness/pull/1152)

[中文版](2026-10-15-machine-agents.zh.md)

The Agents page, the create dialog and the plugin market treated an Agent as one per Project: the Agents page folded every connected machine's list into this server's by Agent id, so a machine's own `default_agent` (and any Agent whose id also existed here) never showed, and an Agent only a machine had was shown as an inert card that pointed elsewhere to be managed. Each machine's Agents are now listed, opened, edited, chatted with, deleted and installed into as that machine's own.

## Details

- The Agents page lists every installed machine's Agents in the same list as this server's, in the list's order (oldest created first), the way the sidebar lists machine Workspaces beside local ones; each machine card is named `[SSH: <alias>]` after the Agent's name, as a machine's Workspace group is. Two servers' Agents of one id are two cards. A machine card's name, Settings and counts open the Agent's settings on that machine, New chat opens a draft in that machine's temporary workspace, and Delete deletes it there after a confirmation that names the machine; Cost Center stays this server's. The Agents of a machine that is reconnecting, stopped or failing stay in the list as last seen, greyed, with an unplugged icon after the tag whose hint is the reason, and every control off with the same reason.
- The Agent settings page takes `?machine=<machine id>`: every tab reads and writes through that machine, its new-chat hand-offs (import a Skill or hook package in a chat, add memories, vault keys or scheduled tasks with AI) open on that machine, the schedule dialog's model, Workspace and Session come from it, and the API tab shows the machine's own address. A machine that cannot be asked shows the reason instead of the Agent.
- A machine Session's links to its Agent's settings (the memory panel's manage link, the composer's Agent settings) now open that Agent on its machine. They already carried `?machine=`, but the page showed this server's Agent of the same id.
- The create dialog starts with **Location** (this server, or a connected machine) when a machine is connected. On a machine the plugins on offer are that machine's library, the Skills directory is browsed there, and the Agent is created there; the dialog lands on its settings on that machine.
- The plugin market's **Manage installs** lists the connected machines' Agents beside this server's in the Agents page's order, each with `[SSH: <alias>]`. Install, uninstall, update and Set up on such a row go to that machine and use its library; a card's "used by" count and status include them. The nav badge and the bulk update notice still count this server's Agents only.
- A machine Agent created or deleted from these pages is read again by the session list too, so the sidebar stops listing a deleted Agent's Sessions.
- The machine switch on the plugin market header and on the Settings dialog's Plugins page became the shared `Select` at the `sm` rung, the same height as the search box, the grouping select and the buttons beside it (it was a fixed-height button, about 5px taller than them); `Button` gained a `base` rung matching the `base` controls, and the gallery shows a select, an input and a button at each rung.
- The agent-scoped API wrappers take a trailing machine id (`lib/agent-location.ts`, `lib/machine-agent-lists.ts` hold the shared helpers), and `deleteAgent` now encodes its path.
- The Agents docs and the plugin install docs describe machine Agents and the create location.
