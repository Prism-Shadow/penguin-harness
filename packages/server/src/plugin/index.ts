/**
 * The harness's plugin surface — the `@prismshadow/penguin-server/plugin` subpath.
 *
 * The contract is `@prismshadow/penguin-core/plugin` (a plugin is a set of
 * modules) and this module does not re-export it: a plugin imports the contract from
 * core and this subpath only for what its name promises, so a package's import sites say
 * which of the two it needs — a sandbox backend, written against the sandbox vocabulary
 * and nothing else, names core alone. What the harness adds is the set of INTERFACES an
 * plugin module may require — a component class (`AgentService`, whose public surface
 * is its contract) or an abstract interface class (`extends Interface<…>()`) declared
 * beside its owner — reachable as `<module>#<Export>` in a manifest's `requires`.
 *
 * A code plugin reaches the host through this module alone (API shapes, types only, come from
 * `@prismshadow/penguin-server/api`): never a path inside the server, and never a private
 * `library/*` package for a type — those are bundled into the plugin, not resolved from the
 * prefix. So besides the interfaces it carries the capability interfaces a plugin module
 * `@Use`s (the runtime's, the settings', the identity and Session indexes'), and the few small
 * VALUES a route of its own needs. The values are bundled into the plugin as copies, so none of
 * them keeps state a copy would split: they compute from their arguments or the environment,
 * `ensureInstallId` reads (and on a root's first use writes) the data root's `install-id` file,
 * and an HttpError a plugin throws answers with its own status and code because the host knows
 * it by its brand (http/errors.ts, `isHttpError`), not by `instanceof`.
 *
 * A slot or a slot field is as old as the platform that added it: an older platform's check
 * refuses a contribution naming one it does not know, and drops the module's contributions to
 * that slot. A plugin published to npm states the oldest platform it needs.
 */
export type { Channels, Clock, Config, Db, Desktop, Log, Paths } from "../hmr/capabilities.js";
export type { Users } from "@prismshadow/penguin-library-auth";
export type { SessionDrivers, SessionIndex } from "@prismshadow/penguin-library-session";
export type { Settings, UiPrefsStore } from "@prismshadow/penguin-library-setting";
export type { Access, ProjectConfigStore, Projects } from "@prismshadow/penguin-library-project";
export type {
  SessionCategory,
  TraceIndex,
  TraceIndexStore,
} from "@prismshadow/penguin-library-trace";
export type { SessionRow } from "@prismshadow/penguin-library-session/repos/sessions";
export type { DataLayout } from "../mechanisms/data-layout.js";
export type { DeletingFolders, DeletingPlace } from "../mechanisms/deleting-folders.js";
export type { SessionActivity } from "../runtime/session-activity.js";
export type { ListingView } from "../runtime/listing-view.js";
export type { AgentConfig } from "../mechanisms/agents.js";
export type { FileReveal } from "../mechanisms/workspace.js";
export type { AppEnv } from "../auth/middleware.js";
export type { ShellPort } from "@prismshadow/penguin-library-setting/desktop-update-port";
export type { UpgradeCaller, WebSocketUpgrade } from "../http/upgrade-endpoints.js";
export type { MeRoutes, MeRoutesSlots, OwnedPref } from "../http/routes/me.js";
export { HttpError, badRequest, errorBody, isHttpError } from "../http/errors.js";
export { publicOriginOf } from "@prismshadow/penguin-library-http/public-origin";
export { parseNonNegativeInt, readJson } from "@prismshadow/penguin-library-http/validate";
export { listingViewOfRequest } from "../runtime/listing-view.js";
export { FsLimiter } from "../services/tree-purge.js";
export { requireHuman } from "../auth/require-human.js";
export { userChannelKey } from "../http/user-channel.js";
export { ensureInstallId } from "../install-id.js";
export { shellPortOf } from "@prismshadow/penguin-library-setting/desktop-update-port";
export { profileFromEnv } from "../machines/profile.js";
export type { Sandbox, SandboxSlots } from "../sandbox/service.js";
export type { AgentStateEngines, AgentStateEnginesSlots } from "../workbenches/engines.js";
export type { Terminals } from "../terminal/manager.js";
export type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
export type { AgentService } from "../services/agent-service.js";
export type { AgentConfigService } from "../services/agent-config-service.js";
export type { Messaging, MessagingSlots } from "../runtime/messaging/module.js";
export type {
  PluginConfig,
  PluginConfigField,
  PluginConfiguration,
  PluginConfigSlots,
  SettingsGroupDecl,
} from "./config.js";
export type {
  PluginStatusCheck,
  PluginStatusReport,
  PluginStatusSummary,
  PluginStatusVersion,
  SettingsGroupStatus,
} from "./config-page.js";
export type { Http, HttpSlots } from "../http/app.js";
export type { WebShell, WebShellSlots } from "../http/routes/contributions.js";
export type { PluginLibrary, PluginLibrarySlots } from "./library-module.js";
export type {
  PluginCliCommand,
  PluginCliCommandRun,
  PluginCliCommands,
  PluginCliCommandsSlots,
} from "./cli-commands.js";
export type { SystemAppData, SystemApps, SystemAppsSlots } from "./system-app-modules.js";
export type {
  DeclaredBinding,
  ToolModelBindingCode,
  ToolModelBindingData,
  ToolModelBindings,
  ToolModelBindingsSlots,
  ToolModelBindingTitle,
  ToolModelCandidate,
  ToolModelTestRequest,
  ToolModelTestSubject,
} from "../services/tool-model-bindings.js";
export type {
  ProjectModelRequest,
  ProjectModelRequests,
  ProjectModelScope,
} from "../services/project-model-requests.js";

// What a system app a plugin provides needs of the host (PRFC-0036): its own folders in a
// Project, Agent tasks started as a person, the read views, the files it serves its page from,
// the archive guards, and the slots of a Project's creation, the semantic ids and the start page.
export type { AppData, AppDataPaths } from "../services/app-data.js";
export type {
  AgentTasks,
  AgentTaskStart,
  AgentTaskState,
  AgentTaskStatus,
} from "../services/agent-tasks.js";
export type { AgentSkills } from "../services/agent-skills.js";
export type { AppSeedData, AppSeeds, AppSeedsSlots } from "../services/app-seeds.js";
export type {
  SemanticIdKindData,
  SemanticIdKinds,
  SemanticIdKindsSlots,
  SemanticIdKindSource,
} from "../services/semantic-id-kinds.js";
export type { StartPage, StartPageSlots } from "../http/routes/start-page.js";
export type { ProjectMachines, ProjectModels } from "./views.js";
export type { MachineApi } from "../machines/machine-api.js";
export type { WorkspaceFiles } from "../mechanisms/workspace.js";
export { containedFile, isSafeRelPath, uiFileResponse } from "../http/static-files.js";
export {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  assertSafeEntryPath,
  unzipBounded,
} from "@prismshadow/penguin-library-http/skill-import-limits";
export type { UnzipLimits } from "@prismshadow/penguin-library-http/skill-import-limits";
export {
  CONTROL_CHARACTER,
  assertDistinctPaths,
  specialEntries,
} from "@prismshadow/penguin-library-http/zip-entries";
