/**
 * The business surface — PLATFORM LAYER, hot-swappable as one unit.
 *
 * `buildBusinessDeps` assembles every business service over the capabilities the runtime
 * published (see ./capabilities.ts), and `createBusinessApp` mounts every business route
 * into a Hono app of its own. Both run inside `platformImpl.create` (platform.ts), so a
 * pushed bundle replaces the whole business surface — services, routes, scheduler — in
 * one swap, while the runtime keeps only mechanism (transport, auth, HMR, the registry).
 *
 * Swap semantics are the default for unparked state: HARD STOP. The scheduler stops, the
 * manager denies pending approvals and aborts active runs, and the next App rebuilds
 * everything from the claimed capabilities. Only resources that implement park/adopt
 * (terminals) ride across; nothing here does yet.
 *
 * The app declines to the runtime through the seam contract (`null`): its notFound
 * returns the marked response of ../hono-seam.ts, which seamHttp translates to null.
 */
import { Hono } from "hono";
import type { ProxyEnvPolicy } from "@prismshadow/penguin-core";
import { attributedProjectId } from "../http/attribution.js";
import type { AppDeps, BuildDepsOverrides } from "../app.js";
import type { RuntimeCapabilities } from "./capabilities.js";
import { declined } from "./hono-seam.js";
import { mergedNoProxy } from "../net/proxy.js";
import { AgentsRepo } from "../db/repos/agents.js";
import { AuthSessionsRepo } from "../db/repos/auth-sessions.js";
import { ErrorsRepo } from "../db/repos/errors.js";
import { MembersRepo } from "../db/repos/members.js";
import { ProjectsRepo } from "../db/repos/projects.js";
import { GoalsRepo } from "../db/repos/goals.js";
import { SchedulesRepo } from "../db/repos/schedules.js";
import { ServerSettingsRepo } from "../db/repos/server-settings.js";
import { SessionsRepo } from "../db/repos/sessions.js";
import { TraceIndexRepo } from "../db/repos/trace-index.js";
import { UiPrefsRepo } from "../db/repos/ui-prefs.js";
import { UsageRepo } from "../db/repos/usage.js";
import { UsersRepo } from "../db/repos/users.js";
import type { UserRow } from "../db/repos/users.js";
import { authMiddleware } from "../auth/middleware.js";
import type { AppEnv } from "../auth/middleware.js";
import { ADMIN_USER_ID } from "../auth/service.js";
import { clearInitialAdminPassword } from "../initial-password.js";
import { handleError, errorBody } from "../http/errors.js";
import { adminUsersRoutes } from "../http/routes/admin.js";
import { adminSettingsRoutes } from "../http/routes/admin-settings.js";
import { meRoutes } from "../http/routes/me.js";
import { eventsRoutes, userChannelKey } from "../http/routes/events.js";
import { projectsRoutes } from "../http/routes/projects.js";
import { membersRoutes } from "../http/routes/members.js";
import { modelsRoutes } from "../http/routes/models.js";
import { chatDefaultsRoutes } from "../http/routes/chat-defaults.js";
import { vaultRoutes } from "../http/routes/vault.js";
import { memoryRoutes } from "../http/routes/memory.js";
import { scheduleRoutes } from "../http/routes/schedules.js";
import { benchmarksRoutes } from "../http/routes/benchmarks.js";
import { agentSkillsRoutes, skillLibraryRoutes } from "../http/routes/skills.js";
import { agentTransferRoutes } from "../http/routes/agent-transfer.js";
import { agentsRoutes } from "../http/routes/agents.js";
import { dirsRoutes } from "../http/routes/dirs.js";
import { agentConfigRoutes } from "../http/routes/agent-config.js";
import { agentTracesRoutes } from "../http/routes/agent-traces.js";
import { usageRoutes } from "../http/routes/usage.js";
import { agentSessionsRoutes, sessionsRoutes } from "../http/routes/sessions.js";
import { versionRoutes } from "../http/routes/version.js";
import { ChannelHub } from "../runtime/channel.js";
import { ErrorRecorder } from "../runtime/error-recorder.js";
import { createCoreSessionLoader, SessionManager } from "../runtime/session-manager.js";
import { SessionSources } from "../runtime/session-sources.js";
import { Scheduler } from "../runtime/scheduler.js";
import { TitleGenerator } from "../runtime/title-generator.js";
import { UsageRecorder } from "../runtime/usage-recorder.js";
import { AdminService } from "../services/admin-service.js";
import { AgentConfigService } from "../services/agent-config-service.js";
import { MemoryService } from "../services/memory-service.js";
import { AgentService } from "../services/agent-service.js";
import { BenchmarkService } from "../services/benchmark-service.js";
import { SnapshotService } from "../services/snapshot-service.js";
import { ProjectConfigService } from "../services/project-config-service.js";
import { ProjectService } from "../services/project-service.js";
import { SessionService } from "../services/session-service.js";
import { TraceIndexService } from "../services/trace-index.js";
import { TraceService } from "../services/trace-service.js";
import { UpdateCheckService } from "../services/update-check-service.js";
import { UsageService } from "../services/usage-service.js";
import { WorkspaceFilesService } from "../services/workspace-files-service.js";
import { createPreviewTokenSigner } from "../services/preview-token.js";
import { previewRoutes } from "../http/routes/preview.js";

/**
 * Assembles the business service graph over the claimed runtime capabilities.
 *
 * The db handle, auth service, channel hub, config object and hmr host come from the
 * claim — one live instance per process, shared with the runtime. Everything else is
 * built fresh per App, which is exactly what makes it hot-swappable.
 */
export function buildBusinessDeps(
  caps: RuntimeCapabilities,
  overrides: BuildDepsOverrides = {},
): AppDeps {
  const { config, db, authService, channels, hmr } = caps;
  const log = overrides.log ?? ((line: string) => console.log(line));

  const usersRepo = new UsersRepo(db);
  const projectsRepo = new ProjectsRepo(db);
  const membersRepo = new MembersRepo(db);
  const agentsRepo = new AgentsRepo(db);
  const sessionsRepo = new SessionsRepo(db);
  const usageRepo = new UsageRepo(db);
  const errorsRepo = new ErrorsRepo(db);
  const prefsRepo = new UiPrefsRepo(db);
  const serverSettingsRepo = new ServerSettingsRepo(db);
  // Command-subprocess proxy policy for core, keyed on the
  // "agent environment uses the proxy" switch (the app switch only drives the server's
  // own dispatcher, see net/proxy.ts): switch off → strip HTTP(S)_PROXY/ALL_PROXY; on
  // with an explicit address → inject that address (with the merged loopback NO_PROXY)
  // over whatever the environment carries; on without an address → pass the environment
  // through. A getter, not a snapshot: it is re-read at every command spawn, so a
  // settings change reaches already-loaded Sessions. Threaded through BOTH core entry
  // paths — the loader (resume/self-heal) and SessionService (creation, whose runtime
  // the manager adopts for the first Task).
  const proxyEnv = (): ProxyEnvPolicy | null => {
    if (!serverSettingsRepo.getProxyForAgent()) return { mode: "strip" };
    const url = serverSettingsRepo.getProxyUrl();
    return url === null ? null : { mode: "inject", url, noProxy: mergedNoProxy() };
  };
  const schedulesRepo = new SchedulesRepo(db);
  const goalsRepo = new GoalsRepo(db);

  const projectConfigService = new ProjectConfigService(config.root);
  const agentConfigService = new AgentConfigService(config.root);
  const agentService = new AgentService(config.root, agentsRepo, agentConfigService);
  const memoryService = new MemoryService(config.root, agentConfigService);
  // Session-origin registry: session_meta is the single source of truth (no DB column);
  // shared by the manager (subagent registration), the loader (self-heal rebuild),
  // SessionService (creation / adoption / lazy list resolution), and the Trace index /
  // listing classification.
  const sessionSources = new SessionSources();
  // Trace-file index: the derived cache every trace listing/locating path serves from
  // (mtime-gated reconciler keeps it in step with the on-disk tree; see trace-index.ts).
  const traceIndexRepo = new TraceIndexRepo(db);
  const traceIndex = new TraceIndexService(config.root, traceIndexRepo, sessionSources);
  const traceService = new TraceService(config.root, {
    index: traceIndex,
    sessions: sessionsRepo,
    sources: sessionSources,
  });
  const workspaceFiles = new WorkspaceFilesService();
  // Per-process secret: preview tokens are short-lived, so losing them on restart is
  // harmless and there is nothing to persist or rotate. (Per-App is the same trade at a
  // smaller scale: a push invalidates open previews, and a preview is one reload away.)
  const previewTokens = createPreviewTokenSigner();
  const benchmarks = new BenchmarkService(config.root, workspaceFiles);
  const snapshots = new SnapshotService(config.root);
  const usageService = new UsageService(
    usageRepo,
    errorsRepo,
    (projectId, provider, modelId) => projectConfigService.getPricing(projectId, provider, modelId),
    overrides.now ?? (() => new Date()),
  );
  const updateCheck =
    overrides.updateCheck ?? new UpdateCheckService(overrides.now ? { now: overrides.now } : {});

  const recorder = new UsageRecorder(usageRepo, overrides.now ?? (() => new Date()));
  const errors = new ErrorRecorder(errorsRepo, overrides.now ?? (() => new Date()));
  const titles =
    overrides.titles ??
    new TitleGenerator({ sessions: sessionsRepo, channels, recorder, errors, log });
  const manager = new SessionManager({
    sessions: sessionsRepo,
    channels,
    loader: overrides.loader ?? createCoreSessionLoader(config.root, sessionSources, { proxyEnv }),
    sources: sessionSources,
    recorder,
    errors,
    titles,
    log,
    goals: goalsRepo,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  const projectService = new ProjectService({
    root: config.root,
    users: usersRepo,
    projects: projectsRepo,
    members: membersRepo,
    agents: agentsRepo,
    sessions: sessionsRepo,
    usage: usageRepo,
    errors: errorsRepo,
    schedules: schedulesRepo,
    goals: goalsRepo,
    projectConfig: projectConfigService,
    manager,
    traceIndex,
  });
  // Any password update for the built-in admin makes the persisted initial-password
  // plaintext stale (either the password is no longer initial, or a reset replaced it
  // with an admin-chosen value that is never persisted): drop the file so later startups
  // stop re-printing a credential that no longer signs in. (The runtime's AuthService
  // carries the same rule for the self-service path; this one covers admin resets.)
  const onPasswordChanged = (userId: string): void => {
    if (userId === ADMIN_USER_ID) clearInitialAdminPassword(config.root);
  };
  const adminService = new AdminService({
    users: usersRepo,
    authSessions: new AuthSessionsRepo(db),
    projects: projectsRepo,
    projectService,
    onPasswordChanged,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const sessionService = new SessionService({
    root: config.root,
    sessions: sessionsRepo,
    manager,
    projectConfig: projectConfigService,
    sources: sessionSources,
    traceIndex,
    proxyEnv,
  });
  // Schedule scheduler: assembled here, started by platform.ts's create() (tests drive it
  // via tickOnce, no real timer), stopped by the same create()'s dispose effect.
  const scheduler = new Scheduler({
    root: config.root,
    repo: schedulesRepo,
    projects: projectsRepo,
    sessions: sessionsRepo,
    runner: manager,
    sessionCreator: sessionService,
    projectConfig: projectConfigService,
    errors,
    notify: (userId, event) => {
      channels.get(userChannelKey(userId)).publish(event, "server_event");
    },
    ...(overrides.now ? { now: () => overrides.now!().getTime() } : {}),
  });

  return {
    config,
    db,
    sessionsRepo,
    prefsRepo,
    serverSettingsRepo,
    authService,
    adminService,
    projectService,
    projectConfigService,
    agentService,
    agentConfigService,
    memoryService,
    sessionService,
    traceService,
    traceIndex,
    usageService,
    updateCheck,
    workspaceFiles,
    previewTokens,
    benchmarks,
    snapshots,
    schedulesRepo,
    goalsRepo,
    errorsRepo,
    scheduler,
    channels,
    manager,
    sessionSources,
    errors,
    desktop: caps.desktop,
    hmr,
    proxyControl: caps.proxyControl,
    log,
  };
}

/** Prefixes the runtime serves itself; the business app declines them unconditionally. */
const RUNTIME_PREFIXES = ["/api/auth", "/api/desktop", "/api/hmr"];

/** Assembles the business Hono app (routes + auth + error shaping; no listening, no logging). */
export function createBusinessApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Error recording is layered in a lambda wrapping onError: handleError stays a
  // pure function with unchanged behavior (HttpError is mapped as-is, unknown
  // exceptions are logged with a stack trace and collapsed to 500), and recording
  // to the DB is just a side-effect layered on top.
  app.onError((err, c) => {
    const projectId = attributedProjectId(c, deps);
    deps.errors.record({
      source: "http",
      err,
      ...(projectId !== undefined ? { ctx: { projectId } } : {}),
    });
    return handleError(err, c);
  });
  app.notFound(() => declined());

  // Runtime-owned prefixes decline before anything else runs — in particular before the
  // auth gate below, which would otherwise 401 an unauthenticated /api/auth/login instead
  // of letting the runtime's own public route serve it.
  app.use("*", async (c, next) => {
    if (RUNTIME_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
      return declined();
    }
    await next();
  });

  // Protected routes: cookie -> auth_session -> user, over the runtime's auth service.
  app.use("/api/*", authMiddleware(deps.authService));
  app.route("/api/me", meRoutes(deps));
  app.route("/api/version", versionRoutes(deps));
  app.route("/api/admin/users", adminUsersRoutes(deps));
  app.route("/api/admin/settings", adminSettingsRoutes(deps));
  app.route("/api/events", eventsRoutes(deps));
  // Skill library listing: readable once logged in, not nested under a Project prefix.
  app.route("/api/skills", skillLibraryRoutes());
  app.route("/api/projects", projectsRoutes(deps));
  app.route("/api/projects/:projectId/members", membersRoutes(deps));
  app.route("/api/projects/:projectId/models", modelsRoutes(deps));
  app.route("/api/projects/:projectId/chat-defaults", chatDefaultsRoutes(deps));
  app.route("/api/projects/:projectId/agents", agentsRoutes(deps));
  app.route("/api/projects/:projectId/dirs", dirsRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/config", agentConfigRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/vault", vaultRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/memory", memoryRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/schedules", scheduleRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/benchmarks", benchmarksRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/skills", agentSkillsRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId", agentTransferRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/traces", agentTracesRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/sessions", agentSessionsRoutes(deps));
  app.route("/api/projects/:projectId/usage", usageRoutes(deps));
  app.route("/api/sessions", sessionsRoutes(deps));

  // Workspace HTML preview on the separate preview origin: deliberately outside /api and
  // outside the auth middleware — that origin never receives the session cookie, so the
  // signed token in the path is the only credential.
  app.route("/preview", previewRoutes(deps));

  // An unknown /api path a logged-in caller reaches falls to notFound → decline → the
  // runtime answers its own 404; unauthenticated callers are already 401'd above, which
  // is the same shape the one-app assembly produced.
  return app;
}
