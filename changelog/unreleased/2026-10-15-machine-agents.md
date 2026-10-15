# A machine's Agents are that machine's own

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-10-15-machine-agents.zh.md)

The Agents page, the create dialog and the plugin market treated an Agent as one per Project: the Agents page folded every connected machine's list into this server's by Agent id, so a machine's own `default_agent` (and any Agent whose id also existed here) never showed, and an Agent only a machine had was shown as an inert card that pointed elsewhere to be managed. Each machine's Agents are now listed, opened, edited, chatted with, deleted and installed into as that machine's own.

## Details

- The Agents page lists this server's Agents, then a ruled section per installed machine (**Agents on gpu-box**), each card named `[SSH: <alias>]` after the Agent's name, the way a machine's Workspace group is named. Two servers' Agents of one id are two cards. A machine card's name, Settings and counts open the Agent's settings on that machine, New chat opens a draft in that machine's temporary workspace, and Delete deletes it there after a confirmation that names the machine; Cost Center stays this server's. A machine that is reconnecting, stopped or failing says why under its title, above the Agents it was last seen with, every control off.
- The Agent settings page takes `?machine=<machine id>`: every tab reads and writes through that machine, its new-chat hand-offs (import a Skill or hook package in a chat, add memories, vault keys or scheduled tasks with AI) open on that machine, the schedule dialog's model, Workspace and Session come from it, and the API tab shows the machine's own address. A machine that cannot be asked shows the reason instead of the Agent.
- The create dialog starts with **Location** (this server, or a connected machine) when a machine is connected. On a machine the plugins on offer are that machine's library, the Skills directory is browsed there, and the Agent is created there; the dialog lands on its settings on that machine.
- The plugin market's **Manage installs** lists the connected machines' Agents after this server's, each with `[SSH: <alias>]`. Install, uninstall, update and Set up on such a row go to that machine and use its library; a card's "used by" count and status include them. The nav badge and the bulk update notice still count this server's Agents only.
- A machine Agent created or deleted from these pages is read again by the session list too, so the sidebar stops listing a deleted Agent's Sessions.
- The agent-scoped API wrappers take a trailing machine id (`lib/agent-machine.ts`, `lib/machine-agents.ts` hold the shared helpers), and `deleteAgent` now encodes its path.
- The Agents docs and the plugin install docs describe machine Agents and the create location.
