/**
 * Extensible Agent authorization role registry (`RoleRegistry`), declarative role tree
 * (`ROLE_TREE`), and fine-grained HTTP route catalog (`ALL_HTTP_ROUTE_IDS`).
 *
 * Built-in server domains are organized into 20 domain triples (`<domain>.read`,
 * `<domain>.maintain`, `<domain>.all`) and 6 composite persona roles (`none`, `readonly`,
 * `general`, `system-maintainer`, `admin`, `full-permissions`). External modules and plugins
 * extend the role tree and route catalog without modifying this file by contributing:
 * - `"HttpModule.roles"` (or `"AgentAuthPermissionProvider.roles"`): defines new role nodes,
 *   merges additional `routes` / `children` / `flags` into existing roles (via `role`), or
 *   grafts new roles into parent roles such as `readonly`, `general@self`, or `system-maintainer`
 *   (via `parents`).
 * - `"HttpModule.routes"`: declares optional `endpoints` (`"METHOD /subpath"` -> fine-grained
 *   route ID) for multi-endpoint Hono groups and optional `roles` (e.g. `["readonly"]` or
 *   `["myPlugin.maintain", "general@self"]`) to bind routes directly into role nodes.
 */

const BUILTIN_DIRECT_HTTP_ROUTE_IDS = [
  "admin.pluginConfig.action",
  "admin.pluginConfig.get",
  "admin.pluginConfig.update",
  "admin.settings.get",
  "admin.settings.listProxyProbes",
  "admin.settings.runProxyProbe",
  "admin.settings.update",
  "admin.users.create",
  "admin.users.delete",
  "admin.users.list",
  "admin.users.setPassword",
  "agentDeletions.get",
  "agents.messaging.feishu.get",
  "agents.messaging.feishu.update",
  "agents.messaging.qq.get",
  "agents.messaging.qq.update",
  "agents.messaging.telegram.get",
  "agents.messaging.telegram.update",
  "agents.messaging.wechat.get",
  "agents.messaging.wechat.scanPoll",
  "agents.messaging.wechat.scanStart",
  "agents.messaging.wechat.update",
  "auth.login",
  "auth.logout",
  "command.exec",
  "desktop.Current",
  "desktop.pickDirectory",
  "desktop.privacy.open",
  "desktop.status",
  "desktop.update.check",
  "desktop.update.download",
  "desktop.update.install",
  "desktop.window.action",
  "health",
  "me.get",
  "me.updateAvatar",
  "me.updateDisplayName",
  "me.updatePassword",
  "messaging.listAccountHolders",
  "messaging.listAccounts",
  "modelRegistry.get",
  "oauth.anthropic.authorize",
  "oauth.anthropic.callback",
  "oauth.anthropic.disconnect",
  "oauth.codex.authorize",
  "oauth.codex.callback",
  "oauth.codex.complete",
  "oauth.codex.disconnect",
  "projects.create",
  "projects.delete",
  "projects.list",
  "session.archive",
  "session.create",
  "session.delete",
  "session.export",
  "session.forward",
  "session.get",
  "session.history",
  "session.list",
  "session.rename",
  "session.runTask",
  "session.steer",
  "session.stop",
  "session.stream",
  "session.truncate",
  "session.unarchive",
  "session.updateModel",
  "session.updateSandbox",
  "session.updateThinkingLevel",
  "session.uploadAttachments",
  "session.uploadImages",
  "setup.complete",
  "setup.status",
  "skills.global.list",
  "System.Config",
  "usage.daily",
  "usage.get",
  "usage.stats",
] as const;

export const DIRECT_HTTP_ROUTE_IDS: readonly string[] = [...BUILTIN_DIRECT_HTTP_ROUTE_IDS];

/**
 * Built-in mapping from multi-endpoint `HttpModule.routes` group contribution IDs + `"METHOD /subpath"`
 * to fine-grained route IDs. External modules and plugins can register additional group mappings
 * via `HttpModule.routes` (`endpoints`) or `RoleRegistry.registerGroupEndpoints`.
 */
const BUILTIN_HTTP_GROUP_ENDPOINT_IDS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "sessions.agents": {
    "GET /": "agent.list",
    "POST /": "agent.create",
    "POST /:agentId/duplicate": "agent.duplicate",
    "DELETE /:agentId": "agent.delete",
    "GET /:agentId/auth": "agent.auth.get",
    "PUT /:agentId/auth": "agent.auth.update",
  },
  "sessions.agent-config": {
    "GET /": "agent.config.get",
    "PUT /": "agent.config.update",
    "PUT /avatar": "agent.avatar.update",
  },
  "sessions.agent-Export": {
    "GET /:agentId/export": "agent.export",
    "POST /import/preview": "agent.import.preview",
    "POST /import": "agent.import.apply",
  },
  "sessions.workspace": {
    "GET /:sessionId/files": "workspace.listFiles",
    "GET /:sessionId/file": "workspace.readFile",
    "PUT /:sessionId/file": "workspace.writeFile",
    "GET /:sessionId/raw": "workspace.readRawFile",
    "POST /:sessionId/files/upload": "workspace.uploadFiles",
    "POST /:sessionId/directory": "workspace.createDirectory",
    "DELETE /:sessionId/files": "workspace.deleteEntry",
    "GET /:sessionId/download": "workspace.downloadArchive",
    "GET /:sessionId/stat": "workspace.statFile",
  },
  "sessions.archived": {
    "GET /archived-sessions": "session.archived.list",
    "GET /archived-sessions/:sessionId/messages": "session.archived.messages",
  },
  "sessions.subagents": {
    "GET /:sessionId/subagents": "session.subagents.list",
  },
  "sessions.fork": {
    "POST /:sessionId/fork": "session.fork",
  },
  "sessions.btw": {
    "POST /:sessionId/btw": "session.btw",
  },
  "sessions.shell-exec": {
    "POST /:sessionId/shell-exec": "session.shellExec",
  },
  "sessions.title-Regenerate": {
    "POST /:sessionId/regenerate-title": "session.regenerateTitle",
  },
  "sessions.active-Ids": {
    "GET /active-ids": "session.activeIds",
  },
  "sessions.memory": {
    "GET /:sessionId/memory": "memory.session.list",
    "GET /:sessionId/memory/file": "memory.session.readFile",
  },
  "agents.memory": {
    "GET /:agentId/memory": "memory.agent.list",
    "GET /:agentId/memory/file": "memory.agent.readFile",
    "PUT /:agentId/memory/file": "memory.agent.writeFile",
    "DELETE /:agentId/memory/file": "memory.agent.deleteFile",
  },
  schedules: {
    "GET /": "schedule.list",
    "GET /runs": "schedule.runs",
    "PUT /:name": "schedule.upsert",
    "DELETE /:name": "schedule.delete",
  },
  "schedules.session": {
    "GET /:sessionId/schedule": "schedule.session.list",
    "GET /:sessionId/schedule/runs": "schedule.session.runs",
    "PUT /:sessionId/schedule/:name": "schedule.session.upsert",
    "DELETE /:sessionId/schedule/:name": "schedule.session.delete",
  },
  "skills.agent": {
    "GET /": "skill.agent.list",
    "GET /:skillName": "skill.agent.get",
    "GET /:skillName/files/*": "skill.agent.readFile",
    "POST /": "skill.agent.create",
    "PUT /:skillName": "skill.agent.update",
    "PUT /:skillName/enabled": "skill.agent.setEnabled",
    "POST /enable-all": "skill.agent.enableAll",
    "POST /disable-all": "skill.agent.disableAll",
    "DELETE /:skillName": "skill.agent.delete",
    "POST /install": "skill.agent.install",
    "POST /upload": "skill.agent.upload",
  },
  "skills.session": {
    "GET /:sessionId/skills": "skill.session.list",
    "GET /:sessionId/skills/:skillName": "skill.session.get",
    "PUT /:sessionId/skills/:skillName/enabled": "skill.session.setEnabled",
    "POST /:sessionId/skills/enable-all": "skill.session.enableAll",
    "POST /:sessionId/skills/disable-all": "skill.session.disableAll",
    "DELETE /:sessionId/skills/:skillName": "skill.session.delete",
    "POST /:sessionId/skills/install": "skill.session.install",
    "POST /:sessionId/skills/upload": "skill.session.upload",
  },
  "skills.hub": {
    "GET /registry": "skill.hub.registry",
    "GET /search": "skill.hub.search",
    "POST /import": "skill.hub.import",
  },
  "plugins.installed": {
    "GET /": "plugin.installed.list",
    "POST /install": "plugin.installed.install",
    "POST /upload": "plugin.installed.upload",
    "POST /reinstall": "plugin.installed.reinstall",
    "POST /:id/upgrade": "plugin.installed.upgrade",
    "DELETE /:id": "plugin.installed.uninstall",
  },
  "plugins.marketplace": {
    "GET /": "plugin.marketplace.list",
  },
  "plugins.agent": {
    "GET /": "plugin.agent.list",
    "PUT /:pluginId/enabled": "plugin.agent.setEnabled",
    "PUT /:pluginId/config": "plugin.agent.updateConfig",
    "POST /:pluginId/action": "plugin.agent.action",
  },
  "plugins.project": {
    "GET /": "plugin.project.list",
    "PUT /:pluginId/enabled": "plugin.project.setEnabled",
    "PUT /:pluginId/config": "plugin.project.updateConfig",
    "POST /:pluginId/action": "plugin.project.action",
  },
  "plugins.mount": {
    "GET /:projectId/agents/:agentId/plugins/:pluginId/ui/*": "plugin.mount.agentUi",
    "ALL /:projectId/agents/:agentId/plugins/:pluginId/api": "plugin.mount.agentApi",
    "ALL /:projectId/agents/:agentId/plugins/:pluginId/api/*": "plugin.mount.agentApi",
    "GET /:projectId/plugins/:pluginId/ui/*": "plugin.mount.projectUi",
    "ALL /:projectId/plugins/:pluginId/api": "plugin.mount.projectApi",
    "ALL /:projectId/plugins/:pluginId/api/*": "plugin.mount.projectApi",
  },
  "cli.commands": {
    "GET /": "cli.commands.list",
    "POST /:pluginId/:name": "cli.commands.invoke",
  },
  workbenches: {
    "GET /:projectId/agents/:agentId/workbenches": "workbench.list",
    "GET /:projectId/agents/:agentId/workbenches/:id/meta": "workbench.meta",
    "POST /:projectId/agents/:agentId/workbenches/:id/duplicate": "workbench.duplicate",
    "GET /:projectId/agents/:agentId/workbenches/:id/versions": "workbench.versions.list",
    "POST /:projectId/agents/:agentId/workbenches/:id/versions": "workbench.versions.create",
    "POST /:projectId/agents/:agentId/workbenches/:id/versions/:version/restore":
      "workbench.versions.restore",
    "GET /:projectId/agents/:agentId/workbenches/:id/ui/*": "workbench.ui",
    "ALL /:projectId/agents/:agentId/workbenches/:id/api": "workbench.api",
    "ALL /:projectId/agents/:agentId/workbenches/:id/api/*": "workbench.api",
  },
  "models.config": {
    "GET /config": "model.config.get",
    "PUT /config/default-model": "model.config.setDefaultModel",
    "PUT /config/default-image-model": "model.config.setDefaultImageModel",
    "PUT /config/default-speech-model": "model.config.setDefaultSpeechModel",
    "PUT /config/attachment-limits": "model.config.setAttachmentLimits",
    "PUT /config/sandbox": "model.config.setSandbox",
    "PUT /config/providers/:provider": "model.config.updateProvider",
    "DELETE /config/providers/:provider": "model.config.deleteProvider",
    "POST /config/providers/:provider/test": "model.config.testProvider",
    "POST /config/custom-models": "model.config.addCustomModel",
    "PUT /config/custom-models/:modelId": "model.config.updateCustomModel",
    "DELETE /config/custom-models/:modelId": "model.config.deleteCustomModel",
    "POST /config/custom-models/:modelId/test": "model.config.testCustomModel",
  },
  vault: {
    "GET /:agentId/vault": "vault.agent.list",
    "PUT /:agentId/vault/:key": "vault.agent.set",
    "DELETE /:agentId/vault/:key": "vault.agent.delete",
    "GET /sessions/:sessionId/vault": "vault.session.list",
    "PUT /sessions/:sessionId/vault/:key": "vault.session.set",
    "DELETE /sessions/:sessionId/vault/:key": "vault.session.delete",
  },
  traces: {
    "GET /": "trace.list",
    "GET /stats": "trace.stats",
    "GET /:traceId": "trace.get",
    "DELETE /:traceId": "trace.delete",
    "POST /cleanup": "trace.cleanup",
  },
  benchmarks: {
    "GET /": "benchmark.list",
    "POST /": "benchmark.create",
    "GET /:id": "benchmark.get",
    "DELETE /:id": "benchmark.delete",
    "GET /:id/runs": "benchmark.runs.list",
    "POST /:id/runs": "benchmark.runs.start",
    "GET /:id/runs/:runId": "benchmark.runs.get",
    "POST /:id/runs/:runId/stop": "benchmark.runs.stop",
    "DELETE /:id/runs/:runId": "benchmark.runs.delete",
    "GET /:id/runs/:runId/stream": "benchmark.runs.stream",
    "GET /:id/leaderboard": "benchmark.leaderboard",
    "POST /:id/runs/:runId/cases/:caseId/analyze": "benchmark.cases.analyze",
    "POST /:id/runs/:runId/analyze": "benchmark.runs.analyze",
    "POST /:id/runs/:runId/optimize": "benchmark.runs.optimize",
    "POST /:id/runs/:runId/Export- findings": "benchmark.runs.exportFindings",
  },
  org: {
    "GET /": "org.list",
    "POST /": "org.create",
    "GET /:orgId": "org.get",
    "PUT /:orgId": "org.update",
    "DELETE /:orgId": "org.delete",
    "GET /:orgId/members": "org.member.list",
    "POST /:orgId/members": "org.member.add",
    "GET /:orgId/members/stats": "org.member.stats",
    "GET /:orgId/members/:agentId": "org.member.get",
    "PUT /:orgId/members/:agentId": "org.member.update",
    "DELETE /:orgId/members/:agentId": "org.member.remove",
    "POST /:orgId/members/:agentId/avatar": "org.member.uploadAvatar",
    "GET /:orgId/members/:agentId/avatar": "org.member.getAvatar",
    "GET /:orgId/channels": "org.channel.list",
    "POST /:orgId/channels": "org.channel.create",
    "PUT /:orgId/channels/reorder": "org.channel.reorder",
    "GET /:orgId/channels/:channelId": "org.channel.get",
    "PUT /:orgId/channels/:channelId": "org.channel.update",
    "DELETE /:orgId/channels/:channelId": "org.channel.delete",
    "POST /:orgId/channels/:channelId/members": "org.channel.addMember",
    "DELETE /:orgId/channels/:channelId/members/:agentId": "org.channel.removeMember",
    "GET /:orgId/channels/:channelId/messages": "org.channel.listMessages",
    "POST /:orgId/channels/:channelId/messages": "org.channel.postMessage",
    "GET /:orgId/stream": "org.stream",
    "GET /:orgId/tickets": "org.ticket.list",
    "POST /:orgId/tickets": "org.ticket.create",
    "GET /:orgId/tickets/:ticketId": "org.ticket.get",
    "PUT /:orgId/tickets/:ticketId": "org.ticket.update",
    "DELETE /:orgId/tickets/:ticketId": "org.ticket.delete",
    "POST /:orgId/tickets/:ticketId/transition": "org.ticket.transition",
    "POST /:orgId/tickets/:ticketId/assign": "org.ticket.assign",
    "POST /:orgId/tickets/:ticketId/start": "org.ticket.start",
    "POST /:orgId/tickets/:ticketId/add-session": "org.ticket.addSession",
    "GET /:orgId/calendar": "org.calendar.list",
    "POST /:orgId/calendar": "org.calendar.create",
    "PUT /:orgId/calendar/:eventId": "org.calendar.update",
    "DELETE /:orgId/calendar/:eventId": "org.calendar.delete",
    "GET /:orgId/finance": "org.finance.summary",
    "PUT /:orgId/finance/budgets/:agentId": "org.finance.setBudget",
    "POST /:orgId/finance/unpause/:agentId": "org.finance.unpause",
    "GET /:orgId/proposals": "org.proposal.list",
    "POST /:orgId/proposals": "org.proposal.create",
    "GET /:orgId/proposals/verify-queue": "org.proposal.verifyQueue",
    "GET /:orgId/proposals/Settings": "org.proposal.getSettings",
    "PUT /:orgId/proposals/Settings": "org.proposal.updateSettings",
    "POST /:orgId/proposals/verify-batch": "org.proposal.verifyBatch",
    "GET /:orgId/proposals/:number": "org.proposal.get",
    "PUT /:orgId/proposals/:number": "org.proposal.update",
    "DELETE /:orgId/proposals/:number": "org.proposal.delete",
    "POST /:orgId/proposals/:number/ready": "org.proposal.ready",
    "POST /:orgId/proposals/:number/approve": "org.proposal.approve",
    "POST /:orgId/proposals/:number/reject": "org.proposal.reject",
    "POST /:orgId/proposals/:number/reopen": "org.proposal.reopen",
    "POST /:orgId/proposals/:number/revise": "org.proposal.revise",
    "POST /:orgId/proposals/:number/implement": "org.proposal.implement",
    "POST /:orgId/proposals/:number/impl": "org.proposal.setImpl",
    "POST /:orgId/proposals/:number/verify": "org.proposal.verify",
    "POST /:orgId/proposals/:number/merge": "org.proposal.merge",
    "POST /:orgId/proposals/:number/confirm": "org.proposal.confirm",
    "POST /:orgId/proposals/:number/Feedback": "org.proposal.feedback",
    "POST /:orgId/proposals/:number/inline-comments": "org.proposal.addInlineComment",
    "PUT /:orgId/proposals/:number/inline-comments/:commentId": "org.proposal.updateInlineComment",
    "DELETE /:orgId/proposals/:number/inline-comments/:commentId":
      "org.proposal.deleteInlineComment",
    "GET /:orgId/roadmaps": "org.roadmap.list",
    "POST /:orgId/roadmaps": "org.roadmap.create",
    "GET /:orgId/roadmaps/:number": "org.roadmap.get",
    "PUT /:orgId/roadmaps/:number": "org.roadmap.update",
    "DELETE /:orgId/roadmaps/:number": "org.roadmap.delete",
    "POST /:orgId/roadmaps/:number/items": "org.roadmap.upsertItem",
    "DELETE /:orgId/roadmaps/:number/items/:itemId": "org.roadmap.deleteItem",
    "POST /:orgId/roadmaps/:number/items/:itemId/approve": "org.roadmap.approveItem",
    "POST /:orgId/roadmaps/:number/items/:itemId/unapprove": "org.roadmap.unapproveItem",
    "POST /:orgId/roadmaps/:number/wake-moderator": "org.roadmap.wakeModerator",
  },
  "builtin-browser": {
    "GET /": "browser.status",
    "PUT /backend": "browser.setBackend",
    "GET /tabs": "browser.tabs.list",
    "POST /tabs": "browser.tabs.open",
    "DELETE /tabs/:tabId": "browser.tabs.close",
    "POST /tabs/:tabId/activate": "browser.tabs.activate",
    "POST /tabs/:tabId/navigate": "browser.tabs.navigate",
    "POST /tabs/:tabId/back": "browser.tabs.back",
    "POST /tabs/:tabId/forward": "browser.tabs.forward",
    "POST /tabs/:tabId/reload": "browser.tabs.reload",
    "POST /tabs/:tabId/click": "browser.tabs.click",
    "POST /tabs/:tabId/type": "browser.tabs.type",
    "POST /tabs/:tabId/press": "browser.tabs.press",
    "POST /tabs/:tabId/scroll": "browser.tabs.scroll",
    "POST /tabs/:tabId/eval": "browser.tabs.eval",
    "GET /tabs/:tabId/snapshot": "browser.tabs.snapshot",
    "GET /tabs/:tabId/screenshot": "browser.tabs.screenshot",
    "POST /cookies/import": "browser.cookies.import",
    "POST /handoff": "browser.handoff",
    "GET /stream": "browser.stream",
  },
  machines: {
    "GET /": "machine.list",
    "POST /": "machine.create",
    "POST /order": "machine.reorder",
    "POST /test-connection": "machine.testConnection",
    "GET /ssh-config-hosts": "machine.listSshConfigHosts",
    "POST /import-ssh-config": "machine.importSshConfig",
    "GET /:machineId": "machine.get",
    "PUT /:machineId": "machine.update",
    "DELETE /:machineId": "machine.delete",
    "POST /:machineId/connect": "machine.connect",
    "POST /:machineId/disconnect": "machine.disconnect",
    "GET /:machineId/stats": "machine.stats",
    "GET /:machineId/stats/stream": "machine.statsStream",
    "GET /:machineId/processes": "machine.processes",
    "DELETE /:machineId/processes/:pid": "machine.killProcess",
    "GET /:machineId/files": "machine.listFiles",
    "GET /:machineId/files/content": "machine.readFile",
    "PUT /:machineId/files/content": "machine.writeFile",
    "POST /:machineId/files/mkdir": "machine.mkdir",
    "POST /:machineId/files/rename": "machine.renameFile",
    "DELETE /:machineId/files": "machine.deleteFile",
    "GET /:machineId/files/download": "machine.downloadFile",
    "POST /:machineId/files/upload": "machine.uploadFile",
    "GET /:machineId/ports": "machine.listPorts",
    "POST /:machineId/ports": "machine.addPortForward",
    "DELETE /:machineId/ports/:forwardId": "machine.removePortForward",
    "GET /:machineId/server": "machine.serverStatus",
    "POST /:machineId/server/install": "machine.serverInstall",
    "POST /:machineId/server/start": "machine.serverStart",
    "POST /:machineId/server/stop": "machine.serverStop",
    "POST /:machineId/server/restart": "machine.serverRestart",
    "POST /:machineId/server/upgrade": "machine.serverUpgrade",
    "GET /:machineId/server/logs": "machine.serverLogs",
  },
  "machines.server-proxy": {
    "ALL /*": "machine.serverProxy",
  },
  themes: {
    "GET /": "themes.list",
    "GET /:id": "themes.get",
    "POST /": "themes.save",
    "DELETE /:id": "themes.delete",
  },
  version: {
    "GET /": "version.get",
    "POST /check": "version.check",
    "POST /update": "version.startUpdate",
    "POST /rollback": "version.rollback",
    "POST /restart": "version.restart",
  },
};

/**
 * Legacy route prefix aliases normalized to canonical route prefixes.
 * Additional aliases can be registered via `RoleRegistry.registerRouteAlias`.
 */
const BUILTIN_ROUTE_PREFIX_ALIASES: Readonly<Record<string, string>> = {
  "agents.feishu": "agents.messaging.feishu",
  "agents.qq": "agents.messaging.qq",
  "agents.telegram": "agents.messaging.telegram",
  "agents.wechat": "agents.messaging.wechat",
  "messaging.feishu": "agents.messaging.feishu",
  "messaging.qq": "agents.messaging.qq",
  "messaging.telegram": "agents.messaging.telegram",
  "messaging.wechat": "agents.messaging.wechat",
  "messaging.accounts": "messaging.listAccounts",
  "messaging.account-holders": "messaging.listAccountHolders",
};

/**
 * Built-in role identifiers: 20 domain triples (`<domain>.read`, `<domain>.maintain`,
 * `<domain>.all`) plus 6 composite persona roles (`none`, `readonly`, `general`,
 * `system-maintainer`, `admin`, `full-permissions`).
 */
export const BUILTIN_AGENT_AUTH_ROLES = [
  // 1. session
  "session.read",
  "session.maintain",
  "session.all",
  // 2. workspace
  "workspace.read",
  "workspace.maintain",
  "workspace.all",
  // 3. agent
  "agent.read",
  "agent.maintain",
  "agent.all",
  // 4. memory
  "memory.read",
  "memory.maintain",
  "memory.all",
  // 5. schedule
  "schedule.read",
  "schedule.maintain",
  "schedule.all",
  // 6. skill
  "skill.read",
  "skill.maintain",
  "skill.all",
  // 7. plugin
  "plugin.read",
  "plugin.maintain",
  "plugin.all",
  // 8. workbench
  "workbench.read",
  "workbench.maintain",
  "workbench.all",
  // 9. model
  "model.read",
  "model.maintain",
  "model.all",
  // 10. vault
  "vault.read",
  "vault.maintain",
  "vault.all",
  // 11. trace
  "trace.read",
  "trace.maintain",
  "trace.all",
  // 12. benchmark
  "benchmark.read",
  "benchmark.maintain",
  "benchmark.all",
  // 13. org
  "org.read",
  "org.maintain",
  "org.all",
  // 14. browser
  "browser.read",
  "browser.maintain",
  "browser.all",
  // 15. machine
  "machine.read",
  "machine.maintain",
  "machine.all",
  // 16. agents.messaging & messaging
  "agents.messaging.read",
  "agents.messaging.maintain",
  "agents.messaging.all",
  "messaging.read",
  "messaging.maintain",
  "messaging.all",
  // 17. project
  "project.read",
  "project.maintain",
  "project.all",
  // 18. command
  "command.read",
  "command.maintain",
  "command.all",
  // 19. system
  "system.read",
  "system.maintain",
  "system.all",
  // 20. admin
  "admin.read",
  "admin.maintain",
  "admin.all",
  // Composite / persona roles
  "none",
  "readonly",
  "general",
  "system-maintainer",
  "admin",
  "full-permissions",
] as const;

export type BuiltinAgentAuthRole = (typeof BUILTIN_AGENT_AUTH_ROLES)[number];

/**
 * Open role identifier type: includes all `BuiltinAgentAuthRole` values as well as custom roles
 * contributed by modules and plugins via `"HttpModule.roles"` or `"AgentAuthPermissionProvider.roles"`.
 */
export type AgentAuthRole = string;

/** A role reference in `RoleNode.children`, optionally qualified by `@<refinerId>` (e.g. `agent.maintain@self`). */
export type RoleChildRef = string;

/**
 * Default role assigned to newly created Agents (`general`): grants full day-to-day
 * session, workspace, org, browser, command, and self-scoped agent/memory/schedule/workbench
 * maintenance while withholding cross-Agent mutation and global system administration.
 */
export const DEFAULT_AGENT_AUTH_ROLE: AgentAuthRole = "general";

export interface RoleFlags {
  /** true = reaches every HTTP route without naming it (`admin`, `full-permissions`). */
  allEndpoints?: boolean;
  /** true = reaches human-gated endpoints (`requireHuman`) such as session creation/deletion and model key management. */
  agentApi?: boolean;
  /** true = may mutate Agent-scoped resources of other Agents in the same Project. */
  crossAgent?: boolean;
}

export interface RoleNode {
  /** Child roles (or route IDs) whose permissions are inherited by this role, optionally suffixed with `@<refinerId>`. */
  children?: readonly RoleChildRef[];
  /** Direct HTTP route IDs (or `<prefix>.*` wildcard patterns) granted at this role node, optionally suffixed with `@<refinerId>`. */
  routes?: readonly string[];
  /** Special capability flags carried by this role node. */
  flags?: RoleFlags;
}

/**
 * Declarative role contribution for `"HttpModule.roles"` or `"AgentAuthPermissionProvider.roles"`.
 *
 * - When defining a new role node, the contribution entry `id` is used as the role ID unless
 *   `role` is explicitly specified (allowing multiple contributions with globally unique `id`s
 *   to extend the same role node, such as `"readonly"` or `"general"`).
 * - `children`, `routes`, and `flags` are merged additively (set union) into the target role node.
 * - `parents` grafts the target role into each named parent role's `children` (supporting
 *   optional `@<refinerId>` on the parent entry, e.g. `parents: ["general@self", "system-maintainer"]`).
 */
export interface RoleContribution {
  /** Target role ID to define or extend; defaults to the contribution entry `id`. */
  role?: string;
  /** Child roles or route IDs inherited by this role, optionally suffixed with `@<refinerId>`. */
  children?: readonly string[];
  /** Direct HTTP route IDs (or `<prefix>.*` wildcard patterns) granted by this role, optionally suffixed with `@<refinerId>`. */
  routes?: readonly string[];
  /** Special capability flags carried by this role. */
  flags?: RoleFlags;
  /**
   * Parent roles that should inherit this role (e.g. `["readonly"]` or `["general@self"]`).
   * When a parent entry carries `@<refinerId>` (such as `"general@self"`), the parent role
   * inherits `<targetRole>@<refinerId>`.
   */
  parents?: readonly string[];
}

/**
 * Route-level authorization metadata declared on `"HttpModule.routes"` contributions or registered
 * programmatically via `RoleRegistry.registerRoute`.
 */
export interface RouteRoleRegistration {
  /** The `"HttpModule.routes"` contribution `id`. */
  id: string;
  /** Optional `"METHOD /subpath"` -> fine-grained route ID mapping for multi-endpoint Hono route groups. */
  endpoints?: Readonly<Record<string, string>>;
  /**
   * Optional role IDs (or `<roleId>@<refinerId>`, e.g. `["readonly"]` or `["myPlugin.maintain", "general@self"]`)
   * that are granted this route (and any sub-routes declared in `endpoints`).
   */
  roles?: readonly string[];
}

/** Parsed `<target>` and optional `@<refinerId>` suffix from a role or route grant entry. */
export interface RefinedGrantRef {
  target: string;
  refinerId: string | null;
}

/**
 * Splits a grant entry such as `"agent.maintain@self"` or `"session.delete@withAsk"`
 * into `{ target, refinerId }`. When no `@<refinerId>` is present, `refinerId` is `null`.
 */
export function parseRefinedGrant(spec: string): RefinedGrantRef {
  const trimmed = spec.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) {
    return { target: trimmed, refinerId: null };
  }
  const target = trimmed.slice(0, atIdx).trim();
  const refinerId = trimmed.slice(atIdx + 1).trim();
  return {
    target,
    refinerId: refinerId !== "" ? refinerId : null,
  };
}

/** Result of expanding a role and extra grants against a `RoleRegistry`. */
export interface ExpandedRoleGrant {
  allEndpoints: boolean;
  agentApi: boolean;
  crossAgent: boolean;
  apiIds: string[];
  routeRefiners: Record<string, string[]>;
}

const BUILTIN_ROLE_TREE: Readonly<Record<BuiltinAgentAuthRole, RoleNode>> = {
  // ---------------------------------------------------------------------------
  // 1. session (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "session.read": {
    routes: [
      "session.list",
      "session.get",
      "session.history",
      "session.stream",
      "session.export",
      "session.activeIds",
      "session.subagents.list",
      "session.archived.list",
      "session.archived.messages",
    ],
  },
  "session.maintain": {
    children: ["session.read"],
    routes: [
      "session.create",
      "session.runTask",
      "session.steer",
      "session.stop",
      "session.rename",
      "session.truncate",
      "session.fork",
      "session.btw",
      "session.shellExec",
      "session.regenerateTitle",
      "session.archive",
      "session.unarchive",
      "session.updateModel",
      "session.updateThinkingLevel",
      "session.updateSandbox",
      "session.uploadImages",
      "session.uploadAttachments",
    ],
  },
  "session.all": {
    children: ["session.maintain"],
    routes: ["session.delete", "session.forward"],
  },

  // ---------------------------------------------------------------------------
  // 2. workspace (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "workspace.read": {
    routes: [
      "workspace.listFiles",
      "workspace.readFile",
      "workspace.readRawFile",
      "workspace.statFile",
      "workspace.downloadArchive",
    ],
  },
  "workspace.maintain": {
    children: ["workspace.read"],
    routes: ["workspace.writeFile", "workspace.uploadFiles", "workspace.createDirectory"],
  },
  "workspace.all": {
    children: ["workspace.maintain"],
    routes: ["workspace.deleteEntry"],
  },

  // ---------------------------------------------------------------------------
  // 3. agent (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "agent.read": {
    routes: [
      "agent.list",
      "agent.config.get",
      "agent.auth.get",
      "agent.export",
      "agentDeletions.get",
    ],
  },
  "agent.maintain": {
    children: ["agent.read"],
    routes: ["agent.config.update", "agent.avatar.update"],
  },
  "agent.all": {
    children: ["agent.maintain"],
    routes: [
      "agent.create",
      "agent.duplicate",
      "agent.delete",
      "agent.import.preview",
      "agent.import.apply",
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. memory (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "memory.read": {
    routes: [
      "memory.session.list",
      "memory.session.readFile",
      "memory.agent.list",
      "memory.agent.readFile",
    ],
  },
  "memory.maintain": {
    children: ["memory.read"],
    routes: ["memory.agent.writeFile"],
  },
  "memory.all": {
    children: ["memory.maintain"],
    routes: ["memory.agent.deleteFile"],
  },

  // ---------------------------------------------------------------------------
  // 5. schedule (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "schedule.read": {
    routes: [
      "schedule.list",
      "schedule.runs",
      "schedule.session.list",
      "schedule.session.runs",
    ],
  },
  "schedule.maintain": {
    children: ["schedule.read"],
    routes: ["schedule.upsert", "schedule.session.upsert"],
  },
  "schedule.all": {
    children: ["schedule.maintain"],
    routes: ["schedule.delete", "schedule.session.delete"],
  },

  // ---------------------------------------------------------------------------
  // 6. skill (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "skill.read": {
    routes: [
      "skills.global.list",
      "skill.agent.list",
      "skill.agent.get",
      "skill.agent.readFile",
      "skill.session.list",
      "skill.session.get",
      "skill.hub.registry",
      "skill.hub.search",
    ],
  },
  "skill.maintain": {
    children: ["skill.read"],
    routes: [
      "skill.agent.create",
      "skill.agent.update",
      "skill.agent.setEnabled",
      "skill.agent.enableAll",
      "skill.agent.disableAll",
      "skill.agent.install",
      "skill.agent.upload",
      "skill.session.setEnabled",
      "skill.session.enableAll",
      "skill.session.disableAll",
      "skill.session.install",
      "skill.session.upload",
      "skill.hub.import",
    ],
  },
  "skill.all": {
    children: ["skill.maintain"],
    routes: ["skill.agent.delete", "skill.session.delete"],
  },

  // ---------------------------------------------------------------------------
  // 7. plugin (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "plugin.read": {
    routes: [
      "plugin.installed.list",
      "plugin.marketplace.list",
      "plugin.agent.list",
      "plugin.project.list",
      "plugin.mount.agentUi",
      "plugin.mount.projectUi",
    ],
  },
  "plugin.maintain": {
    children: ["plugin.read"],
    routes: [
      "plugin.agent.setEnabled",
      "plugin.agent.updateConfig",
      "plugin.agent.action",
      "plugin.project.setEnabled",
      "plugin.project.updateConfig",
      "plugin.project.action",
      "plugin.mount.agentApi",
      "plugin.mount.projectApi",
    ],
  },
  "plugin.all": {
    children: ["plugin.maintain"],
    routes: [
      "plugin.installed.install",
      "plugin.installed.upload",
      "plugin.installed.reinstall",
      "plugin.installed.upgrade",
      "plugin.installed.uninstall",
    ],
  },

  // ---------------------------------------------------------------------------
  // 8. workbench (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "workbench.read": {
    routes: [
      "workbench.list",
      "workbench.meta",
      "workbench.versions.list",
      "workbench.ui",
    ],
  },
  "workbench.maintain": {
    children: ["workbench.read"],
    routes: [
      "workbench.duplicate",
      "workbench.versions.create",
      "workbench.versions.restore",
      "workbench.api",
    ],
  },
  "workbench.all": {
    children: ["workbench.maintain"],
  },

  // ---------------------------------------------------------------------------
  // 9. model (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "model.read": {
    routes: ["modelRegistry.get", "model.config.get"],
  },
  "model.maintain": {
    children: ["model.read"],
    routes: [
      "model.config.setDefaultModel",
      "model.config.setDefaultImageModel",
      "model.config.setDefaultSpeechModel",
      "model.config.setAttachmentLimits",
      "model.config.testProvider",
      "model.config.addCustomModel",
      "model.config.updateCustomModel",
      "model.config.testCustomModel",
    ],
  },
  "model.all": {
    children: ["model.maintain"],
    routes: [
      "model.config.setSandbox",
      "model.config.updateProvider",
      "model.config.deleteProvider",
      "model.config.deleteCustomModel",
      "oauth.anthropic.authorize",
      "oauth.anthropic.callback",
      "oauth.anthropic.disconnect",
      "oauth.codex.authorize",
      "oauth.codex.callback",
      "oauth.codex.complete",
      "oauth.codex.disconnect",
    ],
  },

  // ---------------------------------------------------------------------------
  // 10. vault (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "vault.read": {
    routes: ["vault.agent.list", "vault.session.list"],
  },
  "vault.maintain": {
    children: ["vault.read"],
    routes: ["vault.agent.set", "vault.session.set"],
  },
  "vault.all": {
    children: ["vault.maintain"],
    routes: ["vault.agent.delete", "vault.session.delete"],
  },

  // ---------------------------------------------------------------------------
  // 11. trace (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "trace.read": {
    routes: ["trace.list", "trace.stats", "trace.get"],
  },
  "trace.maintain": {
    children: ["trace.read"],
    routes: ["trace.cleanup"],
  },
  "trace.all": {
    children: ["trace.maintain"],
    routes: ["trace.delete"],
  },

  // ---------------------------------------------------------------------------
  // 12. benchmark (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "benchmark.read": {
    routes: [
      "benchmark.list",
      "benchmark.get",
      "benchmark.runs.list",
      "benchmark.runs.get",
      "benchmark.runs.stream",
      "benchmark.leaderboard",
    ],
  },
  "benchmark.maintain": {
    children: ["benchmark.read"],
    routes: [
      "benchmark.create",
      "benchmark.runs.start",
      "benchmark.runs.stop",
      "benchmark.cases.analyze",
      "benchmark.runs.analyze",
      "benchmark.runs.optimize",
      "benchmark.runs.exportFindings",
    ],
  },
  "benchmark.all": {
    children: ["benchmark.maintain"],
    routes: ["benchmark.delete", "benchmark.runs.delete"],
  },

  // ---------------------------------------------------------------------------
  // 13. org (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "org.read": {
    routes: [
      "org.list",
      "org.get",
      "org.member.list",
      "org.member.stats",
      "org.member.get",
      "org.member.getAvatar",
      "org.channel.list",
      "org.channel.get",
      "org.channel.listMessages",
      "org.stream",
      "org.ticket.list",
      "org.ticket.get",
      "org.calendar.list",
      "org.finance.summary",
      "org.proposal.list",
      "org.proposal.verifyQueue",
      "org.proposal.getSettings",
      "org.proposal.get",
      "org.roadmap.list",
      "org.roadmap.get",
    ],
  },
  "org.maintain": {
    children: ["org.read"],
    routes: [
      "org.update",
      "org.member.add",
      "org.member.update",
      "org.member.uploadAvatar",
      "org.channel.create",
      "org.channel.reorder",
      "org.channel.update",
      "org.channel.addMember",
      "org.channel.removeMember",
      "org.channel.postMessage",
      "org.ticket.create",
      "org.ticket.update",
      "org.ticket.transition",
      "org.ticket.assign",
      "org.ticket.start",
      "org.ticket.addSession",
      "org.calendar.create",
      "org.calendar.update",
      "org.calendar.delete",
      "org.finance.setBudget",
      "org.finance.unpause",
      "org.proposal.create",
      "org.proposal.update",
      "org.proposal.ready",
      "org.proposal.reopen",
      "org.proposal.revise",
      "org.proposal.implement",
      "org.proposal.setImpl",
      "org.proposal.verify",
      "org.proposal.verifyBatch",
      "org.proposal.feedback",
      "org.proposal.addInlineComment",
      "org.proposal.updateInlineComment",
      "org.proposal.deleteInlineComment",
      "org.roadmap.create",
      "org.roadmap.update",
      "org.roadmap.upsertItem",
      "org.roadmap.deleteItem",
      "org.roadmap.approveItem",
      "org.roadmap.unapproveItem",
      "org.roadmap.wakeModerator",
    ],
  },
  "org.all": {
    children: ["org.maintain"],
    routes: [
      "org.create",
      "org.delete",
      "org.member.remove",
      "org.channel.delete",
      "org.ticket.delete",
      "org.proposal.updateSettings",
      "org.proposal.delete",
      "org.proposal.approve",
      "org.proposal.reject",
      "org.proposal.merge",
      "org.proposal.confirm",
      "org.roadmap.delete",
    ],
  },

  // ---------------------------------------------------------------------------
  // 14. browser (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "browser.read": {
    routes: [
      "browser.status",
      "browser.tabs.list",
      "browser.tabs.snapshot",
      "browser.tabs.screenshot",
      "browser.stream",
    ],
  },
  "browser.maintain": {
    children: ["browser.read"],
    routes: [
      "browser.tabs.open",
      "browser.tabs.close",
      "browser.tabs.activate",
      "browser.tabs.navigate",
      "browser.tabs.back",
      "browser.tabs.forward",
      "browser.tabs.reload",
      "browser.tabs.click",
      "browser.tabs.type",
      "browser.tabs.press",
      "browser.tabs.scroll",
      "browser.tabs.eval",
      "browser.handoff",
    ],
  },
  "browser.all": {
    children: ["browser.maintain"],
    routes: ["browser.setBackend", "browser.cookies.import"],
  },

  // ---------------------------------------------------------------------------
  // 15. machine (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "machine.read": {
    routes: [
      "machine.list",
      "machine.get",
      "machine.stats",
      "machine.statsStream",
      "machine.processes",
      "machine.listFiles",
      "machine.readFile",
      "machine.downloadFile",
      "machine.listPorts",
      "machine.serverStatus",
      "machine.serverLogs",
      "machine.listSshConfigHosts",
    ],
  },
  "machine.maintain": {
    children: ["machine.read"],
    routes: [
      "machine.reorder",
      "machine.testConnection",
      "machine.connect",
      "machine.disconnect",
      "machine.writeFile",
      "machine.mkdir",
      "machine.renameFile",
      "machine.uploadFile",
      "machine.addPortForward",
      "machine.removePortForward",
      "machine.serverStart",
      "machine.serverStop",
      "machine.serverRestart",
    ],
  },
  "machine.all": {
    children: ["machine.maintain"],
    routes: [
      "machine.create",
      "machine.importSshConfig",
      "machine.update",
      "machine.delete",
      "machine.killProcess",
      "machine.deleteFile",
      "machine.serverInstall",
      "machine.serverUpgrade",
      "machine.serverProxy",
    ],
  },

  // ---------------------------------------------------------------------------
  // 16. agents.messaging & messaging (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "agents.messaging.read": {
    routes: [
      "agents.messaging.feishu.get",
      "agents.messaging.qq.get",
      "agents.messaging.telegram.get",
      "agents.messaging.wechat.get",
      "agents.messaging.wechat.scanPoll",
      "agents.messaging.*.get",
      "agents.messaging.*.scanPoll",
    ],
  },
  "agents.messaging.maintain": {
    children: ["agents.messaging.read"],
    routes: [
      "agents.messaging.feishu.update",
      "agents.messaging.qq.update",
      "agents.messaging.telegram.update",
      "agents.messaging.wechat.update",
      "agents.messaging.wechat.scanStart",
      "agents.messaging.*.update",
      "agents.messaging.*.scanStart",
    ],
  },
  "agents.messaging.all": {
    children: ["agents.messaging.maintain"],
  },
  "messaging.read": {
    children: ["agents.messaging.read"],
    routes: ["messaging.listAccounts", "messaging.listAccountHolders"],
  },
  "messaging.maintain": {
    children: ["messaging.read", "agents.messaging.maintain"],
  },
  "messaging.all": {
    children: ["messaging.maintain", "agents.messaging.all"],
  },

  // ---------------------------------------------------------------------------
  // 17. project (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "project.read": {
    routes: ["projects.list"],
  },
  "project.maintain": {
    children: ["project.read"],
    routes: ["projects.create"],
  },
  "project.all": {
    children: ["project.maintain"],
    routes: ["projects.delete"],
  },

  // ---------------------------------------------------------------------------
  // 18. command (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "command.read": {
    routes: ["cli.commands.list"],
  },
  "command.maintain": {
    children: ["command.read"],
    routes: ["cli.commands.invoke"],
  },
  "command.all": {
    children: ["command.maintain"],
    routes: ["command.exec"],
  },

  // ---------------------------------------------------------------------------
  // 19. system (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "system.read": {
    routes: [
      "health",
      "System.Config",
      "setup.status",
      "me.get",
      "usage.get",
      "usage.daily",
      "usage.stats",
      "themes.list",
      "themes.get",
      "version.get",
      "desktop.status",
      "desktop.Current",
    ],
  },
  "system.maintain": {
    children: ["system.read"],
    routes: [
      "setup.complete",
      "auth.login",
      "auth.logout",
      "me.updateDisplayName",
      "me.updateAvatar",
      "themes.save",
      "version.check",
      "desktop.pickDirectory",
      "desktop.window.action",
    ],
  },
  "system.all": {
    children: ["system.maintain"],
    routes: [
      "me.updatePassword",
      "themes.delete",
      "version.rollback",
      "version.startUpdate",
      "version.restart",
      "desktop.update.check",
      "desktop.update.download",
      "desktop.update.install",
      "desktop.privacy.open",
    ],
  },

  // ---------------------------------------------------------------------------
  // 20. admin (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "admin.read": {
    routes: [
      "admin.users.list",
      "admin.settings.get",
      "admin.settings.listProxyProbes",
      "admin.pluginConfig.get",
    ],
  },
  "admin.maintain": {
    children: ["admin.read"],
    routes: [
      "agent.auth.update",
      "admin.settings.update",
      "admin.settings.runProxyProbe",
      "admin.pluginConfig.update",
      "admin.pluginConfig.action",
    ],
  },
  "admin.all": {
    children: ["admin.maintain"],
    routes: ["admin.users.create", "admin.users.setPassword", "admin.users.delete"],
  },

  // ---------------------------------------------------------------------------
  // Composite / Persona Roles (Tree Bind over Domain Roles)
  // ---------------------------------------------------------------------------
  none: {},

  readonly: {
    children: [
      "session.read",
      "workspace.read",
      "agent.read",
      "memory.read",
      "schedule.read",
      "skill.read",
      "plugin.read",
      "workbench.read",
      "model.read",
      "trace.read",
      "benchmark.read",
      "org.read",
      "browser.read",
      "machine.read",
      "messaging.read",
      "project.read",
      "command.read",
      "system.read",
    ],
  },

  general: {
    children: [
      "readonly",
      "session.maintain",
      "workspace.maintain",
      "agent.maintain@self",
      "memory.maintain@self",
      "schedule.maintain@self",
      "workbench.maintain@self",
      "org.maintain",
      "browser.maintain",
      "command.maintain",
    ],
  },

  "system-maintainer": {
    children: [
      "general",
      "session.all",
      "workspace.all",
      "agent.all",
      "memory.all",
      "schedule.all",
      "skill.all",
      "plugin.all",
      "workbench.all",
      "model.maintain",
      "vault.read",
      "trace.all",
      "benchmark.all",
      "machine.maintain",
      "messaging.maintain",
    ],
    flags: {
      agentApi: true,
      crossAgent: true,
    },
  },

  admin: {
    children: [
      "system-maintainer",
      "model.all",
      "vault.all",
      "org.all",
      "browser.all",
      "machine.all",
      "messaging.all",
      "project.all",
      "command.all",
      "system.all",
      "admin.all",
    ],
    flags: {
      allEndpoints: true,
      crossAgent: true,
    },
  },

  "full-permissions": {
    children: ["admin"],
    flags: {
      allEndpoints: true,
      agentApi: true,
      crossAgent: true,
    },
  },
};

interface MutableRoleNode {
  children: string[];
  routes: string[];
  flags: RoleFlags;
}

/**
 * Checks whether a route grant pattern (exact ID, `"*"`, `"<prefix>.*"`, or segment glob like
 * `"agents.messaging.*.get"`) matches a target `routeId`.
 */
export function routePatternMatches(
  pattern: string,
  routeId: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  const normPattern = registry.normalizeRouteId(pattern);
  const normRoute = registry.normalizeRouteId(routeId);
  if (normPattern === normRoute || normPattern === "*") return true;
  if (!normPattern.includes("*")) return false;
  if (normPattern.endsWith(".*") && !normPattern.slice(0, -2).includes("*")) {
    const prefix = normPattern.slice(0, -1);
    return normRoute.startsWith(prefix) && normRoute.length > prefix.length;
  }
  const parts = normPattern.split("*");
  const regexSource =
    "^" +
    parts.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+") +
    "$";
  return new RegExp(regexSource).test(normRoute);
}

/**
 * Checks whether `grantedApiIds` (from an `AgentAuthGrant`) authorizes `routeId` (or its
 * enclosing `groupId`), supporting both exact route IDs and wildcard patterns (`<prefix>.*`).
 */
export function matchesRouteGrant(
  grantedApiIds: readonly string[],
  routeId: string,
  groupId?: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  const normalized = registry.normalizeRouteId(routeId);
  const normalizedGroup = groupId !== undefined ? registry.normalizeRouteId(groupId) : undefined;
  for (const granted of grantedApiIds) {
    if (
      granted === normalized ||
      granted === routeId ||
      routePatternMatches(granted, normalized, registry)
    ) {
      return true;
    }
    if (
      normalizedGroup !== undefined &&
      (granted === normalizedGroup ||
        granted === groupId ||
        routePatternMatches(granted, normalizedGroup, registry))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the list of `@<refinerId>` IDs required for `routeId` (or `groupId`) under an
 * `AgentAuthGrant`. Unconditional exact grants take precedence over refined wildcard grants.
 */
export function resolveRouteRefiners(
  routeRefiners: Readonly<Record<string, readonly string[]>> | undefined,
  grantedApiIds: readonly string[],
  routeId: string,
  groupId?: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): readonly string[] | undefined {
  if (routeRefiners === undefined) return undefined;
  const normalized = registry.normalizeRouteId(routeId);
  const normalizedGroup = groupId !== undefined ? registry.normalizeRouteId(groupId) : undefined;

  const direct =
    (Object.hasOwn(routeRefiners, normalized) ? routeRefiners[normalized] : undefined) ??
    (Object.hasOwn(routeRefiners, routeId) ? routeRefiners[routeId] : undefined) ??
    (normalizedGroup !== undefined && Object.hasOwn(routeRefiners, normalizedGroup)
      ? routeRefiners[normalizedGroup]
      : undefined);
  if (direct !== undefined) return direct;

  if (
    grantedApiIds.includes(normalized) ||
    grantedApiIds.includes(routeId) ||
    (normalizedGroup !== undefined &&
      (grantedApiIds.includes(normalizedGroup) ||
        (groupId !== undefined && grantedApiIds.includes(groupId))))
  ) {
    return undefined;
  }

  const matched = new Set<string>();
  for (const [pattern, refiners] of Object.entries(routeRefiners)) {
    if (!pattern.includes("*")) continue;
    if (
      routePatternMatches(pattern, normalized, registry) ||
      (normalizedGroup !== undefined && routePatternMatches(pattern, normalizedGroup, registry))
    ) {
      for (const r of refiners) matched.add(r);
    }
  }
  return matched.size > 0 ? [...matched] : undefined;
}

/**
 * Dynamic, extensible registry of Agent authorization roles, route-group sub-endpoint mappings,
 * and route-to-role bindings.
 *
 * Each `RoleRegistry` starts pre-seeded with the 20 built-in domain triples, 6 composite roles,
 * and built-in HTTP route catalog, and can be extended by module/plugin slot contributions
 * (`"HttpModule.roles"`, `"HttpModule.routes"`, `"AgentAuthPermissionProvider.roles"`) or
 * programmatic calls (`registerRole`, `registerRoles`, `registerRoute`, `registerGroupEndpoints`).
 */
export class RoleRegistry {
  private readonly tree: Record<string, MutableRoleNode> = {};
  private readonly roleList: string[] = [];
  private readonly groupEndpoints: Record<string, Record<string, string>> = {};
  private readonly allRoutesList: string[] = [];
  private readonly allRoutesSet = new Set<string>();
  private readonly prefixAliases: Record<string, string> = {};

  constructor() {
    for (const [from, to] of Object.entries(BUILTIN_ROUTE_PREFIX_ALIASES)) {
      this.prefixAliases[from] = to;
    }
    for (const routeId of BUILTIN_DIRECT_HTTP_ROUTE_IDS) {
      this.recordKnownRouteId(routeId);
    }
    for (const [groupId, map] of Object.entries(BUILTIN_HTTP_GROUP_ENDPOINT_IDS)) {
      const cloned: Record<string, string> = {};
      for (const [methodPath, routeId] of Object.entries(map)) {
        cloned[methodPath] = routeId;
        this.recordKnownRouteId(routeId);
      }
      this.groupEndpoints[groupId] = cloned;
    }
    for (const roleId of BUILTIN_AGENT_AUTH_ROLES) {
      const seed = BUILTIN_ROLE_TREE[roleId];
      this.tree[roleId] = {
        children: seed.children !== undefined ? [...seed.children] : [],
        routes: seed.routes !== undefined ? [...seed.routes] : [],
        flags: seed.flags !== undefined ? { ...seed.flags } : {},
      };
      this.roleList.push(roleId);
    }
  }

  /** Live view of the role tree in this registry. */
  get roleTree(): Readonly<Record<string, RoleNode>> {
    return this.tree;
  }

  /** Live list of all role IDs registered in this registry. */
  get roles(): readonly string[] {
    return this.roleList;
  }

  /** Live mapping of multi-endpoint group IDs to `"METHOD /subpath"` -> fine-grained route ID. */
  get groupEndpointIds(): Readonly<Record<string, Readonly<Record<string, string>>>> {
    return this.groupEndpoints;
  }

  /** Live list of all concrete HTTP route IDs registered in this registry. */
  get allHttpRouteIds(): readonly string[] {
    return this.allRoutesList;
  }

  private recordKnownRouteId(routeId: string): void {
    if (routeId === "" || routeId.includes("*") || this.allRoutesSet.has(routeId)) return;
    this.allRoutesSet.add(routeId);
    this.allRoutesList.push(routeId);
  }

  private ensureRoleNode(roleId: string): MutableRoleNode {
    let node = this.tree[roleId];
    if (node === undefined) {
      node = { children: [], routes: [], flags: {} };
      this.tree[roleId] = node;
      this.roleList.push(roleId);
    }
    return node;
  }

  /** Whether `value` is a registered role node in this registry. */
  isRole(value: string): boolean {
    return Object.hasOwn(this.tree, value);
  }

  /** Registers a legacy or shorthand route prefix alias (e.g. `"agents.slack"` -> `"agents.messaging.slack"`). */
  registerRouteAlias(fromPrefix: string, toPrefix: string): void {
    const from = fromPrefix.trim().replace(/^penguin\./, "");
    const to = toPrefix.trim().replace(/^penguin\./, "");
    if (from !== "" && to !== "") {
      this.prefixAliases[from] = to;
    }
  }

  /**
   * Normalizes a route ID by stripping the optional `"penguin."` namespace prefix and mapping
   * registered prefix aliases (such as `"agents.<channel>.*"` -> `"agents.messaging.<channel>.*"`).
   */
  normalizeRouteId(routeId: string): string {
    const trimmed = routeId.trim();
    const stripped = trimmed.startsWith("penguin.") ? trimmed.slice("penguin.".length) : trimmed;
    for (const [aliasFrom, canonicalTo] of Object.entries(this.prefixAliases)) {
      if (stripped === aliasFrom) return canonicalTo;
      if (stripped.startsWith(`${aliasFrom}.`)) {
        return `${canonicalTo}${stripped.slice(aliasFrom.length)}`;
      }
    }
    return stripped;
  }

  /**
   * Resolves the fine-grained route ID for a sub-route inside an `HttpModule.routes` contribution.
   * Checks registered `groupEndpointIds`, dynamic `messaging.session-routes` and
   * `agents.messaging.<channel>` patterns, and falls back to the normalized contribution ID.
   */
  resolveHttpRouteId(routeContributionId: string, method: string, subPath: string): string {
    const upperMethod = method.toUpperCase();
    const normSubPath = subPath === "" ? "/" : subPath;
    const key = `${upperMethod} ${normSubPath}`;
    const normGroupId = this.normalizeRouteId(routeContributionId);

    const groupMap = this.groupEndpoints[routeContributionId] ?? this.groupEndpoints[normGroupId];
    const mapped = groupMap?.[key] ?? groupMap?.[`${upperMethod} ${subPath}`];
    if (mapped !== undefined) return mapped;

    if (routeContributionId === "messaging.session-routes" || normGroupId === "messaging.session-routes") {
      const m = /^\/:sessionId\/messaging\/([a-z0-9_-]+)(?:\/([a-z0-9_-]+))?$/i.exec(normSubPath);
      if (m !== null && m[1] !== undefined) {
        const channel = m[1].toLowerCase();
        const tail = m[2]?.toLowerCase();
        if (tail === undefined && upperMethod === "GET") return `agents.messaging.${channel}.get`;
        if (tail === undefined && upperMethod === "PUT") return `agents.messaging.${channel}.update`;
        if (tail === "scan" && upperMethod === "POST") {
          return `agents.messaging.${channel}.scanStart`;
        }
        if (tail === "scan" && upperMethod === "GET") return `agents.messaging.${channel}.scanPoll`;
      }
    }

    const aliasedPrefix = this.prefixAliases[routeContributionId] ?? this.prefixAliases[normGroupId];
    const candidatePrefix = aliasedPrefix ?? normGroupId;
    if (candidatePrefix.startsWith("agents.messaging.")) {
      if (upperMethod === "GET" && normSubPath === "/") return `${candidatePrefix}.get`;
      if (upperMethod === "PUT" && normSubPath === "/") return `${candidatePrefix}.update`;
      if (upperMethod === "POST" && normSubPath === "/scan") return `${candidatePrefix}.scanStart`;
      if (upperMethod === "GET" && normSubPath === "/scan") return `${candidatePrefix}.scanPoll`;
    }

    return normGroupId;
  }

  /**
   * Registers or extends a role node in this registry.
   * - `contribution.role` overrides `roleId` as the target role name (so multiple slot
   *   contributions with distinct `id`s can extend the same role node).
   * - `children`, `routes`, and `flags` are merged additively (set union).
   * - `parents` attaches the target role into each named parent role's `children`
   *   (preserving any `@<refinerId>` suffix on the parent entry, e.g. `"general@self"`).
   */
  registerRole(roleId: string, contribution: RoleContribution): void {
    const rawTarget = (contribution.role ?? roleId).trim();
    const targetRole = parseRefinedGrant(rawTarget).target;
    if (targetRole === "") return;

    const node = this.ensureRoleNode(targetRole);

    if (contribution.children !== undefined) {
      for (const childSpec of contribution.children) {
        const trimmed = childSpec.trim();
        if (trimmed !== "" && !node.children.includes(trimmed)) {
          node.children.push(trimmed);
        }
      }
    }

    if (contribution.routes !== undefined) {
      for (const routeSpec of contribution.routes) {
        const trimmed = routeSpec.trim();
        if (trimmed === "") continue;
        const parsed = parseRefinedGrant(trimmed);
        if (parsed.target === "") continue;
        const normTarget = this.normalizeRouteId(parsed.target);
        const normalizedSpec =
          parsed.refinerId !== null ? `${normTarget}@${parsed.refinerId}` : normTarget;
        if (!node.routes.includes(normalizedSpec)) {
          node.routes.push(normalizedSpec);
        }
        this.recordKnownRouteId(normTarget);
      }
    }

    if (contribution.flags !== undefined) {
      if (contribution.flags.allEndpoints) node.flags.allEndpoints = true;
      if (contribution.flags.agentApi) node.flags.agentApi = true;
      if (contribution.flags.crossAgent) node.flags.crossAgent = true;
    }

    if (contribution.parents !== undefined) {
      for (const parentSpec of contribution.parents) {
        const parsedParent = parseRefinedGrant(parentSpec);
        if (parsedParent.target === "") continue;
        const parentNode = this.ensureRoleNode(parsedParent.target);
        const childRef =
          parsedParent.refinerId !== null ? `${targetRole}@${parsedParent.refinerId}` : targetRole;
        if (!parentNode.children.includes(childRef)) {
          parentNode.children.push(childRef);
        }
      }
    }
  }

  /**
   * Registers a batch of role contributions from either a `{ [roleId]: RoleContribution }` record
   * or an array of `"HttpModule.roles"` / `"AgentAuthPermissionProvider.roles"` slot entries.
   */
  registerRoles(
    input:
      | Readonly<Record<string, RoleContribution>>
      | ReadonlyArray<
          { readonly id: string; readonly data?: RoleContribution } & RoleContribution
        >,
  ): void {
    if (Array.isArray(input)) {
      for (const item of input) {
        const contrib: RoleContribution = item.data !== undefined ? item.data : item;
        this.registerRole(item.id, contrib);
      }
      return;
    }
    const record = input as Readonly<Record<string, RoleContribution>>;
    for (const [roleId, contrib] of Object.entries(record)) {
      this.registerRole(roleId, contrib);
    }
  }

  /**
   * Registers or merges `"METHOD /subpath"` -> fine-grained route ID mappings for a multi-endpoint
   * `HttpModule.routes` group contribution.
   */
  registerGroupEndpoints(groupId: string, endpoints: Readonly<Record<string, string>>): void {
    const rawGroup = groupId.trim();
    if (rawGroup === "") return;
    const normGroup = this.normalizeRouteId(rawGroup);
    const existing = this.groupEndpoints[normGroup] ?? this.groupEndpoints[rawGroup] ?? {};
    const merged: Record<string, string> = { ...existing };

    for (const [rawMethodPath, rawEndpointId] of Object.entries(endpoints)) {
      const trimmedKey = rawMethodPath.trim();
      const spaceIdx = trimmedKey.indexOf(" ");
      const normalizedKey =
        spaceIdx > 0
          ? `${trimmedKey.slice(0, spaceIdx).toUpperCase()} ${trimmedKey.slice(spaceIdx + 1).trim() || "/"}`
          : trimmedKey;
      const normEndpointId = this.normalizeRouteId(rawEndpointId);
      if (normalizedKey !== "" && normEndpointId !== "") {
        merged[normalizedKey] = normEndpointId;
        this.recordKnownRouteId(normEndpointId);
      }
    }

    this.groupEndpoints[normGroup] = merged;
    if (rawGroup !== normGroup) {
      this.groupEndpoints[rawGroup] = merged;
    }
  }

  /**
   * Registers a route contribution's sub-endpoint mappings (`endpoints`) and direct role bindings
   * (`roles`, supporting `<roleId>@<refinerId>` such as `"general@self"` or `"readonly"`).
   */
  registerRoute(registration: RouteRoleRegistration): void {
    const rawId = registration.id.trim();
    if (rawId === "") return;
    const normId = this.normalizeRouteId(rawId);

    const leafRouteIds: string[] = [];
    if (registration.endpoints !== undefined && Object.keys(registration.endpoints).length > 0) {
      this.registerGroupEndpoints(rawId, registration.endpoints);
      for (const epId of Object.values(registration.endpoints)) {
        const normEp = this.normalizeRouteId(epId);
        if (normEp !== "" && !leafRouteIds.includes(normEp)) {
          leafRouteIds.push(normEp);
        }
      }
    } else {
      const existingGroup = this.groupEndpoints[normId] ?? this.groupEndpoints[rawId];
      if (existingGroup !== undefined) {
        for (const epId of Object.values(existingGroup)) {
          if (!leafRouteIds.includes(epId)) leafRouteIds.push(epId);
        }
      } else {
        this.recordKnownRouteId(normId);
      }
    }
    if (!leafRouteIds.includes(normId)) {
      leafRouteIds.push(normId);
    }

    if (registration.roles !== undefined) {
      for (const roleSpec of registration.roles) {
        const parsedRole = parseRefinedGrant(roleSpec);
        if (parsedRole.target === "") continue;
        const roleNode = this.ensureRoleNode(parsedRole.target);
        for (const leafId of leafRouteIds) {
          const routeEntry =
            parsedRole.refinerId !== null ? `${leafId}@${parsedRole.refinerId}` : leafId;
          if (!roleNode.routes.includes(routeEntry)) {
            roleNode.routes.push(routeEntry);
          }
        }
      }
    }
  }

  /**
   * Registers a batch of route registrations or `"HttpModule.routes"` slot contribution entries.
   */
  registerRoutes(
    routes: ReadonlyArray<
      RouteRoleRegistration & {
        readonly data?: {
          readonly endpoints?: Readonly<Record<string, string>>;
          readonly roles?: readonly string[];
        };
      }
    >,
  ): void {
    for (const item of routes) {
      const endpoints = item.endpoints ?? item.data?.endpoints;
      const roles = item.roles ?? item.data?.roles;
      this.registerRoute({
        id: item.id,
        ...(endpoints !== undefined ? { endpoints } : {}),
        ...(roles !== undefined ? { roles } : {}),
      });
    }
  }

  /**
   * Expands a primary `role` (which may carry `<role>@<refinerId>`) and optional `extraGrants`
   * (additional role nodes, route IDs, or `<prefix>.*` wildcards, with optional `@<refinerId>`)
   * into the effective route set, capability flags, and per-route refiner map (`routeRefiners`).
   */
  expandRoleGrant(role: string, extraGrants: readonly string[] = []): ExpandedRoleGrant {
    const visited = new Set<string>();
    const allRoutes = new Set<string>();
    const unconditionalRoutes = new Set<string>();
    const refinedRouteMap = new Map<string, Set<string>>();
    let allEndpoints = false;
    let agentApi = false;
    let crossAgent = false;

    const recordSingleRoute = (normalized: string, refinerId: string | null): void => {
      allRoutes.add(normalized);
      if (refinerId === null) {
        unconditionalRoutes.add(normalized);
      } else {
        let set = refinedRouteMap.get(normalized);
        if (set === undefined) {
          set = new Set<string>();
          refinedRouteMap.set(normalized, set);
        }
        set.add(refinerId);
      }
    };

    const recordRoute = (routeId: string, refinerId: string | null): void => {
      const normalized = this.normalizeRouteId(routeId);
      if (normalized === "") return;
      recordSingleRoute(normalized, refinerId);
      if (normalized.includes("*")) {
        for (const knownRoute of this.allRoutesList) {
          if (routePatternMatches(normalized, knownRoute, this)) {
            recordSingleRoute(knownRoute, refinerId);
          }
        }
      }
    };

    const visitRole = (
      r: string,
      inheritedRefiner: string | null,
      isRootRefined: boolean,
    ): void => {
      const isReadTier = r === "readonly" || r.endsWith(".read");
      const effectiveRefiner =
        inheritedRefiner !== null && isReadTier && !isRootRefined ? null : inheritedRefiner;
      const visitKey = `${r}@${effectiveRefiner ?? ""}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const node = this.tree[r];
      if (node === undefined) return;
      if (effectiveRefiner === null) {
        if (node.flags.allEndpoints) allEndpoints = true;
        if (node.flags.agentApi) agentApi = true;
        if (node.flags.crossAgent) crossAgent = true;
      }
      for (const routeSpec of node.routes) {
        const parsed = parseRefinedGrant(routeSpec);
        const routeRefiner = parsed.refinerId ?? effectiveRefiner;
        recordRoute(parsed.target, routeRefiner);
      }
      for (const childSpec of node.children) {
        const parsed = parseRefinedGrant(childSpec);
        if (this.isRole(parsed.target)) {
          const childRefiner = parsed.refinerId ?? effectiveRefiner;
          const childRootRefined = parsed.refinerId !== null;
          visitRole(parsed.target, childRefiner, childRootRefined);
        } else if (parsed.target !== "") {
          recordRoute(parsed.target, parsed.refinerId ?? effectiveRefiner);
        }
      }
    };

    const applyGrantSpec = (spec: string): void => {
      const parsed = parseRefinedGrant(spec);
      if (parsed.target === "") return;
      if (this.isRole(parsed.target)) {
        visitRole(parsed.target, parsed.refinerId, parsed.refinerId !== null);
      } else {
        recordRoute(parsed.target, parsed.refinerId);
      }
    };

    applyGrantSpec(role);
    for (const item of extraGrants) {
      applyGrantSpec(item);
    }

    const routeRefiners: Record<string, string[]> = {};
    if (!allEndpoints) {
      for (const [routeId, refiners] of refinedRouteMap.entries()) {
        if (!unconditionalRoutes.has(routeId) && refiners.size > 0) {
          routeRefiners[routeId] = [...refiners];
        }
      }
    }

    return {
      allEndpoints,
      agentApi,
      crossAgent,
      apiIds: [...allRoutes],
      routeRefiners,
    };
  }

  /** Whether the role reaches every route without its granted set naming it. */
  roleSpansAllEndpoints(role: string): boolean {
    return this.expandRoleGrant(role).allEndpoints;
  }

  /** Whether the role carries the Agent's own API settings and keys (human-gated endpoints). */
  roleHasAgentApi(role: string): boolean {
    return this.expandRoleGrant(role).agentApi;
  }

  /** Whether the role may mutate Agent-scoped resources of other Agents in the same Project. */
  roleCanManageOtherAgents(role: string): boolean {
    return this.expandRoleGrant(role).crossAgent;
  }
}

/**
 * Default process-wide `RoleRegistry` instance backing `ROLE_TREE`, `AGENT_AUTH_ROLES`,
 * `HTTP_GROUP_ENDPOINT_IDS`, `ALL_HTTP_ROUTE_IDS`, and the top-level helper functions.
 */
export const DEFAULT_ROLE_REGISTRY = new RoleRegistry();

/** Declarative Role Tree (`ROLE_TREE`) backed by `DEFAULT_ROLE_REGISTRY`. */
export const ROLE_TREE: Readonly<Record<string, RoleNode>> = DEFAULT_ROLE_REGISTRY.roleTree;

/** All registered role IDs in `DEFAULT_ROLE_REGISTRY`. */
export const AGENT_AUTH_ROLES: readonly string[] = DEFAULT_ROLE_REGISTRY.roles;

/** Group endpoint sub-route map backed by `DEFAULT_ROLE_REGISTRY`. */
export const HTTP_GROUP_ENDPOINT_IDS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = DEFAULT_ROLE_REGISTRY.groupEndpointIds;

/** Complete list of concrete HTTP route IDs registered in `DEFAULT_ROLE_REGISTRY`. */
export const ALL_HTTP_ROUTE_IDS: readonly string[] = DEFAULT_ROLE_REGISTRY.allHttpRouteIds;

/**
 * Normalizes a route ID by stripping the optional `"penguin."` namespace prefix and mapping
 * registered prefix aliases in `DEFAULT_ROLE_REGISTRY`.
 */
export function normalizeRouteId(routeId: string): string {
  return DEFAULT_ROLE_REGISTRY.normalizeRouteId(routeId);
}

/**
 * Resolves the fine-grained route ID for a sub-route inside an `HttpModule.routes` contribution
 * against `DEFAULT_ROLE_REGISTRY`.
 */
export function resolveHttpRouteId(
  routeContributionId: string,
  method: string,
  subPath: string,
): string {
  return DEFAULT_ROLE_REGISTRY.resolveHttpRouteId(routeContributionId, method, subPath);
}

/** Whether `value` is a registered role node in `DEFAULT_ROLE_REGISTRY` (or `registry` when provided). */
export function isAgentAuthRole(
  value: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): value is AgentAuthRole {
  return registry.isRole(value);
}

/**
 * Expands a primary `role` (which may carry `<role>@<refinerId>`) and optional `extraGrants`
 * against `DEFAULT_ROLE_REGISTRY` (or `registry` when provided).
 */
export function expandRoleGrant(
  role: string,
  extraGrants: readonly string[] = [],
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): ExpandedRoleGrant {
  return registry.expandRoleGrant(role, extraGrants);
}

/** The built-in roles whose sessions may reach EVERY route the server registers. */
export const ALL_ENDPOINT_ROLES: readonly AgentAuthRole[] = ["admin", "full-permissions"];

/** Whether the role reaches every route without its granted set naming it. */
export function roleSpansAllEndpoints(
  role: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  return registry.roleSpansAllEndpoints(role);
}

/** Whether the role carries the Agent's own API settings and keys (human-gated endpoints). */
export function roleHasAgentApi(
  role: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  return registry.roleHasAgentApi(role);
}

/** Whether the role may mutate Agent-scoped resources of other Agents in the same Project. */
export function roleCanManageOtherAgents(
  role: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  return registry.roleCanManageOtherAgents(role);
}
