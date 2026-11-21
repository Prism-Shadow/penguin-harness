/**
 * Agent auth role presets and HTTP route ID bindings.
 *
 * Every `auth: "user"` HTTP endpoint on the server has a fine-grained route ID
 * (`<domain>.<action>` or `<domain>.<subresource>.<action>`). Roles form a directed
 * acyclic tree bind (`ROLE_TREE`):
 * - Domain roles follow a 3-tier ladder (`<domain>.read` -> `<domain>.maintain` -> `<domain>.all`),
 *   where each tier binds its lower tier as a child role and adds only the routes introduced at
 *   that tier.
 * - Composite persona roles (`none`, `readonly`, `general`, `system-maintainer`, `admin`,
 *   `full-permissions`) bind domain role nodes in the same tree.
 * - Extra grants (`apiIds` on a generation row) may name either a role node in `ROLE_TREE`
 *   (expanding its entire subtree) or a single leaf HTTP route ID.
 */

/** Single-method `"HttpModule.routes"` entry IDs (`command.ts`, `history.ts`, `history-lines.ts`, `sessions.ts`). */
export const DIRECT_HTTP_ROUTE_IDS = [
  "command.list",
  "command.run",
  "session.getHistory",
  "session.getHistoryLines",
  "session.getTraceBody",
  "session.list",
  "session.create",
  "session.listBatch",
  "session.archiveWorkspace",
  "workspace.listFiles",
  "workspace.readFile",
  "workspace.writeFile",
  "workspace.deleteFile",
  "workspace.createFile",
  "workspace.moveFile",
  "workspace.searchFiles",
  "workspace.revealFile",
  "session.get",
  "session.update",
  "session.fork",
  "session.delete",
  "session.getScratchpadFile",
  "session.getTraceImage",
  "session.getMessages",
  "session.getAmsp",
  "session.listApprovals",
  "session.stream",
  "session.runTask",
  "session.steer",
  "session.deleteSteer",
  "session.messageSubagent",
  "session.abortSubagent",
  "session.deleteFollowUp",
  "session.interrupt",
  "session.getGoal",
  "session.resolveApproval",
  "session.backgroundToolCall",
  "session.abort",
  "session.listProcesses",
  "session.killProcess",
  "session.deleteProcess",
  "session.retryNow",
  "session.retry",
  "session.compact",
  "session.switchModel",
  "session.listFiles",
  "session.readFile",
  "session.writeFile",
  "session.deleteFile",
  "session.createFile",
  "session.moveFile",
  "session.searchFiles",
  "session.revealFile",
  "session.previewFileRedirect",
  "session.statFiles",
  "session.getContext",
  "session.listTraces",
  "session.getTrace",
  "session.getTraceAnalysis",
  "session.listArchivedGroups",
  "session.listArchived",
  "session.unarchive",
  "session.deleteArchived",
] as const;

/**
 * Fine-grained route IDs for multi-route `"HttpModule.routes"` groups, keyed by
 * `"<groupId> <METHOD> <subPath>"`.
 */
export const HTTP_GROUP_ENDPOINT_IDS = {
  // Agent lifecycle & config
  "sessions.agents GET /": "agent.list",
  "sessions.agents POST /": "agent.create",
  "sessions.agents DELETE /:agentId": "agent.delete",
  "sessions.agents GET /:agentId/auth": "agent.auth.get",
  "sessions.agents PUT /:agentId/auth": "agent.auth.update",
  "sessions.agent-deletions GET /:deletionId": "agent.getDeletion",
  "sessions.agent-config GET /": "agent.config.get",
  "sessions.agent-config PUT /": "agent.config.update",
  "sessions.agent-config POST /mcp-test": "agent.config.mcpTest",
  "sessions.agent-config POST /kernel-update": "agent.config.kernelUpdate",
  "sessions.agent-config POST /reset": "agent.config.reset",
  "agents.avatar GET /": "agent.avatar.get",
  "agents.avatar PUT /": "agent.avatar.update",
  "agents.archive GET /:agentId/archive": "agent.archive.export",
  "agents.archive POST /import": "agent.archive.import",
  "agents.api GET /": "agent.api.get",
  "agents.api PUT /": "agent.api.update",
  "agents.api POST /keys": "agent.api.createKey",
  "agents.api DELETE /keys/:keyId": "agent.api.deleteKey",
  "amsp.try POST /": "agent.api.try",

  // Memory
  "agents.memory GET /": "memory.get",
  "agents.memory POST /template-placeholder": "memory.templatePlaceholder",
  "agents.memory GET /scopes/:scopeKey/files": "memory.listFiles",
  "agents.memory GET /scopes/:scopeKey/files/:filePath{.+}": "memory.readFile",
  "agents.memory GET /scopes/:scopeKey/export": "memory.export",
  "agents.memory POST /scopes/:scopeKey/import": "memory.import",
  "agents.memory DELETE /scopes/:scopeKey/files/:filePath{.+}": "memory.deleteFile",

  // Schedules
  "schedules GET /": "schedule.list",
  "schedules POST /": "schedule.create",
  "schedules POST /template-placeholder": "schedule.templatePlaceholder",
  "schedules GET /:name": "schedule.get",
  "schedules PUT /:name": "schedule.update",
  "schedules DELETE /:name": "schedule.delete",
  "schedules.project-routes GET /": "schedule.listProject",

  // Skills
  "agents.skills GET /": "skill.list",
  "agents.skills POST /template-placeholder": "skill.templatePlaceholder",
  "agents.skills POST /archive": "skill.importArchive",
  "agents.skills GET /:name/archive": "skill.exportArchive",
  "agents.skills GET /:name/icon": "skill.getIcon",
  "agents.skills DELETE /:name": "skill.delete",
  "projects.dir-skills GET /": "skill.listDir",
  "projects.dir-skills GET /icon": "skill.getDirIcon",

  // Plugins, hooks & MCP servers
  "plugins.library GET /": "plugin.library.list",
  "plugins.library GET /:plugin/files": "plugin.library.listFiles",
  "plugins.library GET /:plugin/readme": "plugin.library.getReadme",
  "plugins.library GET /:plugin/archive": "plugin.library.getArchive",
  "plugins.library GET /:plugin/icon": "plugin.library.getIcon",
  "plugin-registry GET /": "plugin.registry.list",
  "plugin-registry GET /icon": "plugin.registry.getIcon",
  "plugin-registry GET /readme": "plugin.registry.getReadme",
  "plugin-registry GET /archive": "plugin.registry.getArchive",
  "installed-plugins GET /": "plugin.installed.list",
  "installed-plugins POST /": "plugin.installed.install",
  "installed-plugins POST /link": "plugin.installed.link",
  "installed-plugins POST /archive": "plugin.installed.importArchive",
  "installed-plugins PUT /": "plugin.installed.setEnabled",
  "installed-plugins DELETE /": "plugin.installed.uninstall",
  "plugins.agent-plugins GET /": "plugin.agent.list",
  "plugins.agent-plugins POST /": "plugin.agent.install",
  "plugins.agent-plugins DELETE /:name": "plugin.agent.uninstall",
  "plugins.agent-hooks GET /": "plugin.hook.list",
  "plugins.agent-hooks POST /archive": "plugin.hook.importArchive",
  "plugins.agent-hooks GET /:name/archive": "plugin.hook.exportArchive",
  "plugins.agent-hooks GET /:name/icon": "plugin.hook.getIcon",
  "plugins.agent-hooks DELETE /:name": "plugin.hook.delete",
  "plugins.agent-mcp-servers GET /": "plugin.mcp.list",
  "plugins.agent-mcp-servers DELETE /:name": "plugin.mcp.delete",

  // Workbenches & App Center
  "workbenches GET /": "workbench.list",
  "workbenches PUT /enabled": "workbench.setAllEnabled",
  "workbenches PUT /:id/enabled": "workbench.setEnabled",
  "workbenches POST /archive": "workbench.importArchive",
  "workbenches GET /:id/archive": "workbench.exportArchive",
  "workbenches POST /:id/reload": "workbench.reload",
  "workbenches GET /:id/history": "workbench.getHistory",
  "workbenches POST /:id/rollback": "workbench.rollback",
  "workbenches PATCH /:id/sidebar": "workbench.updateSidebar",
  "workbenches PATCH /:id/app-center": "workbench.updateAppCenter",
  "workbenches GET /:id/app-center/icon": "workbench.getAppCenterIcon",
  "workbenches DELETE /:id": "workbench.delete",
  "workbenches GET /:id/ui/*": "workbench.serveUi",
  "workbenches GET /:id/sdk/ui/*": "workbench.serveSdkUi",
  "workbenches GET /:id/sdk/:file": "workbench.serveSdkFile",
  "workbenches ALL /:id/api/*": "workbench.callApi",
  "workbenches.app-center GET /": "workbench.appCenter.list",
  "workbenches.app-center PUT /layout": "workbench.appCenter.updateLayout",

  // Models, OAuth, Platform Auth & Chat Defaults
  "sessions.models GET /": "model.list",
  "sessions.models PUT /": "model.update",
  "sessions.models PUT /providers/:provider": "model.updateProvider",
  "sessions.models POST /sync-presets": "model.syncPresets",
  "sessions.models GET /balance": "model.getBalance",
  "sessions.models PUT /default": "model.setDefault",
  "sessions.models POST /test": "model.test",
  "sessions.models POST /detect": "model.detect",
  "sessions.models POST /list": "model.listRemote",
  "sessions.models POST /detect-vision": "model.detectVision",
  "sessions.model-oauth GET /": "model.oauth.list",
  "sessions.model-oauth POST /start": "model.oauth.start",
  "sessions.model-oauth POST /:flowId/code": "model.oauth.submitCode",
  "sessions.model-oauth GET /:flowId": "model.oauth.getStatus",
  "sessions.platform-auth POST /start": "model.platformAuth.start",
  "sessions.platform-auth POST /sync": "model.platformAuth.sync",
  "sessions.platform-auth GET /:flowId/status": "model.platformAuth.getStatus",
  "sessions.platform-auth POST /:flowId/retry": "model.platformAuth.retry",
  "sessions.platform-auth POST /:flowId/cancel": "model.platformAuth.cancel",
  "sessions.modelscope-auth POST /start": "model.modelscopeAuth.start",
  "sessions.modelscope-auth GET /:flowId/status": "model.modelscopeAuth.getStatus",
  "sessions.modelscope-auth POST /:flowId/retry": "model.modelscopeAuth.retry",
  "sessions.modelscope-auth POST /:flowId/cancel": "model.modelscopeAuth.cancel",
  "sessions.chat-defaults GET /": "model.chatDefaults.get",
  "sessions.chat-defaults PUT /": "model.chatDefaults.update",

  // Vault
  "sessions.vault GET /": "vault.get",
  "sessions.vault PUT /": "vault.update",
  "sessions.vault PUT /entries/:key": "vault.setEntry",
  "sessions.vault DELETE /entries/:key": "vault.deleteEntry",
  "sessions.vault POST /template-placeholder": "vault.templatePlaceholder",

  // Traces & Usage
  "agents.traces GET /": "trace.list",
  "agents.traces GET /:sessionId/:index": "trace.get",
  "agents.traces GET /:sessionId/:index/analysis": "trace.getAnalysis",
  "agents.traces GET /:sessionId/:index/download": "trace.download",
  "agents.traces POST /import": "trace.import",
  "sessions.usage GET /": "usage.get",
  "sessions.usage GET /model-totals": "usage.getModelTotals",
  "sessions.usage GET /errors": "usage.listErrors",
  "sessions.usage DELETE /errors": "usage.clearErrors",

  // Benchmarks
  "agents.benchmarks GET /": "benchmark.list",
  "agents.benchmarks POST /": "benchmark.create",
  "agents.benchmarks DELETE /:benchmarkId": "benchmark.delete",
  "agents.benchmarks POST /archive": "benchmark.importArchive",
  "agents.benchmarks GET /:benchmarkId/archive": "benchmark.exportArchive",
  "agents.benchmarks GET /:benchmarkId/cases": "benchmark.listCases",
  "agents.benchmarks GET /:benchmarkId/cases/:caseId/files": "benchmark.listCaseFiles",
  "agents.benchmarks GET /:benchmarkId/cases/:caseId/files/content": "benchmark.readCaseFile",
  "agents.benchmarks GET /:benchmarkId/cases/:caseId/rubric/files": "benchmark.listRubricFiles",
  "agents.benchmarks GET /:benchmarkId/cases/:caseId/rubric/files/content":
    "benchmark.readRubricFile",

  // Organizations
  "org GET /": "org.list",
  "org POST /": "org.create",
  "org GET /:orgId": "org.get",
  "org PATCH /:orgId": "org.update",
  "org DELETE /:orgId": "org.delete",
  "org GET /:orgId/chart": "org.getChart",
  "org POST /:orgId/employees": "org.employee.hire",
  "org PATCH /:orgId/employees/:agentId": "org.employee.update",
  "org GET /:orgId/employees/:agentId/avatar": "org.employee.getAvatar",
  "org PUT /:orgId/employees/:agentId/avatar": "org.employee.updateAvatar",
  "org DELETE /:orgId/employees/:agentId": "org.employee.remove",
  "org GET /:orgId/employees/:agentId/desk": "org.employee.getDesk",
  "org POST /:orgId/employees/:agentId/desk": "org.employee.startDesk",
  "org GET /:orgId/handbook": "org.handbook.get",
  "org PUT /:orgId/handbook": "org.handbook.update",
  "org GET /:orgId/handbook/files": "org.handbook.listFiles",
  "org GET /:orgId/handbook/files/:path{.+}": "org.handbook.readFile",
  "org PUT /:orgId/handbook/files/:path{.+}": "org.handbook.writeFile",
  "org DELETE /:orgId/handbook/files/:path{.+}": "org.handbook.deleteFile",
  "org GET /:orgId/calendar": "org.calendar.list",
  "org POST /:orgId/calendar": "org.calendar.create",
  "org GET /:orgId/calendar/:agentId/:name": "org.calendar.get",
  "org PUT /:orgId/calendar/:agentId/:name": "org.calendar.update",
  "org DELETE /:orgId/calendar/:agentId/:name": "org.calendar.delete",
  "org GET /:orgId/tickets": "org.ticket.list",
  "org POST /:orgId/tickets": "org.ticket.create",
  "org GET /:orgId/tickets/:ticketId": "org.ticket.get",
  "org PUT /:orgId/tickets/:ticketId": "org.ticket.update",
  "org POST /:orgId/tickets/:ticketId/move": "org.ticket.move",
  "org POST /:orgId/tickets/:ticketId/block": "org.ticket.block",
  "org POST /:orgId/tickets/:ticketId/unblock": "org.ticket.unblock",
  "org POST /:orgId/tickets/:ticketId/progress": "org.ticket.progress",
  "org POST /:orgId/tickets/:ticketId/start": "org.ticket.start",
  "org POST /:orgId/tickets/:ticketId/attach": "org.ticket.attach",
  "org GET /:orgId/channels": "org.channel.list",
  "org POST /:orgId/channels": "org.channel.create",
  "org GET /:orgId/channels/:channelId": "org.channel.get",
  "org PATCH /:orgId/channels/:channelId": "org.channel.update",
  "org POST /:orgId/channels/:channelId/members": "org.channel.addMember",
  "org DELETE /:orgId/channels/:channelId/members/:principal": "org.channel.removeMember",
  "org GET /:orgId/channels/:channelId/messages": "org.channel.listMessages",
  "org POST /:orgId/channels/:channelId/messages": "org.channel.postMessage",
  "org POST /:orgId/channels/:channelId/read": "org.channel.markRead",
  "org GET /:orgId/finance": "org.finance.get",
  "org GET /:orgId/sessions": "org.session.list",

  // Built-in Browser
  "builtin-browser.routes GET /status": "browser.getStatus",
  "builtin-browser.routes GET /backend": "browser.getBackend",
  "builtin-browser.routes PUT /backend": "browser.setBackend",
  "builtin-browser.routes POST /extension/pairings": "browser.createExtensionPairing",
  "builtin-browser.routes GET /extension": "browser.listExtensions",
  "builtin-browser.routes DELETE /extension/:id": "browser.revokeExtension",
  "builtin-browser.routes GET /tabs": "browser.listTabs",
  "builtin-browser.routes POST /tabs": "browser.openTab",
  "builtin-browser.routes POST /tabs/session": "browser.openSessionTab",
  "builtin-browser.routes POST /tabs/claim": "browser.claimTabs",
  "builtin-browser.routes POST /tabs/on-screen": "browser.setOnScreen",
  "builtin-browser.routes POST /tabs/:tab/activate": "browser.activateTab",
  "builtin-browser.routes DELETE /tabs/:tab": "browser.closeTab",
  "builtin-browser.routes POST /tabs/:tab/navigate": "browser.navigate",
  "builtin-browser.routes POST /tabs/:tab/scan": "browser.scan",
  "builtin-browser.routes POST /tabs/:tab/exec": "browser.exec",
  "builtin-browser.routes POST /tabs/:tab/click": "browser.click",
  "builtin-browser.routes POST /tabs/:tab/type": "browser.type",
  "builtin-browser.routes POST /tabs/:tab/screenshot": "browser.screenshot",
  "builtin-browser.routes POST /tabs/:tab/cdp": "browser.cdp",
  "builtin-browser.routes GET /import/sources": "browser.listImportSources",
  "builtin-browser.routes POST /import": "browser.importData",
  "builtin-browser.routes GET /settings": "browser.getSettings",
  "builtin-browser.routes PUT /settings": "browser.updateSettings",
  "builtin-browser.routes GET /history": "browser.getHistory",
  "builtin-browser.routes DELETE /history": "browser.clearHistory",
  "builtin-browser.routes POST /clear-data": "browser.clearData",

  // Machines
  "machines GET /": "machine.list",
  "machines GET /events": "machine.events",
  "machines POST /use": "machine.use",
  "machines POST /stop-using": "machine.stopUsing",
  "machines GET /ssh-hosts": "machine.listSshHosts",
  "machines POST /ssh-hosts": "machine.createSshHost",
  "machines GET /ssh-hosts/:alias": "machine.getSshHost",
  "machines PUT /ssh-hosts/:alias": "machine.updateSshHost",
  "machines POST /add": "machine.add",
  "machines POST /probe": "machine.probe",
  "machines POST /:machineId/install": "machine.install",
  "machines POST /:machineId/connect": "machine.connect",
  "machines POST /:machineId/reconnect": "machine.reconnect",
  "machines POST /:machineId/stop-reconnecting": "machine.stopReconnecting",
  "machines GET /:machineId/dirs": "machine.listDirs",
  "machines POST /:machineId/release": "machine.release",
  "machines POST /:machineId/restart": "machine.restart",
  "machines POST /:machineId/stop": "machine.stop",
  "machines POST /:machineId/uninstall": "machine.uninstall",
  "machines POST /:machineId/sync": "machine.sync",
  "machines POST /:machineId/diagnose": "machine.diagnose",
  "machines POST /:machineId/disconnect": "machine.disconnect",
  "machines.server-proxy ALL /*": "machine.proxy",

  // Messaging (`agents.messaging.<channel>.*` & account listings)
  "messaging.accounts GET /accounts": "messaging.listAccounts",
  "messaging.account-holders GET /account-holders": "messaging.listAccountHolders",
  "messaging.session-routes GET /:sessionId/messaging": "messaging.session.list",
  "messaging.session-routes GET /:sessionId/messaging/feishu": "agents.messaging.feishu.get",
  "messaging.session-routes PUT /:sessionId/messaging/feishu": "agents.messaging.feishu.update",
  "messaging.session-routes POST /:sessionId/messaging/feishu/state":
    "agents.messaging.feishu.setState",
  "messaging.session-routes DELETE /:sessionId/messaging/feishu": "agents.messaging.feishu.delete",
  "messaging.session-routes POST /:sessionId/messaging/feishu/test": "agents.messaging.feishu.test",
  "messaging.session-routes POST /:sessionId/messaging/feishu/test-message":
    "agents.messaging.feishu.testMessage",
  "messaging.session-routes GET /:sessionId/messaging/telegram": "agents.messaging.telegram.get",
  "messaging.session-routes PUT /:sessionId/messaging/telegram": "agents.messaging.telegram.update",
  "messaging.session-routes POST /:sessionId/messaging/telegram/state":
    "agents.messaging.telegram.setState",
  "messaging.session-routes DELETE /:sessionId/messaging/telegram":
    "agents.messaging.telegram.delete",
  "messaging.session-routes POST /:sessionId/messaging/telegram/test":
    "agents.messaging.telegram.test",
  "messaging.session-routes POST /:sessionId/messaging/telegram/test-message":
    "agents.messaging.telegram.testMessage",
  "messaging.session-routes GET /:sessionId/messaging/qq": "agents.messaging.qq.get",
  "messaging.session-routes PUT /:sessionId/messaging/qq": "agents.messaging.qq.update",
  "messaging.session-routes POST /:sessionId/messaging/qq/state": "agents.messaging.qq.setState",
  "messaging.session-routes DELETE /:sessionId/messaging/qq": "agents.messaging.qq.delete",
  "messaging.session-routes POST /:sessionId/messaging/qq/scan": "agents.messaging.qq.scanStart",
  "messaging.session-routes POST /:sessionId/messaging/qq/scan/poll":
    "agents.messaging.qq.scanPoll",
  "messaging.session-routes POST /:sessionId/messaging/qq/scan/cancel":
    "agents.messaging.qq.scanCancel",
  "messaging.session-routes POST /:sessionId/messaging/qq/test": "agents.messaging.qq.test",
  "messaging.session-routes POST /:sessionId/messaging/qq/test-message":
    "agents.messaging.qq.testMessage",
  "messaging.session-routes GET /:sessionId/messaging/wechat": "agents.messaging.wechat.get",
  "messaging.session-routes PUT /:sessionId/messaging/wechat": "agents.messaging.wechat.update",
  "messaging.session-routes POST /:sessionId/messaging/wechat/state":
    "agents.messaging.wechat.setState",
  "messaging.session-routes DELETE /:sessionId/messaging/wechat": "agents.messaging.wechat.delete",
  "messaging.session-routes POST /:sessionId/messaging/wechat/scan":
    "agents.messaging.wechat.scanStart",
  "messaging.session-routes POST /:sessionId/messaging/wechat/scan/poll":
    "agents.messaging.wechat.scanPoll",
  "messaging.session-routes POST /:sessionId/messaging/wechat/scan/verify":
    "agents.messaging.wechat.scanVerify",
  "messaging.session-routes POST /:sessionId/messaging/wechat/scan/cancel":
    "agents.messaging.wechat.scanCancel",
  "messaging.session-routes POST /:sessionId/messaging/wechat/test": "agents.messaging.wechat.test",
  "messaging.session-routes POST /:sessionId/messaging/wechat/test-message":
    "agents.messaging.wechat.testMessage",
  "agents.messaging.feishu GET /": "agents.messaging.feishu.get",
  "agents.messaging.feishu PUT /": "agents.messaging.feishu.update",
  "agents.messaging.feishu POST /state": "agents.messaging.feishu.setState",
  "agents.messaging.feishu DELETE /": "agents.messaging.feishu.delete",
  "agents.messaging.feishu POST /test": "agents.messaging.feishu.test",
  "agents.messaging.feishu POST /test-message": "agents.messaging.feishu.testMessage",
  "agents.messaging.telegram GET /": "agents.messaging.telegram.get",
  "agents.messaging.telegram PUT /": "agents.messaging.telegram.update",
  "agents.messaging.telegram POST /state": "agents.messaging.telegram.setState",
  "agents.messaging.telegram DELETE /": "agents.messaging.telegram.delete",
  "agents.messaging.telegram POST /test": "agents.messaging.telegram.test",
  "agents.messaging.telegram POST /test-message": "agents.messaging.telegram.testMessage",
  "agents.messaging.qq GET /": "agents.messaging.qq.get",
  "agents.messaging.qq PUT /": "agents.messaging.qq.update",
  "agents.messaging.qq POST /state": "agents.messaging.qq.setState",
  "agents.messaging.qq DELETE /": "agents.messaging.qq.delete",
  "agents.messaging.qq POST /scan": "agents.messaging.qq.scanStart",
  "agents.messaging.qq POST /scan/poll": "agents.messaging.qq.scanPoll",
  "agents.messaging.qq POST /scan/cancel": "agents.messaging.qq.scanCancel",
  "agents.messaging.qq POST /test": "agents.messaging.qq.test",
  "agents.messaging.qq POST /test-message": "agents.messaging.qq.testMessage",
  "agents.messaging.wechat GET /": "agents.messaging.wechat.get",
  "agents.messaging.wechat PUT /": "agents.messaging.wechat.update",
  "agents.messaging.wechat POST /state": "agents.messaging.wechat.setState",
  "agents.messaging.wechat DELETE /": "agents.messaging.wechat.delete",
  "agents.messaging.wechat POST /scan": "agents.messaging.wechat.scanStart",
  "agents.messaging.wechat POST /scan/poll": "agents.messaging.wechat.scanPoll",
  "agents.messaging.wechat POST /scan/verify": "agents.messaging.wechat.scanVerify",
  "agents.messaging.wechat POST /scan/cancel": "agents.messaging.wechat.scanCancel",
  "agents.messaging.wechat POST /test": "agents.messaging.wechat.test",
  "agents.messaging.wechat POST /test-message": "agents.messaging.wechat.testMessage",

  // Projects, Members, Dirs & Command Policy
  "projects GET /": "project.list",
  "projects POST /": "project.create",
  "projects PATCH /:projectId": "project.update",
  "projects DELETE /:projectId": "project.delete",
  "projects.members GET /": "project.member.list",
  "projects.members POST /": "project.member.add",
  "projects.members DELETE /:userId": "project.member.remove",
  "projects.dirs GET /": "project.dir.list",
  "projects.dirs POST /access": "project.dir.checkAccess",
  "suggest-id POST /": "project.suggestId",
  "sessions.command-policy GET /": "project.commandPolicy.get",
  "sessions.command-policy PUT /": "project.commandPolicy.update",

  // Plugin CLI Commands
  "cli.commands GET /": "cli.commands.list",
  "cli.commands POST /run": "cli.commands.run",

  // System, Version, Profile, Themes, Languages & Desktop
  "version GET /": "version.get",
  "version GET /history": "version.listHistory",
  "version GET /history/ifaces/:hash": "version.getHistoryIfaces",
  "version GET /history/diff": "version.getHistoryDiff",
  "version POST /history/rollback": "version.rollback",
  "version GET /update-check": "version.getUpdateCheck",
  "version GET /update": "version.getUpdate",
  "version POST /update": "version.startUpdate",
  "version POST /restart": "version.restart",
  "handshake GET /": "handshake.get",
  "events GET /": "events.stream",
  "web.contributions GET /": "web.contributions.list",
  "languages GET /": "languages.list",
  "languages GET /:id/grammar": "languages.getGrammar",
  "themes GET /": "themes.list",
  "themes GET /:id/files/*": "themes.getFile",
  "themes POST /": "themes.create",
  "themes DELETE /:id": "themes.delete",
  "themes GET /:id/export": "themes.export",
  "me GET /": "me.get",
  "me PUT /password": "me.updatePassword",
  "me PUT /profile": "me.updateProfile",
  "me GET /prefs": "me.getPrefs",
  "me PUT /prefs": "me.updatePrefs",
  "me GET /background-image": "me.getBackgroundImage",
  "me PUT /background-image": "me.updateBackgroundImage",
  "me GET /drafts": "me.getDrafts",
  "me PATCH /drafts": "me.updateDrafts",
  "desktop.update GET /": "desktop.update.get",
  "desktop.update POST /check": "desktop.update.check",
  "desktop.update POST /download": "desktop.update.download",
  "desktop.update POST /install": "desktop.update.install",
  "desktop.tray GET /": "desktop.tray.get",
  "desktop.tray PUT /": "desktop.tray.update",
  "desktop.privacy POST /": "desktop.privacy.open",
  "desktop.window POST /": "desktop.window.action",

  // Server Admin
  "admin.users GET /": "admin.users.list",
  "admin.users POST /": "admin.users.create",
  "admin.users POST /:userId/password": "admin.users.setPassword",
  "admin.users DELETE /:userId": "admin.users.delete",
  "admin.settings GET /": "admin.settings.get",
  "admin.settings PUT /": "admin.settings.update",
  "admin.settings GET /proxy-probe": "admin.settings.listProxyProbes",
  "admin.settings POST /proxy-probe/:provider": "admin.settings.runProxyProbe",
  "admin.plugin-config GET /": "admin.pluginConfig.get",
  "admin.plugin-config PUT /": "admin.pluginConfig.update",
  "admin.plugin-config POST /action": "admin.pluginConfig.action",
} as const;

export type DirectHttpRouteId = (typeof DIRECT_HTTP_ROUTE_IDS)[number];
export type GroupHttpRouteId =
  (typeof HTTP_GROUP_ENDPOINT_IDS)[keyof typeof HTTP_GROUP_ENDPOINT_IDS];
export type HttpRouteId = DirectHttpRouteId | GroupHttpRouteId;

/** Every fine-grained `auth: "user"` HTTP route ID registered on the server. */
export const ALL_HTTP_ROUTE_IDS: readonly HttpRouteId[] = [
  ...new Set<HttpRouteId>([...DIRECT_HTTP_ROUTE_IDS, ...Object.values(HTTP_GROUP_ENDPOINT_IDS)]),
];

const LEGACY_MESSAGING_CHANNEL_PREFIXES = [
  ["agents.feishu", "agents.messaging.feishu"],
  ["agents.telegram", "agents.messaging.telegram"],
  ["agents.qq", "agents.messaging.qq"],
  ["agents.wechat", "agents.messaging.wechat"],
  ["messaging.feishu.", "agents.messaging.feishu."],
  ["messaging.telegram.", "agents.messaging.telegram."],
  ["messaging.qq.", "agents.messaging.qq."],
  ["messaging.wechat.", "agents.messaging.wechat."],
] as const;

/**
 * Normalizes an endpoint or role ID:
 * - strips an optional legacy `"penguin."` prefix
 * - normalizes `agents.<channel>` / `messaging.<channel>.*` to `agents.messaging.<channel>.*`
 */
export function normalizeRouteId(routeId: string): string {
  const stripped = routeId.startsWith("penguin.") ? routeId.slice("penguin.".length) : routeId;
  for (const [legacyPrefix, canonicalPrefix] of LEGACY_MESSAGING_CHANNEL_PREFIXES) {
    if (stripped === legacyPrefix) {
      return canonicalPrefix;
    }
    if (legacyPrefix.endsWith(".") && stripped.startsWith(legacyPrefix)) {
      return `${canonicalPrefix}${stripped.slice(legacyPrefix.length)}`;
    }
    if (!legacyPrefix.endsWith(".") && stripped.startsWith(`${legacyPrefix}.`)) {
      return `${canonicalPrefix}.${stripped.slice(legacyPrefix.length + 1)}`;
    }
  }
  return stripped;
}

/**
 * Parses a grant specification that may carry an `@<refinerId>` suffix
 * (e.g. `"agent.maintain@self"` or `"agent.maintain@withAsk"`).
 */
export function parseRefinedGrant(spec: string): {
  target: string;
  refinerId: string | null;
} {
  const trimmed = spec.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex === -1) {
    return { target: normalizeRouteId(trimmed), refinerId: null };
  }
  const rawTarget = trimmed.slice(0, atIndex).trim();
  const rawRefiner = trimmed.slice(atIndex + 1).trim();
  return {
    target: normalizeRouteId(rawTarget),
    refinerId: rawRefiner !== "" ? rawRefiner : null,
  };
}

/**
 * Resolves a `(groupId, method, subPath)` route to its fine-grained HTTP route ID,
 * falling back to `normalizeRouteId(groupId)` for single-endpoint registrations.
 */
export function resolveHttpRouteId(groupId: string, method: string, subPath: string): string {
  const normalizedGroup = normalizeRouteId(groupId);
  const normalizedPath = subPath === "" ? "/" : subPath;
  const key = `${normalizedGroup} ${method.toUpperCase()} ${normalizedPath}` as keyof typeof HTTP_GROUP_ENDPOINT_IDS;
  const rawKey = `${groupId} ${method.toUpperCase()} ${normalizedPath}` as keyof typeof HTTP_GROUP_ENDPOINT_IDS;
  return HTTP_GROUP_ENDPOINT_IDS[key] ?? HTTP_GROUP_ENDPOINT_IDS[rawKey] ?? normalizedGroup;
}

/**
 * All role presets in the Role Tree:
 * - Domain 3-tier presets (`<domain>.read` -> `<domain>.maintain` -> `<domain>.all`)
 * - Organization sub-domain presets (`org.<subresource>.read` -> `maintain` -> `all`)
 * - Composite persona presets (`none`, `readonly`, `general`, `system-maintainer`, `admin`, `full-permissions`)
 */
export const AGENT_AUTH_ROLES = [
  // Composite / Persona roles
  "none",
  "readonly",
  "general",
  "system-maintainer",
  "admin",
  "full-permissions",

  // Domain 3-tier roles
  "session.read",
  "session.maintain",
  "session.all",
  "workspace.read",
  "workspace.maintain",
  "workspace.all",
  "agent.read",
  "agent.maintain",
  "agent.all",
  "memory.read",
  "memory.maintain",
  "memory.all",
  "schedule.read",
  "schedule.maintain",
  "schedule.all",
  "skill.read",
  "skill.maintain",
  "skill.all",
  "plugin.read",
  "plugin.maintain",
  "plugin.all",
  "workbench.read",
  "workbench.maintain",
  "workbench.all",
  "model.read",
  "model.maintain",
  "model.all",
  "vault.read",
  "vault.maintain",
  "vault.all",
  "trace.read",
  "trace.maintain",
  "trace.all",
  "benchmark.read",
  "benchmark.maintain",
  "benchmark.all",
  "org.read",
  "org.maintain",
  "org.all",
  "org.employee.read",
  "org.employee.maintain",
  "org.employee.all",
  "org.handbook.read",
  "org.handbook.maintain",
  "org.handbook.all",
  "org.calendar.read",
  "org.calendar.maintain",
  "org.calendar.all",
  "org.ticket.read",
  "org.ticket.maintain",
  "org.channel.read",
  "org.channel.maintain",
  "org.channel.all",
  "org.finance.read",
  "browser.read",
  "browser.maintain",
  "browser.all",
  "machine.read",
  "machine.maintain",
  "machine.all",
  "agents.messaging.read",
  "agents.messaging.maintain",
  "agents.messaging.all",
  "messaging.read",
  "messaging.maintain",
  "messaging.all",
  "project.read",
  "project.maintain",
  "project.all",
  "command.read",
  "command.maintain",
  "command.all",
  "system.read",
  "system.maintain",
  "system.all",
  "admin.read",
  "admin.maintain",
  "admin.all",
] as const;

export type AgentAuthRole = (typeof AGENT_AUTH_ROLES)[number];

/** Role reference in `ROLE_TREE`, optionally refined via `<role>@<refinerId>`. */
export type RoleChildRef = AgentAuthRole | `${AgentAuthRole}@${string}`;

/** Leaf route reference in `ROLE_TREE`, optionally refined via `<routeId>@<refinerId>`. */
export type RoleRouteRef = HttpRouteId | `${HttpRouteId}@${string}`;

/** The role a newly created Agent's session runs under, absent an explicit grant. */
export const DEFAULT_AGENT_AUTH_ROLE: AgentAuthRole = "general";

export interface RoleFlags {
  /** Reaches every HTTP route without enumerating leaf route IDs. */
  readonly allEndpoints?: boolean;
  /** Reaches human-gated Agent API settings and key endpoints. */
  readonly agentApi?: boolean;
  /** Reaches mutating Agent-scoped routes of other Agents in the same Project. */
  readonly crossAgent?: boolean;
}

export interface RoleNode {
  /** Child roles in the Role Tree inherited by this role (supports `<role>@<refinerId>`). */
  readonly children?: readonly RoleChildRef[];
  /** Leaf HTTP route IDs bound directly at this role node (supports `<routeId>@<refinerId>`). */
  readonly routes?: readonly RoleRouteRef[];
  /** Capability flags granted by this role node. */
  readonly flags?: RoleFlags;
}

/**
 * The declarative Role Tree Bind (`ROLE_TREE`).
 * Each leaf route ID is bound once at the lowest role node that permits it; higher tiers
 * and composite roles inherit routes transitively through `children`.
 */
export const ROLE_TREE: Readonly<Record<AgentAuthRole, RoleNode>> = {
  // ---------------------------------------------------------------------------
  // 1. session (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "session.read": {
    routes: [
      "session.list",
      "session.listBatch",
      "session.get",
      "session.getScratchpadFile",
      "session.getTraceImage",
      "session.getMessages",
      "session.getAmsp",
      "session.listApprovals",
      "session.stream",
      "session.getGoal",
      "session.listProcesses",
      "session.listFiles",
      "session.readFile",
      "session.searchFiles",
      "session.previewFileRedirect",
      "session.statFiles",
      "session.getContext",
      "session.listTraces",
      "session.getTrace",
      "session.getTraceAnalysis",
      "session.getHistory",
      "session.getHistoryLines",
      "session.getTraceBody",
      "session.listArchivedGroups",
      "session.listArchived",
    ],
  },
  "session.maintain": {
    children: ["session.read"],
    routes: [
      "session.create",
      "session.update",
      "session.fork",
      "session.runTask",
      "session.steer",
      "session.deleteSteer",
      "session.messageSubagent",
      "session.abortSubagent",
      "session.deleteFollowUp",
      "session.interrupt",
      "session.resolveApproval",
      "session.backgroundToolCall",
      "session.abort",
      "session.killProcess",
      "session.deleteProcess",
      "session.retryNow",
      "session.retry",
      "session.compact",
      "session.switchModel",
      "session.writeFile",
      "session.createFile",
      "session.moveFile",
      "session.revealFile",
      "session.unarchive",
    ],
  },
  "session.all": {
    children: ["session.maintain"],
    routes: [
      "session.delete",
      "session.deleteFile",
      "session.archiveWorkspace",
      "session.deleteArchived",
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. workspace (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "workspace.read": {
    routes: ["workspace.listFiles", "workspace.readFile", "workspace.searchFiles"],
  },
  "workspace.maintain": {
    children: ["workspace.read"],
    routes: [
      "workspace.writeFile",
      "workspace.createFile",
      "workspace.moveFile",
      "workspace.revealFile",
    ],
  },
  "workspace.all": {
    children: ["workspace.maintain"],
    routes: ["workspace.deleteFile"],
  },

  // ---------------------------------------------------------------------------
  // 3. agent (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "agent.read": {
    routes: [
      "agent.list",
      "agent.getDeletion",
      "agent.auth.get",
      "agent.config.get",
      "agent.avatar.get",
      "agent.archive.export",
      "agent.api.get",
    ],
  },
  "agent.maintain": {
    children: ["agent.read"],
    routes: [
      "agent.create",
      "agent.config.update",
      "agent.config.mcpTest",
      "agent.config.kernelUpdate",
      "agent.avatar.update",
      "agent.archive.import",
      "agent.api.try",
    ],
  },
  "agent.all": {
    children: ["agent.maintain"],
    routes: [
      "agent.delete",
      "agent.config.reset",
      "agent.api.update",
      "agent.api.createKey",
      "agent.api.deleteKey",
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. memory (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "memory.read": {
    routes: ["memory.get", "memory.listFiles", "memory.readFile", "memory.export"],
  },
  "memory.maintain": {
    children: ["memory.read"],
    routes: ["memory.templatePlaceholder", "memory.import"],
  },
  "memory.all": {
    children: ["memory.maintain"],
    routes: ["memory.deleteFile"],
  },

  // ---------------------------------------------------------------------------
  // 5. schedule (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "schedule.read": {
    routes: ["schedule.list", "schedule.get", "schedule.listProject"],
  },
  "schedule.maintain": {
    children: ["schedule.read"],
    routes: ["schedule.create", "schedule.templatePlaceholder", "schedule.update"],
  },
  "schedule.all": {
    children: ["schedule.maintain"],
    routes: ["schedule.delete"],
  },

  // ---------------------------------------------------------------------------
  // 6. skill (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "skill.read": {
    routes: [
      "skill.list",
      "skill.exportArchive",
      "skill.getIcon",
      "skill.listDir",
      "skill.getDirIcon",
    ],
  },
  "skill.maintain": {
    children: ["skill.read"],
    routes: ["skill.templatePlaceholder", "skill.importArchive"],
  },
  "skill.all": {
    children: ["skill.maintain"],
    routes: ["skill.delete"],
  },

  // ---------------------------------------------------------------------------
  // 7. plugin (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "plugin.read": {
    routes: [
      "plugin.library.list",
      "plugin.library.listFiles",
      "plugin.library.getReadme",
      "plugin.library.getArchive",
      "plugin.library.getIcon",
      "plugin.registry.list",
      "plugin.registry.getIcon",
      "plugin.registry.getReadme",
      "plugin.registry.getArchive",
      "plugin.installed.list",
      "plugin.agent.list",
      "plugin.hook.list",
      "plugin.hook.exportArchive",
      "plugin.hook.getIcon",
      "plugin.mcp.list",
    ],
  },
  "plugin.maintain": {
    children: ["plugin.read"],
    routes: [
      "plugin.agent.install",
      "plugin.hook.importArchive",
      "plugin.installed.install",
      "plugin.installed.link",
      "plugin.installed.importArchive",
      "plugin.installed.setEnabled",
    ],
  },
  "plugin.all": {
    children: ["plugin.maintain"],
    routes: [
      "plugin.agent.uninstall",
      "plugin.hook.delete",
      "plugin.mcp.delete",
      "plugin.installed.uninstall",
    ],
  },

  // ---------------------------------------------------------------------------
  // 8. workbench (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "workbench.read": {
    routes: [
      "workbench.list",
      "workbench.exportArchive",
      "workbench.getHistory",
      "workbench.getAppCenterIcon",
      "workbench.serveUi",
      "workbench.serveSdkUi",
      "workbench.serveSdkFile",
      "workbench.appCenter.list",
    ],
  },
  "workbench.maintain": {
    children: ["workbench.read"],
    routes: [
      "workbench.setAllEnabled",
      "workbench.setEnabled",
      "workbench.importArchive",
      "workbench.reload",
      "workbench.rollback",
      "workbench.updateSidebar",
      "workbench.updateAppCenter",
      "workbench.callApi",
      "workbench.appCenter.updateLayout",
    ],
  },
  "workbench.all": {
    children: ["workbench.maintain"],
    routes: ["workbench.delete"],
  },

  // ---------------------------------------------------------------------------
  // 9. model (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "model.read": {
    routes: [
      "model.list",
      "model.getBalance",
      "model.test",
      "model.detect",
      "model.listRemote",
      "model.detectVision",
      "model.oauth.list",
      "model.oauth.getStatus",
      "model.platformAuth.getStatus",
      "model.modelscopeAuth.getStatus",
      "model.chatDefaults.get",
    ],
  },
  "model.maintain": {
    children: ["model.read"],
    routes: [
      "model.setDefault",
      "model.syncPresets",
      "model.platformAuth.sync",
      "model.chatDefaults.update",
    ],
  },
  "model.all": {
    children: ["model.maintain"],
    routes: [
      "model.update",
      "model.updateProvider",
      "model.oauth.start",
      "model.oauth.submitCode",
      "model.platformAuth.start",
      "model.platformAuth.retry",
      "model.platformAuth.cancel",
      "model.modelscopeAuth.start",
      "model.modelscopeAuth.retry",
      "model.modelscopeAuth.cancel",
    ],
  },

  // ---------------------------------------------------------------------------
  // 10. vault (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "vault.read": {
    routes: ["vault.get"],
  },
  "vault.maintain": {
    children: ["vault.read"],
    routes: ["vault.update", "vault.setEntry", "vault.templatePlaceholder"],
  },
  "vault.all": {
    children: ["vault.maintain"],
    routes: ["vault.deleteEntry"],
  },

  // ---------------------------------------------------------------------------
  // 11. trace & usage (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "trace.read": {
    routes: [
      "trace.list",
      "trace.get",
      "trace.getAnalysis",
      "trace.download",
      "usage.get",
      "usage.getModelTotals",
      "usage.listErrors",
    ],
  },
  "trace.maintain": {
    children: ["trace.read"],
    routes: ["trace.import"],
  },
  "trace.all": {
    children: ["trace.maintain"],
    routes: ["usage.clearErrors"],
  },

  // ---------------------------------------------------------------------------
  // 12. benchmark (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "benchmark.read": {
    routes: [
      "benchmark.list",
      "benchmark.exportArchive",
      "benchmark.listCases",
      "benchmark.listCaseFiles",
      "benchmark.readCaseFile",
      "benchmark.listRubricFiles",
      "benchmark.readRubricFile",
    ],
  },
  "benchmark.maintain": {
    children: ["benchmark.read"],
    routes: ["benchmark.create", "benchmark.importArchive"],
  },
  "benchmark.all": {
    children: ["benchmark.maintain"],
    routes: ["benchmark.delete"],
  },

  // ---------------------------------------------------------------------------
  // 13. org & sub-domains (employee, handbook, calendar, ticket, channel, finance)
  // ---------------------------------------------------------------------------
  "org.employee.read": {
    routes: ["org.employee.getAvatar", "org.employee.getDesk"],
  },
  "org.employee.maintain": {
    children: ["org.employee.read"],
    routes: [
      "org.employee.hire",
      "org.employee.update",
      "org.employee.updateAvatar",
      "org.employee.startDesk",
    ],
  },
  "org.employee.all": {
    children: ["org.employee.maintain"],
    routes: ["org.employee.remove"],
  },

  "org.handbook.read": {
    routes: ["org.handbook.get", "org.handbook.listFiles", "org.handbook.readFile"],
  },
  "org.handbook.maintain": {
    children: ["org.handbook.read"],
    routes: ["org.handbook.update", "org.handbook.writeFile"],
  },
  "org.handbook.all": {
    children: ["org.handbook.maintain"],
    routes: ["org.handbook.deleteFile"],
  },

  "org.calendar.read": {
    routes: ["org.calendar.list", "org.calendar.get"],
  },
  "org.calendar.maintain": {
    children: ["org.calendar.read"],
    routes: ["org.calendar.create", "org.calendar.update"],
  },
  "org.calendar.all": {
    children: ["org.calendar.maintain"],
    routes: ["org.calendar.delete"],
  },

  "org.ticket.read": {
    routes: ["org.ticket.list", "org.ticket.get"],
  },
  "org.ticket.maintain": {
    children: ["org.ticket.read"],
    routes: [
      "org.ticket.create",
      "org.ticket.update",
      "org.ticket.move",
      "org.ticket.block",
      "org.ticket.unblock",
      "org.ticket.progress",
      "org.ticket.start",
      "org.ticket.attach",
    ],
  },

  "org.channel.read": {
    routes: ["org.channel.list", "org.channel.get", "org.channel.listMessages"],
  },
  "org.channel.maintain": {
    children: ["org.channel.read"],
    routes: [
      "org.channel.create",
      "org.channel.update",
      "org.channel.addMember",
      "org.channel.postMessage",
      "org.channel.markRead",
    ],
  },
  "org.channel.all": {
    children: ["org.channel.maintain"],
    routes: ["org.channel.removeMember"],
  },

  "org.finance.read": {
    routes: ["org.finance.get"],
  },

  "org.read": {
    children: [
      "org.employee.read",
      "org.handbook.read",
      "org.calendar.read",
      "org.ticket.read",
      "org.channel.read",
      "org.finance.read",
    ],
    routes: ["org.list", "org.get", "org.getChart", "org.session.list"],
  },
  "org.maintain": {
    children: [
      "org.read",
      "org.employee.maintain",
      "org.handbook.maintain",
      "org.calendar.maintain",
      "org.ticket.maintain",
      "org.channel.maintain",
    ],
    routes: ["org.update"],
  },
  "org.all": {
    children: [
      "org.maintain",
      "org.employee.all",
      "org.handbook.all",
      "org.calendar.all",
      "org.channel.all",
    ],
    routes: ["org.create", "org.delete"],
  },

  // ---------------------------------------------------------------------------
  // 14. browser (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "browser.read": {
    routes: [
      "browser.getStatus",
      "browser.getBackend",
      "browser.listExtensions",
      "browser.listTabs",
      "browser.listImportSources",
      "browser.getSettings",
      "browser.getHistory",
    ],
  },
  "browser.maintain": {
    children: ["browser.read"],
    routes: [
      "browser.openTab",
      "browser.openSessionTab",
      "browser.claimTabs",
      "browser.setOnScreen",
      "browser.activateTab",
      "browser.closeTab",
      "browser.navigate",
      "browser.scan",
      "browser.exec",
      "browser.click",
      "browser.type",
      "browser.screenshot",
      "browser.cdp",
    ],
  },
  "browser.all": {
    children: ["browser.maintain"],
    routes: [
      "browser.setBackend",
      "browser.createExtensionPairing",
      "browser.revokeExtension",
      "browser.importData",
      "browser.updateSettings",
      "browser.clearHistory",
      "browser.clearData",
    ],
  },

  // ---------------------------------------------------------------------------
  // 15. machine (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "machine.read": {
    routes: [
      "machine.list",
      "machine.events",
      "machine.listSshHosts",
      "machine.getSshHost",
      "machine.listDirs",
      "machine.probe",
      "machine.diagnose",
    ],
  },
  "machine.maintain": {
    children: ["machine.read"],
    routes: [
      "machine.use",
      "machine.stopUsing",
      "machine.connect",
      "machine.reconnect",
      "machine.stopReconnecting",
      "machine.disconnect",
      "machine.restart",
      "machine.stop",
      "machine.sync",
    ],
  },
  "machine.all": {
    children: ["machine.maintain"],
    routes: [
      "machine.add",
      "machine.createSshHost",
      "machine.updateSshHost",
      "machine.install",
      "machine.uninstall",
      "machine.release",
      "machine.proxy",
    ],
  },

  // ---------------------------------------------------------------------------
  // 16. messaging & agents.messaging (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "agents.messaging.read": {
    routes: [
      "agents.messaging.feishu.get",
      "agents.messaging.telegram.get",
      "agents.messaging.qq.get",
      "agents.messaging.wechat.get",
    ],
  },
  "agents.messaging.maintain": {
    children: ["agents.messaging.read"],
    routes: [
      "agents.messaging.feishu.update",
      "agents.messaging.feishu.setState",
      "agents.messaging.feishu.test",
      "agents.messaging.feishu.testMessage",
      "agents.messaging.telegram.update",
      "agents.messaging.telegram.setState",
      "agents.messaging.telegram.test",
      "agents.messaging.telegram.testMessage",
      "agents.messaging.qq.update",
      "agents.messaging.qq.setState",
      "agents.messaging.qq.scanStart",
      "agents.messaging.qq.scanPoll",
      "agents.messaging.qq.scanCancel",
      "agents.messaging.qq.test",
      "agents.messaging.qq.testMessage",
      "agents.messaging.wechat.update",
      "agents.messaging.wechat.setState",
      "agents.messaging.wechat.scanStart",
      "agents.messaging.wechat.scanPoll",
      "agents.messaging.wechat.scanVerify",
      "agents.messaging.wechat.scanCancel",
      "agents.messaging.wechat.test",
      "agents.messaging.wechat.testMessage",
    ],
  },
  "agents.messaging.all": {
    children: ["agents.messaging.maintain"],
    routes: [
      "agents.messaging.feishu.delete",
      "agents.messaging.telegram.delete",
      "agents.messaging.qq.delete",
      "agents.messaging.wechat.delete",
    ],
  },
  "messaging.read": {
    children: ["agents.messaging.read"],
    routes: [
      "messaging.listAccounts",
      "messaging.listAccountHolders",
      "messaging.session.list",
    ],
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
    routes: [
      "project.list",
      "project.member.list",
      "project.dir.list",
      "project.dir.checkAccess",
      "project.suggestId",
      "project.commandPolicy.get",
    ],
  },
  "project.maintain": {
    children: ["project.read"],
    routes: ["project.create", "project.update", "project.member.add"],
  },
  "project.all": {
    children: ["project.maintain"],
    routes: ["project.delete", "project.member.remove", "project.commandPolicy.update"],
  },

  // ---------------------------------------------------------------------------
  // 18. command (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "command.read": {
    routes: ["command.list", "cli.commands.list"],
  },
  "command.maintain": {
    children: ["command.read"],
    routes: ["command.run"],
  },
  "command.all": {
    children: ["command.maintain"],
    routes: ["cli.commands.run"],
  },

  // ---------------------------------------------------------------------------
  // 19. system (read -> maintain -> all)
  // ---------------------------------------------------------------------------
  "system.read": {
    routes: [
      "version.get",
      "version.listHistory",
      "version.getHistoryIfaces",
      "version.getHistoryDiff",
      "version.getUpdateCheck",
      "version.getUpdate",
      "handshake.get",
      "events.stream",
      "web.contributions.list",
      "languages.list",
      "languages.getGrammar",
      "themes.list",
      "themes.getFile",
      "themes.export",
      "me.get",
      "me.getPrefs",
      "me.getBackgroundImage",
      "me.getDrafts",
      "desktop.update.get",
      "desktop.tray.get",
    ],
  },
  "system.maintain": {
    children: ["system.read"],
    routes: [
      "me.updateProfile",
      "me.updatePrefs",
      "me.updateBackgroundImage",
      "me.updateDrafts",
      "themes.create",
      "desktop.tray.update",
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

export function isAgentAuthRole(value: string): value is AgentAuthRole {
  return Object.hasOwn(ROLE_TREE, value);
}

/**
 * Expands a primary `role` (which may itself carry `<role>@<refinerId>`) and optional
 * `extraGrants` (which may name additional `AgentAuthRole` tree nodes or individual HTTP
 * route IDs, with optional `@<refinerId>`) into the effective route set, capability flags,
 * and per-route refiner map (`routeRefiners`).
 *
 * Rules for `@refiner` propagation:
 * 1. If a leaf route is granted unconditionally along any tree path (no `@refiner`), it is
 *    permitted unconditionally and omitted from `routeRefiners`.
 * 2. When `<role>@<refinerId>` is applied to a `.maintain` or `.all` role node, the inherited
 *    `.read` base tier remains unconditional (unless the caller explicitly wrote `<domain>.read@<refinerId>`),
 *    so read-only queries are not unnecessarily gated by write refiners like `@withAsk`.
 */
export function expandRoleGrant(
  role: string,
  extraGrants: readonly string[] = [],
): {
  allEndpoints: boolean;
  agentApi: boolean;
  crossAgent: boolean;
  apiIds: string[];
  routeRefiners: Record<string, string[]>;
} {
  const visited = new Set<string>();
  const allRoutes = new Set<string>();
  const unconditionalRoutes = new Set<string>();
  const refinedRouteMap = new Map<string, Set<string>>();
  let allEndpoints = false;
  let agentApi = false;
  let crossAgent = false;

  const recordRoute = (routeId: string, refinerId: string | null): void => {
    const normalized = normalizeRouteId(routeId);
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

  const visitRole = (r: AgentAuthRole, inheritedRefiner: string | null, isRootRefined: boolean): void => {
    const isReadTier = r === "readonly" || r.endsWith(".read");
    const effectiveRefiner =
      inheritedRefiner !== null && isReadTier && !isRootRefined ? null : inheritedRefiner;
    const visitKey = `${r}@${effectiveRefiner ?? ""}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const node = ROLE_TREE[r];
    if (node === undefined) return;
    if (effectiveRefiner === null) {
      if (node.flags?.allEndpoints) allEndpoints = true;
      if (node.flags?.agentApi) agentApi = true;
      if (node.flags?.crossAgent) crossAgent = true;
    }
    if (node.routes !== undefined) {
      for (const routeSpec of node.routes) {
        const parsed = parseRefinedGrant(routeSpec);
        const routeRefiner = parsed.refinerId ?? effectiveRefiner;
        recordRoute(parsed.target, routeRefiner);
      }
    }
    if (node.children !== undefined) {
      for (const childSpec of node.children) {
        const parsed = parseRefinedGrant(childSpec);
        if (isAgentAuthRole(parsed.target)) {
          const childRefiner = parsed.refinerId ?? effectiveRefiner;
          const childRootRefined = parsed.refinerId !== null;
          visitRole(parsed.target, childRefiner, childRootRefined);
        } else if (parsed.target !== "") {
          recordRoute(parsed.target, parsed.refinerId ?? effectiveRefiner);
        }
      }
    }
  };

  const applyGrantSpec = (spec: string): void => {
    const parsed = parseRefinedGrant(spec);
    if (parsed.target === "") return;
    if (isAgentAuthRole(parsed.target)) {
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

/**
 * The roles whose sessions may reach EVERY route the server registers, the granted set aside.
 */
export const ALL_ENDPOINT_ROLES: readonly AgentAuthRole[] = ["admin", "full-permissions"];

/** Whether the role reaches every route without its granted set naming it. */
export function roleSpansAllEndpoints(role: string): boolean {
  return expandRoleGrant(role).allEndpoints;
}

/** Whether the role carries the Agent's own API settings and keys (human-gated endpoints). */
export function roleHasAgentApi(role: string): boolean {
  return expandRoleGrant(role).agentApi;
}

/** Whether the role may mutate Agent-scoped resources of other Agents in the same Project. */
export function roleCanManageOtherAgents(role: string): boolean {
  return expandRoleGrant(role).crossAgent;
}
