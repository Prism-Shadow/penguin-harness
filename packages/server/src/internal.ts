/**
 * The platform internals the parked plugin groups compile against, one surface: each
 * functional group under plugins/ consumes the host through this subpath while it is
 * parked there (`@prismshadow/penguin-server/internal`), so the group's imports name one
 * seam instead of reaching into the host's file tree. What the host publishes as its own
 * subpaths (./api, ./plugin, …) stays on those.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults. A module the
 * groups no longer need leaves this list; a module two groups need joins it.
 */
export * from "./auth/middleware.js";
export * from "./auth/service.js";
export * from "./db/repos/organizations.js";
export * from "./hmr/asset-archives.js";
export * from "./hmr/capabilities.js";
export * from "./http/errors.js";
export * from "./http/routes/events.js";
export * from "./http/validate.js";
export type { Workbenches } from "@penguinharness/plugin-workbenches/server";
export type { WorkbenchRequest, WorkbenchResponse, WorkbenchInput, WorkbenchResult, WorkbenchMain, WorkbenchHost, WorkbenchTabRenderer, WorkbenchTab, WorkbenchInfo, WorkbenchVersion } from "@penguinharness/plugin-workbenches/server";
export * from "./runtime/channel.js";
export * from "./runtime/agent-state.js";
export * from "./runtime/stream-error-watcher.js";
export * from "./runtime/usage-recorder.js";
export * from "./runtime/error-recorder.js";
export { enabledMessagingChannel } from "@penguinharness/plugin-messaging/server";
export type { MessagingBindings, MessagingConversations, MessagingBindingRow } from "@penguinharness/plugin-messaging/server";
export type {
  AgentConfig,
  AgentLifecycle,
  AgentRow,
  Benchmarks,
  Memory,
  Snapshots,
} from "@penguinharness/plugin-agents/server";
export type {
  Access,
  AccessibleProjectRow,
  AgentIndex,
  MemberRow,
  Members,
  ModelOAuth,
  ModelPromotion,
  ModelPromotions,
  ModelProviderAuthToken,
  ModelProviderAuthTokens,
  ProjectConfigStore,
  ProjectEvents,
  ProjectLifecycle,
  ProjectRow,
  Projects,
} from "@penguinharness/plugin-projects/server";
export type {
  AgentState,
  RunStarter,
  Schedules,
  Scheduling,
  ScheduleStateRow,
  SessionDrivers,
  SessionIndex,
  SessionOrigins,
  SessionRow,
} from "@penguinharness/plugin-sessions/server";
export type {
  ErrorLog,
  Errors,
  MessageCursor,
  TraceFileRow,
  TraceIndex,
  TraceIndexStore,
  TraceSessionRow,
  Traces,
  UsageQueries,
  UsageRecording,
  UsageStore,
} from "@penguinharness/plugin-usage/server";
export type {
  Admin,
  Auth,
  AuthSessionRow,
  AuthSessions,
  SessionViaValue,
  Settings,
  UiPrefsStore,
  UserRow,
  Users,
} from "@penguinharness/plugin-settings/server";
export * from "./services/task-attachments.js";
export { sessionMessages, sessionTraceImage } from "./services/session-history.js";
export { readableSession } from "./http/session-access.js";
export { amspSessionStream } from "./amsp/session-stream.js";
export { pendingApprovals } from "./amsp/approvals.js";
export type { UserDraftsStore } from "./mechanisms/account-data.js";
// The sessions face is a package.json dep, so the bundler keeps it external and a bare
// `export *` from it contributes nothing statically knowable to this module's export
// list — the desktop bundle then fails on the names plugins take from here (see the
// messaging face's explicit `enabledMessagingChannel` above). Name the consumed values.
export {
  ADOPTED_AT_HEADER,
  fallbackTitle,
  listCategory,
  listingMarksOf,
  listingViewOf,
  readRecordedSource,
  recallStoreOf,
  sourceSeenBy,
  unrunSource
} from "@penguinharness/plugin-sessions/server";
export * from "./services/ids.js";
export * from "../../../plugins/projects/src/server/projects/workspace-guard.js";
export * from "../../../plugins/projects/src/server/projects/workspace-group.js";
export * from "../../../plugins/projects/src/server/projects/project-config-service.js";
export * from "../../../plugins/projects/src/server/projects/semantic-id.js";
export * from "../../../plugins/projects/src/server/projects/semantic-id-suggest.js";
export type { FileReveal, WorkspaceFiles } from "@penguinharness/plugin-projects/server";
export type { BrowserExtensionsRepo } from "@penguinharness/plugin-browser/server";
export type { BrowserExtensionRow, BrowserExtensionStore } from "@penguinharness/plugin-browser/server";
export * from "../../../plugins/settings/src/server/repos/server-settings.js";
export * from "./db/repos/machines.js";
export * from "./mechanisms/agent-api.js";
export * from "./lock.js";
export * from "./carried-store.js";
export * from "./secret-file.js";
export * from "./hmr/manifest.js";
export * from "./hmr/pushed-build.js";
export * from "./hmr/push-plugins.js";
export * from "./http/static-files.js";
export * from "./plugin/iface-check.js";
export * from "./plugin/typescript.js";
export * from "./install-id.js";
export * from "./internal/dates.js";
export * from "./internal/mtime-gate.js";
export * from "./internal/trace-head.js";
export * from "../../../plugins/machines/src/server/layout.js";
export * from "./services/desktop-update-port.js";
export * from "./services/desktop-service.js";
export * from "./http/routes/desktop.js";
export * from "./http/routes/directory-skills.js";
export * from "./services/protocol-detect.js";
export * from "./model-catalog/catalog.js";
export * from "./model-catalog/env-keys.js";
export * from "./model-catalog/client-protocols.js";
export * from "./model-catalog/seed.js";
export * from "./services/project-config-migrations.js";
export * from "./services/project-config-seed.js";
export * from "./services/vision-detect.js";
export * from "./services/platform-auth-types.js";
export * from "./services/skill-import-limits.js";
export * from "../../../plugins/projects/src/server/projects/workspace-files-service.js";
export * from "./services/session-service.js";
export * from "@penguinharness/plugin-sessions/server";
export type { Machines } from "../../../plugins/machines/src/server/service.js";
export type { ServerConfig } from "./config.js";
export type { ServerHmrHost } from "./hmr/platform.js";

export * from "./amsp/keys.js";
export * from "./config.js";
export { Clock } from "./hmr/capabilities.js";
export { adminPluginConfigRoutes } from "@penguinharness/plugin-plugins/server";
export type { PluginsRouteDeps } from "@penguinharness/plugin-plugins/server";
export * from "./net/proxy.js";
export { parsePluginIndex, withoutIcon, BUILTIN_REGISTRY_SOURCE, builtinPluginRegistry, httpPluginRegistry, NIGHTLY_INDEX_URL } from "./plugin/registry.js";
export type { PluginRegistry, PluginDisplay, HttpRegistryOptions } from "./plugin/registry.js";
export * from "./services/attachment-limits.js";
export * from "./services/draft-shortcuts.js";
export * from "./services/user-drafts.js";
export * from "./services/account-settings.js";
export type { MeRouteDeps } from "../../../plugins/settings/src/server/me.js";
export type { BackgroundImageStore } from "./mechanisms/account-data.js";
export * from "./services/keybindings.js";
export * from "./services/memory-service.js";
export * from "./services/plugin-library.js";
export * from "./plugin/library-module.js";
export * from "./services/tree-purge.js";
export * from "./http/public-origin.js";
export * from "./socket/ref.js";
export * from "./socket/compression.js";
export * from "./services/preview-token.js";
export * from "./services/cli-shim.js";
export * from "./http/routes/vault.js";
export * from "./http/routes/platform-auth.js";
export * from "./http/routes/command-policy.js";
export { PreviewTokens } from "./http/routes/preview.js";
export * from "./services/proxy-probe.js";
export * from "./http/settle.js";
export * from "./services/directory-skills.js";
export { APPROVAL_MODES } from "@penguinharness/plugin-sessions/server";
export { PluginConfigAdmin } from "./plugin/config-page.js";
export type { PluginConfigAdminSlots } from "./plugin/config-page.js";
export type { PluginPackages } from "@penguinharness/plugin-plugins/server";
export type { PluginConfig } from "@penguinharness/plugin-plugins/server";
export type { Sessions, SessionServiceIface } from "@penguinharness/plugin-sessions/server";
export type { Messaging, MessagingSlots } from "@penguinharness/plugin-messaging/server";
export * from "./http/app.js";
export * from "./http/routes/contributions.js";
export type { Http, HttpSlots } from "./http/app.js";
export type { WebShell, WebShellSlots } from "./http/routes/contributions.js";
export * from "./services/archived-sessions-service.js";
export * from "./runtime/goal-events.js";
export * from "./services/session-deletion.js";
export * from "./services/agent-deletion.js";
export * from "./services/organization-deletion.js";
export * from "./http/sse.js";
export * from "./socket/stream-answer.js";
export * from "./http/media-type.js";
export * from "./services/zip-entries.js";
export * from "../../../plugins/settings/src/server/auth/live-streams.js";
export * from "./services/platform-auth-service.js";
