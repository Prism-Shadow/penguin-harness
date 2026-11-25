# The agent domain's services join the agent library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/agent`, `library/session`

[中文版](2026-11-24-library-agent-services.zh.md)

The server's Agent service, its read views and its deletion flow move beside the agent vocabulary package that landed before them. `@prismshadow/penguin-library-agent` takes the Agent service (the list, the creation, the background purge and the plugin update surface), the installed-skills read view, the person's-task runner, the everywhere-deletion flow and the one-time employee-author migration, together with the pieces they speak: the Agent lifecycle contract, the list card's and creation's DTOs, the bounded tree purge, the semantic id rules and the session title rule (the last one into `@prismshadow/penguin-library-session`).

The server imports these; nothing in the library imports the server. The moved services keep the server-side assembly where the server's own mechanisms are bound: the plugin library and its server modules, the workbenches migration and the directory-skills resolver satisfy structural ports the package declares (`AgentPluginLibrary`, `AgentPluginModules`, `AgentWorkbenches`, `AgentDirectorySkills`), and the task runner's session runtime, creation path and outcome reader arrive as ports too (`AgentTaskRunner`, `AgentTaskSessions`, `AgentTaskOutcome`). The API's export surface stays whole through re-exports — the server's own import paths keep the moved names resolving.

## Details

- `library/agent` grows: `agent-service`, `agent-skills`, `agent-tasks`, `agent-deletion`, `agent-author-migration`, `tree-purge`, `ids`, and the ports module (`AgentPluginLibrary`, `AgentPluginModules`, `AgentWorkbenches`, `AgentDirectorySkills`, `AgentTaskRunner`, `AgentTaskSessions`, `AgentTaskOutcome`). The `AgentLifecycle` contract moves into the package's contract module, and the package index now exports the service shapes.
- `library/session` grows the session title rule (`session-title`), the rule a rename and a task's title both apply.
- The list card's, creation's and deletion's DTOs (`AgentListItem`, `AgentCreation`, `AgentDeletionInfo`, `PluginUpdateRef`) move into the agent package's types; the server's API contract file re-exports them, so no response shape changes.

## Compatibility

This batch changes no behavior: the moved code is the same code at a new address. The existing server import paths — `services/agent-service.ts`, `services/agent-skills.ts`, `services/agent-tasks.ts`, `services/agent-deletion.ts`, `services/agent-author-migration.ts`, `services/tree-purge.ts`, `services/ids.ts`, `mechanisms/agents.ts`, `http/session-title.ts` and the API contract file — still export the moved names (re-exported from the library packages); change imports to the library packages when you touch those files next.
