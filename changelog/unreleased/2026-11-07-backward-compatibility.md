# Backward compatibility in this batch

- **Date:** 2026-11-07
- **Type:** process
- **Scope:** `server`
- **PR:** [#1508](https://github.com/Prism-Shadow/penguin-harness/pull/1508)

[中文版](2026-11-07-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Organization employees made before Agents had an author

[Agents gained an author](2026-11-07-agent-author.md). An Agent made before that has no `author` in its `system_config.yaml`, and a missing author reads as `user`. For most Agents that is right. For an organization's employees it is wrong: company mode created them, so after the upgrade they would have been listed under **Created by users**.

Chosen (owner's decision): **a one-time migration when the Agent list is read.** Each time `GET /api/projects/:projectId/agents` answers, the server first takes the Agents the Project's organizations employ (the list's `employments`: every chart entry of every organization directory, paused ones included, plus the CEO of a chart that does not parse). Each employee whose config has no `author` key gets `author: company`:

- The file is edited in place through yaml `parseDocument`, as a config `PUT` edits it, so comments and formatting are kept. The new key goes right after `description`, or after `name` when there is no description.
- A key that is already there is never overwritten, whatever its value. An employee changed back to `user` in Agent settings stays `user`.
- A config that does not parse is left as it is. An employee that the chart names but whose folder has no config gets no file.
- Once a file has an author, later listings write nothing to it.
- Agents that no organization employs are not touched and keep reading as `user`.

### Scope

The Agents of every Project, on every server, machines included: each server stamps its own Agents when its own list is read. Only organization employees are written.

### What you need to do

Nothing. Opening the Agents page, or running `penguin agent ls`, reads the list and finishes the migration.

### Lifetime

The server maintainers keep this code until the next major release (1.0) and remove it in that release's preparation: `packages/server/src/services/agent-author-migration.ts`, its call in the Agent list route (`packages/server/src/http/routes/agents.ts`), `AgentConfig.stampMissingAuthor` (`packages/server/src/mechanisms/agents.ts`, `packages/server/src/services/agent-config-service.ts`) and the migration scenarios in `packages/server/test/agent-author.test.ts`. The `author` values it wrote stay in the files.

## Compatibility

No action is required on upgrade. After a downgrade, an older build ignores the `author` key. It keeps the key when it edits a config in place, but its **Restore default configuration** drops it. An employee that lost its key that way is stamped again on the next upgrade, and any other Agent reads as `user`.
