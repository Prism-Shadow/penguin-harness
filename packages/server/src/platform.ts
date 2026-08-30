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
} from "./hmr/capabilities.js";
import { ScryptHasher } from "./auth/password.js";
import { DefaultMessagingTuning } from "./runtime/messaging/bridge.js";
import { FeishuSdkProvider } from "./runtime/messaging/feishu-connector.js";
import { TelegramTransportProvider } from "./runtime/messaging/telegram-connector.js";
import { QQTransportProvider } from "./runtime/messaging/qq-connector.js";
import { QQScanTransportProvider } from "./runtime/messaging/qq-scan.js";
import { WeChatTransportProvider } from "./runtime/messaging/wechat-connector.js";
import { WeChatScanTransportProvider } from "./runtime/messaging/wechat-scan.js";
import { UpdateJobService } from "./services/update-job.js";
import { CoreSessionLoaders, DefaultTitleGenerators } from "./runtime/session-manager.js";
import { GlobalFetch, UpdateCheckService } from "./services/update-check-service.js";
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
import { ProjectService } from "./services/project-service.js";
import { AuthService } from "./auth/service.js";
import { AdminService } from "./services/admin-service.js";
import { Scheduler } from "./runtime/scheduler.js";
import { AgentConfigService } from "./services/agent-config-service.js";
import { SnapshotService } from "./services/snapshot-service.js";
import { AgentService } from "./services/agent-service.js";
import { MemoryService } from "./services/memory-service.js";
import { BenchmarkService } from "./services/benchmark-service.js";
import { ProjectsRoutes } from "./http/routes/dirs.js";
import { WorkspaceModule } from "./http/routes/preview.js";
import { SandboxModule } from "./sandbox/service.js";
import { HostAssembly } from "./services/host-assembly.js";
import { SessionServiceIface, SessionsModule } from "./runtime/session-manager.js";
import { SchedulerRoutes } from "./http/routes/schedules.js";
import { MessagingModule } from "./runtime/messaging/bridge.js";
import { MachinesModule } from "./machines/service.js";
import { ProjectAdminRoutes } from "./http/routes/projects.js";
import { AdminRoutes } from "./http/routes/admin.js";
import { MeRoutes } from "./http/routes/me.js";
import { VersionRoutes } from "./services/update-check-service.js";
import { InstallRoutes } from "./http/routes/install.js";
import { EventsRoutes } from "./http/routes/events.js";
import { PluginRoutes } from "./http/routes/plugins.js";
import { TerminalModule } from "./terminal/manager.js";
import { SessionApiRoutes } from "./http/routes/sessions.js";
import { HttpModule } from "./http/app.js";
import { WebModule } from "./http/routes/contributions.js";
import type { Scheduling } from "./mechanisms/sessions.js";
import type { Errors } from "./mechanisms/observability.js";

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
  @Use(SessionsModule) private readonly sessionService!: SessionServiceIface;
  @Use() private readonly errors!: Errors;

  async setup() {
    // Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic scan.
    await this.scheduler.start();
    // Startup adoption sweep: fold Trace-only Sessions into the index. Fire-and-forget —
    // a broken trace shard must not block the boot.
    void this.sessionService.adoptUnmanagedTraceSessions().catch((err: unknown) => {
      this.errors.record({ source: "process", err, code: "trace_adoption_failed" });
    });
  }
}

/** The root: provides nothing and requires nothing; it exists so the children have a scope to see each other in. */
@Module({
  children: [
    // Runtime capabilities, one node each
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
    // Mechanisms a test stands in for
    ScryptHasher,
    DefaultMessagingTuning,
    FeishuSdkProvider,
    TelegramTransportProvider,
    QQTransportProvider,
    QQScanTransportProvider,
    WeChatTransportProvider,
    WeChatScanTransportProvider,
    CoreSessionLoaders,
    DefaultTitleGenerators,
    GlobalFetch,
    UpdateCheckService,
    UpdateJobService,
    // Stores
    UsersRepo,
    AuthSessionsRepo,
    ServerSettingsRepo,
    UiPrefsRepo,
    SessionsRepo,
    ProjectsRepo,
    MembersRepo,
    AgentsRepo,
    UsageRepo,
    SchedulesRepo,
    TraceIndexRepo,
    MessagingBindingsRepo,
    ErrorsRepo,
    SessionSources,
    // Services
    ErrorRecorder,
    UsageRecorder,
    UsageService,
    ProjectConfigService,
    ModelOAuthService,
    TraceIndexService,
    TraceService,
    WorkspaceFilesService,
    ProjectAccess,
    ProjectService,
    AuthService,
    AdminService,
    Scheduler,
    AgentConfigService,
    SnapshotService,
    AgentService,
    MemoryService,
    BenchmarkService,
    HostAssembly,
    // Runtimes and route groups
    WorkspaceModule,
    SandboxModule,
    SessionsModule,
    MessagingModule,
    MachinesModule,
    ProjectsRoutes,
    SchedulerRoutes,
    ProjectAdminRoutes,
    AdminRoutes,
    MeRoutes,
    VersionRoutes,
    InstallRoutes,
    EventsRoutes,
    PluginRoutes,
    TerminalModule,
    SessionApiRoutes,
    WebModule,
    HttpModule,
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
): ModuleDef {
  const instances = new Map<ModuleClass, object>([
    [RuntimeConfig, new RuntimeConfig(caps)],
    [RuntimeDb, new RuntimeDb(caps)],
    [RuntimeChannels, new RuntimeChannels(caps)],
    [RuntimeProxy, new RuntimeProxy(caps)],
    [RuntimeHmr, new RuntimeHmr(caps)],
    [RuntimeDesktop, new RuntimeDesktop(caps)],
    [RuntimeAuthState, new RuntimeAuthState(caps)],
    [RuntimeResourceGroups, new RuntimeResourceGroups(adoptable)],
  ]);
  for (const [cls, instance] of caps.replacements) instances.set(cls, instance);
  return moduleDefOf(PlatformModule, {
    manifests: table.modules as ManifestTable,
    instances,
    extra: plugins,
  });
}
