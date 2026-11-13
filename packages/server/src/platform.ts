import { Component, Module, moduleDefOf, Use } from "@prismshadow/penguin-core/kernel";
import type { ManifestTable, ModuleClass, ModuleDef } from "@prismshadow/penguin-core/kernel";
import table from "./ifaces.json" with { type: "json" };
import type { HmrCapabilities, ReassemblyChange } from "./hmr/capabilities.js";
import {
  ConfigPaths,
  ConsoleLog,
  RuntimeAuthState,
  RuntimeChannels,
  RuntimeConfig,
  RuntimeDb,
  RuntimeDesktop,
  RuntimeHmr,
  RuntimeHmrControl,
  AppReassembly,
  RuntimeProxy,
  RuntimeResourceGroups,
  SystemClock,
  AuthState,
  Channels,
  Clock,
  Config,
  Db,
  Desktop,
  Hmr,
  Reassembly,
  HmrControl,
  Log,
  Paths,
  Proxy,
  ResourceGroups,
} from "./hmr/capabilities.js";
import { ScryptHasher, PasswordHasher } from "./auth/password.js";
import { LiveStreamRegistry, LiveStreams } from "./auth/live-streams.js";
import {
  DefaultMessagingTuning,
  Messaging,
  MessagingTaskRunner,
  MessagingModule,
  QQScan,
} from "@penguinharness/plugin-messaging/server";
import { MessagingAccountsModule } from "@penguinharness/plugin-messaging/server/messaging/accounts-module.js";
import { FeishuSdkProvider } from "@penguinharness/plugin-messaging/server/messaging/feishu-connector.js";
import { TelegramTransportProvider } from "@penguinharness/plugin-messaging/server/messaging/telegram-connector.js";
import { QQTransportProvider } from "@penguinharness/plugin-messaging/server/messaging/qq-connector.js";
import { QQScanTransportProvider } from "@penguinharness/plugin-messaging/server/messaging/qq-scan.js";
import { WeChatTransportProvider } from "@penguinharness/plugin-messaging/server/messaging/wechat-connector.js";
import { WeChatScanTransportProvider } from "@penguinharness/plugin-messaging/server/messaging/wechat-scan.js";
import { PluginConfig, PluginConfigProvider } from "@penguinharness/plugin-plugins/server";
import { PluginConfigAdmin, PluginConfigPage } from "@penguinharness/plugin-plugins/server";
import { PluginCliCommandsProvider } from "@penguinharness/plugin-plugins/server";
import {
  CoreSessionLoaders,
  DefaultTitleGenerators,
  SessionsModule,
  SessionEnv,
  Sessions,
  SessionServiceIface,
} from "@penguinharness/plugin-sessions/server";
import {
  GlobalFetch,
  UpdateCheckService,
  VersionRoutes,
  UpdateCheck,
} from "./services/update-check-service.js";
import { UpdateJobService } from "./services/update-job.js";
import { HarnessHistoryStore } from "@penguinharness/plugin-usage/server";
import { UsersRepo } from "@penguinharness/plugin-settings/server";
import { AuthSessionsRepo } from "@penguinharness/plugin-settings/server";
import { ServerSettingsRepo } from "@penguinharness/plugin-settings/server";
import { UiPrefsRepo } from "@penguinharness/plugin-settings/server";
import { UserDraftsRepo } from "./db/repos/user-drafts.js";
import { BackgroundImagesRepo } from "./db/repos/background-images.js";
import { SessionsRepo } from "@penguinharness/plugin-sessions/server";
import { ProjectsRepo } from "@penguinharness/plugin-projects/server";
import { ModelPromotionsRepo } from "@penguinharness/plugin-projects/server";
import { ModelProviderAuthTokensRepo } from "@penguinharness/plugin-projects/server";
import { MembersRepo } from "@penguinharness/plugin-projects/server";
import { AgentsRepo } from "@penguinharness/plugin-agents/server";
import { UsageRepo } from "@penguinharness/plugin-usage/server";
import { SchedulesRepo } from "@penguinharness/plugin-schedules/server";
import { TraceIndexRepo } from "@penguinharness/plugin-usage/server";
import { MessagingBindingsRepo } from "@penguinharness/plugin-messaging/server";
import { MessagingConversationsRepo } from "@penguinharness/plugin-messaging/server";
import { OrgCacheRepo } from "@penguinharness/plugin-company/server";
import { ErrorsRepo } from "@penguinharness/plugin-usage/server";
import { AgentStateStore } from "@penguinharness/plugin-sessions/server";
import { SessionSources } from "@penguinharness/plugin-sessions/server";
import { SessionDriverRegistry } from "@penguinharness/plugin-sessions/server";
import { ErrorRecorder } from "./runtime/error-recorder.js";
import { UsageRecorder } from "./runtime/usage-recorder.js";
import { UsageService } from "@penguinharness/plugin-usage/server";
import { ProjectConfigService } from "@penguinharness/plugin-projects/server";
import { ModelOAuthService } from "@penguinharness/plugin-models/server";
import { PlatformAuth, PlatformAuthProvider } from "./services/platform-auth-service.js";
import { ModelScopeAuth, ModelScopeAuthProvider } from "@penguinharness/plugin-models/server";
import { TraceIndexService } from "@penguinharness/plugin-usage/server";
import { TraceService } from "@penguinharness/plugin-usage/server";
import { WorkspaceFilesService } from "@penguinharness/plugin-projects/server";
import { RevealService } from "@penguinharness/plugin-projects/server";
import { ProjectAccess } from "@penguinharness/plugin-projects/server";
import { ProjectNotifier } from "@penguinharness/plugin-projects/server";
import {
  ProjectService,
  ProjectRuns,
  ShippedBuiltinBenchmarkSeeds,
} from "@penguinharness/plugin-projects/server";
import { AuthService, InitialProjectProvisioner } from "./auth/service.js";
import { AdminService } from "./services/admin-service.js";
import { Scheduler, ScheduleSessionCreator, ScheduleTaskRunner } from "./runtime/scheduler.js";
import { AgentConfigService } from "@penguinharness/plugin-agents/server";
import { SnapshotService } from "@penguinharness/plugin-projects/server";
import { AgentRoutes } from "@penguinharness/plugin-agents/server";
import { AgentService } from "@penguinharness/plugin-agents/server";
import { MemoryService } from "./services/memory-service.js";
import { BenchmarkService } from "@penguinharness/plugin-usage/server";
import { ProjectsRoutes } from "@penguinharness/plugin-projects/server";
import { SandboxModule } from "@penguinharness/plugin-sandbox/server";
import { SandboxSettings } from "@penguinharness/plugin-sandbox/server";
import { SandboxSettingsStatus } from "@penguinharness/plugin-sandbox/server";
import { SchedulerRoutes } from "@penguinharness/plugin-schedules/server";
import { Machines } from "@penguinharness/plugin-machines/server";
import { MachinesModule } from "@penguinharness/plugin-machines/server";
import { OrganizationModule, OrgScheduler, OrgService } from "@penguinharness/plugin-company/server";
import { OrgRoutes } from "@penguinharness/plugin-company/server";
import { OrgRuns, OrgSessions } from "@penguinharness/plugin-company/server";
import { TerminalRelay } from "@penguinharness/plugin-terminal/server";
import { SessionForwardRoutes } from "@penguinharness/plugin-machines/server";
import { HistoryLinesRoutes } from "./http/routes/history-lines.js";
import { HistoryRoutes } from "./http/routes/history.js";
import { ProjectAdminRoutes } from "@penguinharness/plugin-projects/server";
import { AdminRoutes } from "@penguinharness/plugin-settings/server";
import { MeRoutes } from "@penguinharness/plugin-settings/server";
import { AuthRoutes } from "./http/routes/auth.js";
import { RemoteRoutes } from "./http/routes/remote.js";
import {
  DesktopPrivacySettingsRoutes,
  DesktopRoutes,
  DesktopTrayRoutes,
  DesktopUpdateRoutes,
} from "./http/routes/desktop.js";
import { CommandRoutes } from "./http/routes/command.js";
import { InstallRoutes } from "@penguinharness/plugin-projects/server";
import { HandshakeRoutes } from "./http/routes/handshake.js";
import { HmrRoutes } from "./hmr/routes.js";
import { EventsRoutes } from "./http/routes/events.js";
import { PluginRegistryRoutes, PluginRoutes } from "./http/routes/plugins.js";
import { InstalledPluginRoutes } from "./http/routes/plugins-installed.js";
import { NpmPluginPackages } from "./plugin/install.js";
import { PluginLibraryModule } from "./plugin/library-module.js";
import { PluginUiRoutes } from "./http/routes/plugin-ui.js";
import { SuggestIdRoutes } from "./http/routes/suggest-id.js";
import { LanguageRoutes } from "./http/routes/languages.js";
import { Languages, LanguagesModule } from "./languages/service.js";
import { TerminalModule } from "@penguinharness/plugin-terminal/server";
import { SessionApiRoutes } from "@penguinharness/plugin-sessions/server";
import { Admin, Auth, AuthSessions, Users } from "@penguinharness/plugin-settings/server";
import {
  Access,
  AgentIndex,
  Members,
  ModelOAuth,
  ModelProviderAuthTokens,
  ProjectConfigStore,
  ProjectEvents,
  ProjectLifecycle,
  Projects,
} from "@penguinharness/plugin-projects/server";
import {
  AgentState,
  Schedules,
  SessionDrivers,
  SessionIndex,
  SessionOrigins,
} from "@penguinharness/plugin-sessions/server";
import { Workbenches } from "@penguinharness/plugin-workbenches/server";
import { WorkbenchService } from "@penguinharness/plugin-workbenches/server";
import { WorkbenchRoutes } from "@penguinharness/plugin-workbenches/server";
import { ThemeRoutes } from "./http/routes/themes.js";
import {
  ErrorLog,
  Errors,
  UsageQueries,
  UsageRecording,
  UsageStore,
} from "@penguinharness/plugin-usage/server";
import { TraceIndex, TraceIndexStore, Traces } from "@penguinharness/plugin-usage/server";
import { AgentConfig, AgentLifecycle, Benchmarks, Memory, Snapshots } from "@penguinharness/plugin-agents/server";
import { FileReveal, WorkspaceFiles } from "@penguinharness/plugin-projects/server";
import { Settings, UiPrefsStore } from "@penguinharness/plugin-settings/server";
import { BackgroundImageStore, UserDraftsStore } from "./mechanisms/account-data.js";
import { MessagingBindings } from "@penguinharness/plugin-messaging/server";
import { OrgCache } from "@penguinharness/plugin-company/server";
import { PreviewModule, PreviewTokens } from "./http/routes/preview.js";
import { Http, HttpModule } from "./http/app.js";
import { WebModule, WebShell } from "./http/routes/contributions.js";
import { BuiltinBrowserModule } from "@penguinharness/plugin-browser/server";
import { AgentApiModule } from "./amsp/module.js";
import { CompanyModule } from "@penguinharness/plugin-company/server";
import { OrgScheduler } from "@penguinharness/plugin-company/server";
import { Scheduling } from "@penguinharness/plugin-sessions/server";
import { Machines } from "@penguinharness/plugin-machines/server";


/**
 * The platform's module tree: the root module and its children, in one place.
 *
 * The root provides nothing and requires nothing itself; it exists so the children have a
 * scope to see each other in, and its create() — which runs LAST, after every child — does
 * the App-wide steps that need the whole tree up (the trace
 * adoption sweep, the machine sweeps). Everything else a module used to reach through
 * `AppDeps` it now names in its manifest.
 */

/**
 * The App-wide steps that need the whole business tree up, as a component of its own:
 * requiring what it sweeps puts it after those nodes in dependency order, and typed by
 * their classes — nothing reaches into a sibling by name.
 */
@Component()
export class Startup {
  @Use() private readonly scheduler!: Scheduling;
  @Use() private readonly orgScheduler!: OrgScheduler;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly machines!: Machines;
  @Use() private readonly errors!: Errors;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly agents!: AgentLifecycle;

  async setup() {
    // Every Project's config through the server's read path once, before anything opens one:
    // its one-time migrations (core's, and the server's own that need the catalog) write back
    // there, and a Session the schedulers resume reads its file with core's loader, which runs
    // only core's. A failure must not block the boot; each file is read again, and written
    // back, at its next read through the server. Goes with the migrations at 0.3.0.
    await this.projectConfig.migrateStoredConfigs().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "config_migration_failed" });
    });
    // Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic scan; and
    // company mode's scheduler, with the same lifetime and the same startup rule (reconcile
    // once, no backfill), only active while this App is. Neither first pass is on the boot
    // path: a pass can fire a missed slot, and a fire can reach the network (a model's
    // credential refresh) before it is queued — the port is announced and local pages are
    // served without waiting on it. Each pass still runs, here, as the platform comes up.
    void this.scheduler.start().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "scheduler_start_failed" });
    });
    void this.orgScheduler.start().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "org_scheduler_start_failed" });
    });
    // Startup adoption sweep: fold Trace-only Sessions into the index. Fire-and-forget —
    // a broken trace shard must not block the boot.
    void this.sessionService.adoptUnmanagedTraceSessions().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "trace_adoption_failed" });
    });
    // Deleted Agents whose files a stopped process had not finished removing: removed now, in
    // the background, the way the delete itself removes them.
    void this.agents.resumeDeletions().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "agent_purge_failed" });
    });
    // Machines, in one sweep (machines/service.ts start()): a push here is a push everywhere,
    // so this App booting hands the same build on to any machine still carrying a different
    // one, and then re-holds every connection the record says was held — the generation
    // before closed what it opened on its way out. Without this, every push and every
    // restart leaves each machine disconnected until someone connects it by hand.
    // Fire-and-forget for the same reason as the adoption sweep: a host that is slow to
    // answer must not hold up the App that serves everything else.
    void this.machines.start().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "machines_reconnect_failed" });
    });
  }
}

/**
 * The tree, grouped by mechanism. Each group is a @Module whose `exports` are the
 * interfaces its children offer the rest of the tree; everything else in a group — the
 * repos, the seams a test replaces, the route components — is visible only inside it.
 * A whole group is replaceable, and so is any node inside one.
 */
@Module({
  children: [
    RuntimeConfig,
    RuntimeDb,
    RuntimeChannels,
    RuntimeProxy,
    RuntimeHmr,
    RuntimeHmrControl,
    AppReassembly,
    RuntimeDesktop,
    RuntimeAuthState,
    RuntimeResourceGroups,
    ConsoleLog,
    SystemClock,
    ConfigPaths,
  ],
  exports: [
    Config,
    Db,
    Channels,
    Proxy,
    Hmr,
    HmrControl,
    Reassembly,
    Desktop,
    AuthState,
    ResourceGroups,
    Log,
    Clock,
    Paths,
  ],
})
export class RuntimeModule {}

@Module({
  children: [
    UsersRepo,
    AuthSessionsRepo,
    ScryptHasher,
    LiveStreamRegistry,
    AuthService,
    AdminService,
    AdminRoutes,
    MeRoutes,
    AuthRoutes,
    RemoteRoutes,
  ],
  exports: [Users, AuthSessions, Auth, Admin, PasswordHasher, LiveStreams],
})
export class IdentityModule {}

@Module({
  children: [
    ProjectsRepo,
    ModelPromotionsRepo,
    ModelProviderAuthTokensRepo,
    MembersRepo,
    AgentsRepo,
    ProjectAccess,
    ProjectNotifier,
    ShippedBuiltinBenchmarkSeeds,
    ProjectService,
    ProjectConfigService,
    ModelOAuthService,
    PlatformAuthProvider,
    ModelScopeAuthProvider,
    ProjectsRoutes,
    ProjectAdminRoutes,
  ],
  exports: [
    Projects,
    Members,
    AgentIndex,
    Access,
    ProjectLifecycle,
    ProjectConfigStore,
    ModelProviderAuthTokens,
    ModelOAuth,
    PlatformAuth,
    ModelScopeAuth,
    InitialProjectProvisioner,
    ProjectEvents,
  ],
})
export class ProjectsModule {}

@Module({
  children: [
    SessionsRepo,
    SessionSources,
    SessionDriverRegistry,
    AgentStateStore,
    SchedulesRepo,
    Scheduler,
    CoreSessionLoaders,
    DefaultTitleGenerators,
    SessionsModule,
    SessionApiRoutes,
    SchedulerRoutes,
    EventsRoutes,
  ],
  exports: [
    SessionIndex,
    SessionOrigins,
    SessionDrivers,
    AgentState,
    Schedules,
    Scheduling,
    Sessions,
    SessionServiceIface,
    SessionEnv,
    ScheduleTaskRunner,
    ScheduleSessionCreator,
    MessagingTaskRunner,
    OrgRuns,
    OrgSessions,
    ProjectRuns,
  ],
})
export class SessionRuntimeModule {}

@Module({
  children: [ServerSettingsRepo, UiPrefsRepo],
  exports: [Settings, UiPrefsStore],
})
export class SettingsModule {}

/**
 * What an account keeps on the server beside its preferences: unsent drafts and the custom
 * background image. A group of its own rather than part of the settings group, so a stand-in
 * for the settings store does not have to stand in for these too.
 */
@Module({
  children: [UserDraftsRepo, BackgroundImagesRepo],
  exports: [UserDraftsStore, BackgroundImageStore],
})
export class AccountDataModule {}

/**
 * Plugin configuration as a group of its own, beside the settings it is stored in: a plugin
 * that stands in for the settings group replaces the store, not the schema-and-watch layer
 * over it, and a plugin's manifest names this module as where `PluginConfig` comes from.
 */
@Module({
  children: [PluginConfigProvider, PluginConfigPage],
  exports: [PluginConfig, PluginConfigAdmin],
})
export class PluginConfigModule {}

/**
 * Sandbox settings as a group of their own: the sandbox service boots on the capability-free
 * floor, while its settings group and the node applying it need plugin configuration (and
 * through it the database), so they sit above it.
 */
@Module({
  children: [SandboxSettings, SandboxSettingsStatus],
  exports: [],
})
export class SandboxSettingsModule {}

@Module({
  children: [ErrorsRepo, ErrorRecorder, UsageRepo, UsageRecorder, UsageService],
  exports: [ErrorLog, Errors, UsageStore, UsageRecording, UsageQueries],
})
export class ObservabilityModule {}

@Module({
  children: [TraceIndexRepo, TraceIndexService, TraceService],
  exports: [TraceIndexStore, TraceIndex, Traces],
})
export class TracesModule {}

@Module({
  children: [
    AgentConfigService,
    SnapshotService,
    AgentService,
    MemoryService,
    BenchmarkService,
    AgentRoutes,
  ],
  exports: [AgentConfig, Snapshots, AgentLifecycle, Memory, Benchmarks],
})
export class AgentsModule {}

@Module({
  children: [WorkspaceFilesService, RevealService, PreviewModule],
  exports: [WorkspaceFiles, FileReveal, PreviewTokens],
})
export class WorkspaceModule {}

@Module({
  children: [
    FeishuSdkProvider,
    TelegramTransportProvider,
    QQTransportProvider,
    QQScanTransportProvider,
    WeChatTransportProvider,
    WeChatScanTransportProvider,
    DefaultMessagingTuning,
    MessagingBindingsRepo,
    MessagingConversationsRepo,
    MessagingModule,
    MessagingAccountsModule,
  ],
  exports: [Messaging, QQScan, MessagingBindings],
})
export class MessagingHubModule {}

/**
 * Company mode: the organization runtime, its routes and the caches they project into.
 * The caches are the group's own store — only the four members the session runtime and
 * Project deletion reach for leave the group, as OrgCache.
 */
@Module({
  children: [OrgCacheRepo, OrganizationModule, OrgRoutes],
  exports: [OrgCache, OrgService, OrgScheduler],
})
export class CompanyModule {}

@Module({
  children: [
    GlobalFetch,
    UpdateCheckService,
    UpdateJobService,
    HarnessHistoryStore,
    HttpModule,
    WebModule,
    InstallRoutes,
    HandshakeRoutes,
    VersionRoutes,
    HmrRoutes,
    DesktopRoutes,
    CommandRoutes,
    DesktopUpdateRoutes,
    DesktopTrayRoutes,
    DesktopPrivacySettingsRoutes,
    PluginRoutes,
    PluginRegistryRoutes,
    NpmPluginPackages,
    InstalledPluginRoutes,
    PluginCliCommandsProvider,
    PluginUiRoutes,
    SuggestIdRoutes,
    LanguagesModule,
    LanguageRoutes,
  ],
  exports: [Http, WebShell, UpdateCheck],
})
export class ApiModule {}

@Module({
  children: [WorkbenchService, WorkbenchRoutes],
  exports: [Workbenches],
})
export class WorkbenchesModule {}

/**
 * The server's theme packs: the store under the data root and the routes over it. Its own group:
 * nothing else reads the store, and a pack is a per-server web resource, not a plugin.
 */
@Module({
  children: [ThemeRoutes],
  exports: [],
})
export class ThemesModule {}

/** The root: provides nothing and requires nothing; it exists so the groups have a scope to see each other in. */
@Module({
  children: [
    RuntimeModule,
    SettingsModule,
    AccountDataModule,
    PluginConfigModule,
    IdentityModule,
    ProjectsModule,
    SessionRuntimeModule,
    ObservabilityModule,
    TracesModule,
    AgentsModule,
    WorkspaceModule,
    MessagingHubModule,
    CompanyModule,
    ApiModule,
    PluginLibraryModule,
    SandboxModule,
    SandboxSettingsModule,
    TerminalModule,
    MachinesModule,
    TerminalRelay,
    SessionForwardRoutes,
    HistoryRoutes,
    HistoryLinesRoutes,
    WorkbenchesModule,
    ThemesModule,
    BuiltinBrowserModule,
    AgentApiModule,
    Startup,
  ],
})
export class PlatformModule {}

/**
 * The platform tree as the booter takes it: the runtime nodes pre-built over the claimed
 * capabilities, the claim's replacements standing in for the nodes a test names, and
 * plugin modules appended under the root.
 */
export function platformDef(
  caps: HmrCapabilities,
  adoptable: (group: string) => boolean,
  plugins: ModuleDef[] = [],
  replace: ReadonlyMap<string, ModuleDef> = new Map(),
  /** The platform's own re-assembly (hmr/platform.ts); a test tree that never re-assembles writes the change and answers false. */
  reassemble: (change?: ReassemblyChange) => Promise<boolean> = async (change) => {
    await change?.write();
    return false;
  },
  /** Nodes the previous App hands over, booted as they are in place of fresh ones (hmr/platform.ts: the Agent state). */
  inherited: ReadonlyMap<ModuleClass, object> = new Map(),
): ModuleDef {
  const instances = new Map<ModuleClass, object>([
    [RuntimeConfig, new RuntimeConfig(caps)],
    [RuntimeDb, new RuntimeDb(caps)],
    [RuntimeChannels, new RuntimeChannels(caps)],
    [RuntimeProxy, new RuntimeProxy(caps)],
    [RuntimeHmr, new RuntimeHmr(caps)],
    [RuntimeHmrControl, new RuntimeHmrControl(caps)],
    [AppReassembly, new AppReassembly(reassemble)],
    [RuntimeDesktop, new RuntimeDesktop(caps)],
    [RuntimeAuthState, new RuntimeAuthState(caps)],
    [RuntimeResourceGroups, new RuntimeResourceGroups(adoptable)],
  ]);
  for (const [cls, instance] of inherited) instances.set(cls, instance);
  for (const [cls, instance] of caps.replacements) instances.set(cls, instance);
  return moduleDefOf(PlatformModule, {
    manifests: table.modules as ManifestTable,
    instances,
    extra: plugins,
    replace,
  });
}
