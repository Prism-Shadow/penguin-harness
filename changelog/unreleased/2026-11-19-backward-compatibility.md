# Backward compatibility in this batch

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`, `server`, `web`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[中文版](2026-11-19-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## An Agent already named `system_agent`

[Every Project gets a system Agent](2026-11-19-system-agent.md) under the id `system_agent`. Agent ids are the user's to choose, so a Project may already hold an Agent with that id. Such an Agent has no `system: true` key in its `system_config.yaml`, so it stays an ordinary Agent: it chats, deletes and exports as before, and provisioning never overwrites it. The Project has no system Agent while it holds the id. The Agents page shows the Project's owner a notice naming it.

### Scope

A Project of any server, desktop install or machine whose `agents/system_agent/` existed before the upgrade.

### What you need to do

To give that Project its system Agent: export the Agent, import it under another id, and delete the old one. The system Agent is added the next time the Project's Agents are listed.

### Lifetime

The owner of core's `state/system-agent.ts` keeps the key requirement documented there as this case's handling, and the Agents page's notice (`holdsSystemAgentId` in `packages/web/src/lib/builtin-agents.ts` and the `systemIdHeld` strings), until the next major version (1.0), and removes the notice in that release's preparation.
