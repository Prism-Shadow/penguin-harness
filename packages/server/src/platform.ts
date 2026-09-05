import { Component, Module, moduleDefOf, Use } from "@prismshadow/penguin-core/kernel";
import type { ManifestTable, ModuleClass, ModuleDef } from "@prismshadow/penguin-core/kernel";
import table from "./ifaces.json" with { type: "json" };
import type { RuntimeCapabilities } from "./hmr/capabilities.js";
import {
  ConfigPaths,
  ConsoleLog,
  RuntimeAuthState,
  RuntimeChannels,
  RuntimeLifecycle,
  RuntimeConfig,
  RuntimeDb,
  RuntimeDesktop,
  RuntimeHmr,
  RuntimeProxy,
  RuntimeResourceGroups,
  SystemClock,
  AuthState,
  Channels,
  Clock,
  Config,
  Db,
  Desktop,
  Lifecycle,
  Hmr,
  Log,
  Paths,
  Proxy,
  ResourceGroups,
} from "./hmr/capabilities.js";
import { ScryptHasher, PasswordHasher } from "./auth/password.js";
import {
  DefaultMessagingTuning,
  Messaging,
  MessagingTaskRunner,
  MessagingModule,
  QQScan,
} from "./runtime/messaging/bridge.js";
import { FeishuSdkProvider } from "./runtime/messaging/feishu-connector.js";
import { TelegramTransportProvider } from "./runtime/messaging/telegram-connector.js";
import { QQTransportProvider } from "./runtime/messaging/qq-connector.js";
import { QQScanTransportProvider } from "./runtime/messaging/qq-scan.js";
import { WeChatTransportProvider } from "./runtime/messaging/wechat-connector.js";
import { WeChatScanTransportProvider } from "./runtime/messaging/wechat-scan.js";
import {
  CoreSessionLoaders,
  DefaultTitleGenerators,
  SessionsModule,
  SessionEnv,
  Sessions,
  SessionServiceIface,
} from "./runtime/session-manager.js";
import {
  GlobalFetch,
  HttpFetch,
  UpdateCheckService,
  VersionRoutes,
  UpdateCheck,
} from "./services/update-check-service.js";
import { UpdateJobService } from "./services/update-job.js";
import { HarnessHistoryStore } from "./services/harness-history.js";
import { UsersRepo } from "./db/repos/users.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { ServerSettingsRepo } from "./db/repos/server-settings.js";
import { UiPrefsRepo } from "./db/repos/ui-prefs.js";
import { SessionsRepo } from "./db/repos/sessions.js";
import { ProjectsRepo } from "./db/repos/projects.js";
import { MembersRepo } from "./db/repos/members.js";
import { AgentsRepo } from "./db/repos/agents.js";
import { UsageRepo } from "./db/repos/usage.js";
import { SchedulesRepo } from "./db/repos/schedules.js";
import { TraceIndexRepo } from "./db/repos/trace-index.js";
import { MessagingBindingsRepo } from "./db/repos/messaging-bindings.js";
import { ErrorsRepo } from "./db/repos/errors.js";
import { SessionSources } from "./runtime/session-sources.js";
import { ErrorRecorder } from "./runtime/error-recorder.js";
import { UsageRecorder } from "./runtime/usage-recorder.js";
import { UsageService } from "./services/usage-service.js";
import { ProjectConfigService } from "./services/project-config-service.js";
import { ModelOAuthService } from "./services/model-oauth-service.js";
import { TraceIndexService } from "./services/trace-index.js";
import { TraceService } from "./services/trace-service.js";
import { WorkspaceFilesService } from "./services/workspace-files-service.js";
import { ProjectAccess } from "./services/project-access.js";
import { ProjectNotifier } from "./services/project-events.js";
import { ProjectService, ProjectRuns } from "./services/project-service.js";
import { AuthService, InitialProjectProvisioner } from "./auth/service.js";
import { AdminService } from "./services/admin-service.js";
import { Scheduler, ScheduleSessionCreator, ScheduleTaskRunner } from "./runtime/scheduler.js";
import { AgentConfigService } from "./services/agent-config-service.js";
import { SnapshotService } from "./services/snapshot-service.js";
import { AgentService } from "./services/agent-service.js";
import { MemoryService } from "./services/memory-service.js";
import { BenchmarkService } from "./services/benchmark-service.js";
import { ProjectsRoutes } from "./http/routes/dirs.js";
import { SandboxModule } from "./sandbox/service.js";
import { HostAssembly } from "./services/host-assembly.js";
import { SchedulerRoutes } from "./http/routes/schedules.js";
import { Machines, MachinesModule } from "./machines/service.js";
import { TerminalRelay } from "./machines/terminal-relay.js";
import { ProjectAdminRoutes } from "./http/routes/projects.js";
import { AdminRoutes } from "./http/routes/admin.js";
import { MeRoutes } from "./http/routes/me.js";
import { InstallRoutes } from "./http/routes/install.js";
import { EventsRoutes } from "./http/routes/events.js";
import { PluginRegistryRoutes, PluginRoutes } from "./http/routes/plugins.js";
import { InstalledPluginRoutes } from "./http/routes/plugins-installed.js";
import { AdminSandboxRoutes } from "./http/routes/admin-sandbox.js";
import { LanguageRoutes } from "./http/routes/languages.js";
import { Languages, LanguagesModule } from "./languages/service.js";
import { TerminalModule } from "./terminal/manager.js";
import { SessionApiRoutes } from "./http/routes/sessions.js";
import { Admin, Auth, AuthSessions, Users } from "./mechanisms/identity.js";
import {
  Access,
  AgentIndex,
  Members,
  ModelOAuth,
  ProjectConfigStore,
  ProjectEvents,
  ProjectLifecycle,
  Projects,
} from "./mechanisms/projects.js";
import { Schedules, Scheduling, SessionIndex, SessionOrigins } from "./mechanisms/sessions.js";
import { Workflows } from "./mechanisms/workflows.js";
import { WorkflowService } from "./workflows/service.js";
import { WorkflowPrompt, WorkflowRoutes } from "./workflows/routes.js";
import { AgentPackages } from "./mechanisms/packages.js";
import { AgentPackageService } from "./packages/service.js";
import { PackageRoutes } from "./packages/routes.js";
import { GhCliRunner } from "./packages/gh.js";
import {
  ErrorLog,
  Errors,
  UsageQueries,
  UsageRecording,
  UsageStore,
} from "./mechanisms/observability.js";
import { TraceIndex, TraceIndexStore, Traces } from "./mechanisms/traces.js";
import {
  AgentConfig,
  AgentLifecycle,
  Assembly,
  Benchmarks,
  Memory,
  Snapshots,
} from "./mechanisms/agents.js";
import { WorkspaceFiles } from "./mechanisms/workspace.js";
import { Settings, UiPrefsStore } from "./mechanisms/settings.js";
import { MessagingBindings } from "./mechanisms/messaging.js";
import { PreviewModule, PreviewTokens } from "./http/routes/preview.js";
import { Http, HttpModule } from "./http/app.js";
import { WebModule, WebShell } from "./http/routes/contributions.js";

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
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly machines!: Machines;
  @Use() private readonly errors!: Errors;

  async setup() {
    // Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic scan.
    await this.scheduler.start();
    // Startup adoption sweep: fold Trace-only Sessions into the index. Fire-and-forget —
    // a broken trace shard must not block the boot.
    void this.sessionService.adoptUnmanagedTraceSessions().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "trace_adoption_failed" });
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
    RuntimeDesktop,
    RuntimeAuthState,
    RuntimeLifecycle,
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
    Desktop,
    AuthState,
    Lifecycle,
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
    AuthService,
    AdminService,
    AdminRoutes,
    MeRoutes,
  ],
  exports: [Users, AuthSessions, Auth, Admin, PasswordHasher],
})
export class IdentityModule {}

@Module({
  children: [
    ProjectsRepo,
    MembersRepo,
    AgentsRepo,
    ProjectAccess,
    ProjectNotifier,
    ProjectService,
    ProjectConfigService,
    ModelOAuthService,
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
    ModelOAuth,
    InitialProjectProvisioner,
    ProjectEvents,
  ],
})
export class ProjectsModule {}

@Module({
  children: [
    SessionsRepo,
    SessionSources,
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
    Schedules,
    Scheduling,
    Sessions,
    SessionServiceIface,
    SessionEnv,
    ScheduleTaskRunner,
    ScheduleSessionCreator,
    MessagingTaskRunner,
    ProjectRuns,
  ],
})
export class SessionRuntimeModule {}

@Module({
  children: [ServerSettingsRepo, UiPrefsRepo],
  exports: [Settings, UiPrefsStore],
})
export class SettingsModule {}

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
    HostAssembly,
  ],
  exports: [AgentConfig, Snapshots, AgentLifecycle, Memory, Benchmarks, Assembly],
})
export class AgentsModule {}

@Module({
  children: [WorkspaceFilesService, PreviewModule],
  exports: [WorkspaceFiles, PreviewTokens],
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
    MessagingModule,
  ],
  exports: [Messaging, QQScan, MessagingBindings],
})
export class MessagingHubModule {}

@Module({
  children: [
    GlobalFetch,
    UpdateCheckService,
    UpdateJobService,
    HarnessHistoryStore,
    HttpModule,
    WebModule,
    InstallRoutes,
    VersionRoutes,
    PluginRoutes,
    PluginRegistryRoutes,
    InstalledPluginRoutes,
    AdminSandboxRoutes,
    LanguagesModule,
    LanguageRoutes,
  ],
  exports: [Http, WebShell, UpdateCheck, HttpFetch],
})
export class ApiModule {}

@Module({
  children: [WorkflowPrompt, WorkflowService, WorkflowRoutes],
  exports: [Workflows],
})
export class WorkflowsModule {}

@Module({
  children: [GhCliRunner, AgentPackageService, PackageRoutes],
  exports: [AgentPackages],
})
export class PackagesModule {}

/** The root: provides nothing and requires nothing; it exists so the groups have a scope to see each other in. */
@Module({
  children: [
    RuntimeModule,
    SettingsModule,
    IdentityModule,
    ProjectsModule,
    SessionRuntimeModule,
    ObservabilityModule,
    TracesModule,
    AgentsModule,
    WorkspaceModule,
    MessagingHubModule,
    ApiModule,
    SandboxModule,
    TerminalModule,
    MachinesModule,
    TerminalRelay,
    WorkflowsModule,
    PackagesModule,
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
  caps: RuntimeCapabilities,
  adoptable: (group: string) => boolean,
  plugins: ModuleDef[] = [],
  replace: ReadonlyMap<string, ModuleDef> = new Map(),
): ModuleDef {
  const instances = new Map<ModuleClass, object>([
    [RuntimeConfig, new RuntimeConfig(caps)],
    [RuntimeDb, new RuntimeDb(caps)],
    [RuntimeChannels, new RuntimeChannels(caps)],
    [RuntimeProxy, new RuntimeProxy(caps)],
    [RuntimeHmr, new RuntimeHmr(caps)],
    [RuntimeDesktop, new RuntimeDesktop(caps)],
    [RuntimeAuthState, new RuntimeAuthState(caps)],
    [RuntimeLifecycle, new RuntimeLifecycle(caps)],
    [RuntimeResourceGroups, new RuntimeResourceGroups(adoptable)],
  ]);
  for (const [cls, instance] of caps.replacements) instances.set(cls, instance);
  return moduleDefOf(PlatformModule, {
    manifests: table.modules as ManifestTable,
    instances,
    extra: plugins,
    replace,
  });
}
