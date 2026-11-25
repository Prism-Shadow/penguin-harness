# Every Project gets a system Agent

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#1654](https://github.com/Prism-Shadow/penguin-harness/pull/1654)

[中文版](2026-11-19-system-agent.zh.md)

Every Project now holds a third built-in Agent, `system_agent`, shown as **System**. It will own the system apps (Models, Plugins, Machines, Cost Center and Evaluation Center) once they move into the App Center. It runs no conversation, takes no plugin, and cannot be deleted, renamed, exported or overwritten by an import (design: [PRFC-0033](https://github.com/Prism-Shadow/penguin-harness-design/pull/496)).

## Details

- **Provisioning.** A new Project is created with the system Agent beside `default_agent`, from the default template, with no plugin and `system: true` in its `system_config.yaml`. A Project made before this change gets it the first time its Agents are listed. Its card sorts with the other built-in Agents. The system Agent is the Agent whose id is `system_agent` and whose config carries the key; core's `state/system-agent.ts` decides that, and every check asks it.
- **Refusals.**
  - Creating a Session on it gives 409 `system_agent_no_sessions`. The check sits in the session service's create path, which the Web App, the CLI, AMSP, schedules, organizations and workbenches all reach. Its Agent API settings and keys give the same 409.
  - Installing a plugin on it gives 409 `system_agent_closed`.
  - Deleting it gives 409 `cannot_delete_builtin_agent`.
  - Changing its name, description or author, exporting it, and an overwrite import onto it each give 409 `builtin_agent_locked`.
  - Creating an Agent with the id `system_agent` in a Project that does not have it yet gives 409 `agent_id_reserved`.
- **Agent lists.** `AgentSummary.system` and `AgentConfigDto.system` mark it. A workbench's `host.listAgents()` leaves it out. Resetting its config to the defaults keeps it the system Agent.
- **Web App.**
  - The Agents page shows a **System** card. Its name and description come from the dictionary, and it has no New chat, Usage or Export, and the built-in Agents' disabled delete.
  - Its settings page has only a read-only Overview and a Plugins tab that will list its system apps.
  - It is never offered where an Agent is picked: the new-chat picker, `/agent`, the Project's new-chat default, Benchmark targets, the plugin market's manage-installs list, company hires, trace import, and every "Create with AI" prompt. It has no sidebar group, never becomes the current Agent, and is left out of the kernel-update notice.
  - A machine's own system Agent is not listed on this server.
- **An Agent already named `system_agent`** stays the user's own. The Agents page asks the Project's owner to move it to another id; see [backward compatibility](2026-11-19-backward-compatibility.md).
