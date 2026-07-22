/**
 * Hono app assembly: middleware + route mounting + static hosting +
 * error handling.
 *
 * `createApp(deps)` is pure assembly (does not listen on a port): tests inject requests via
 * `app.request()`; `buildAppDeps(config)` assembles all services from config (test doubles
 * like SessionLoader can be injected). The startup entry point is in index.ts.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { ServerConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { AgentsRepo } from "./db/repos/agents.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { ErrorsRepo } from "./db/repos/errors.js";
import { MembersRepo } from "./db/repos/members.js";
import { ProjectsRepo } from "./db/repos/projects.js";
import { SchedulesRepo } from "./db/repos/schedules.js";
import { SessionsRepo } from "./db/repos/sessions.js";
import { UiPrefsRepo } from "./db/repos/ui-prefs.js";
import { UsageRepo } from "./db/repos/usage.js";
import { UsersRepo } from "./db/repos/users.js";
import type { UserRow } from "./db/repos/users.js";
import { authMiddleware, jsonOnlyWrites } from "./auth/middleware.js";
import type { AppEnv } from "./auth/middleware.js";
import { AuthService } from "./auth/service.js";
import { handleError, HttpError, errorBody } from "./http/errors.js";
import { adminUsersRoutes } from "./http/routes/admin.js";
import { authRoutes } from "./http/routes/auth.js";
import { meRoutes } from "./http/routes/me.js";
import { eventsRoutes, userChannelKey } from "./http/routes/events.js";
import { projectsRoutes } from "./http/routes/projects.js";
import { membersRoutes } from "./http/routes/members.js";
import { modelsRoutes } from "./http/routes/models.js";
import { vaultRoutes } from "./http/routes/vault.js";
import { scheduleRoutes } from "./http/routes/schedules.js";
import { benchmarksRoutes } from "./http/routes/benchmarks.js";
import { agentSkillsRoutes, skillLibraryRoutes } from "./http/routes/skills.js";
import { agentTransferRoutes } from "./http/routes/agent-transfer.js";
import { agentsRoutes } from "./http/routes/agents.js";
import { dirsRoutes } from "./http/routes/dirs.js";
import { agentConfigRoutes } from "./http/routes/agent-config.js";
import { agentTracesRoutes } from "./http/routes/agent-traces.js";
import { usageRoutes } from "./http/routes/usage.js";
import { agentSessionsRoutes, sessionsRoutes } from "./http/routes/sessions.js";
import { ChannelHub } from "./runtime/channel.js";
import { ErrorRecorder } from "./runtime/error-recorder.js";
import { createCoreSessionLoader, SessionManager } from "./runtime/session-manager.js";
import { SessionSources } from "./runtime/session-sources.js";
import type { SessionLoader } from "./runtime/session-manager.js";
import { Scheduler } from "./runtime/scheduler.js";
import { TitleGenerator } from "./runtime/title-generator.js";
import type { TitleNotifier } from "./runtime/title-generator.js";
import { UsageRecorder } from "./runtime/usage-recorder.js";
import { AdminService } from "./services/admin-service.js";
import { AgentConfigService } from "./services/agent-config-service.js";
import { AgentService } from "./services/agent-service.js";
import { BenchmarkService } from "./services/benchmark-service.js";
import { SnapshotService } from "./services/snapshot-service.js";
import { ProjectConfigService } from "./services/project-config-service.js";
import { ProjectService } from "./services/project-service.js";
import { SessionService } from "./services/session-service.js";
import { TraceService } from "./services/trace-service.js";
import { UsageService } from "./services/usage-service.js";
import { WorkspaceFilesService } from "./services/workspace-files-service.js";
import { createPreviewTokenSigner } from "./services/preview-token.js";
import type { PreviewTokenSigner } from "./services/preview-token.js";
import { previewRoutes } from "./http/routes/preview.js";

/** Request body size limit (tasks may carry data: images): 20MB. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

export interface AppDeps {
  config: ServerConfig;
  db: DatabaseSync;
  sessionsRepo: SessionsRepo;
  prefsRepo: UiPrefsRepo;
  authService: AuthService;
  adminService: AdminService;
  projectService: ProjectService;
  projectConfigService: ProjectConfigService;
  agentService: AgentService;
  agentConfigService: AgentConfigService;
  sessionService: SessionService;
  traceService: TraceService;
  usageService: UsageService;
  workspaceFiles: WorkspaceFilesService;
  /** Signs/verifies short-lived Workspace preview tokens (separate preview origin). */
  previewTokens: PreviewTokenSigner;
  benchmarks: BenchmarkService;
  snapshots: SnapshotService;
  schedulesRepo: SchedulesRepo;
  scheduler: Scheduler;
  channels: ChannelHub;
  manager: SessionManager;
  /** Session-origin registry derived from session_meta (single source of truth; no DB column). */
  sessionSources: SessionSources;
  /** Error persistence (shared by app.onError and various background capture points; the process-level fallback is in index.ts). */
  errors: ErrorRecorder;
  /** Request log output (minimal one-liner); tests inject a noop. */
  log: (line: string) => void;
}

export interface BuildDepsOverrides {
  /** Test double: session-manager's underlying loader (avoids the real LLM/SDK path). */
  loader?: SessionLoader;
  /** Test double: Session title generator (avoids real LLM requests). */
  titles?: TitleNotifier;
  log?: (line: string) => void;
  now?: () => Date;
}

/** Assemble all services from config (shared by production and tests; tests pass dbPath=":memory:" and a temp root). */
export function buildAppDeps(config: ServerConfig, overrides: BuildDepsOverrides = {}): AppDeps {
  const db = openDatabase(config.dbPath);
  const log = overrides.log ?? ((line: string) => console.log(line));

  const usersRepo = new UsersRepo(db);
  const authSessionsRepo = new AuthSessionsRepo(db);
  const projectsRepo = new ProjectsRepo(db);
  const membersRepo = new MembersRepo(db);
  const agentsRepo = new AgentsRepo(db);
  const sessionsRepo = new SessionsRepo(db);
  const usageRepo = new UsageRepo(db);
  const errorsRepo = new ErrorsRepo(db);
  const prefsRepo = new UiPrefsRepo(db);
  const schedulesRepo = new SchedulesRepo(db);

  const projectConfigService = new ProjectConfigService(config.root);
  const agentConfigService = new AgentConfigService(config.root);
  const agentService = new AgentService(config.root, agentsRepo, agentConfigService);
  const traceService = new TraceService(config.root);
  const workspaceFiles = new WorkspaceFilesService();
  // Per-process secret: preview tokens are short-lived, so losing them on restart is
  // harmless and there is nothing to persist or rotate.
  const previewTokens = createPreviewTokenSigner();
  const benchmarks = new BenchmarkService(config.root);
  const snapshots = new SnapshotService(config.root);
  const usageService = new UsageService(
    usageRepo,
    errorsRepo,
    (projectId, provider, modelId) => projectConfigService.getPricing(projectId, provider, modelId),
    overrides.now ?? (() => new Date()),
  );

  // Channel idle reclamation skips active Sessions (running/compacting can go a long time
  // without a publish, e.g. while waiting for approval).
  // manager is created after channels: use a lazy predicate (managerRef is assigned by the
  // time the sweep timer fires).
  let managerRef: SessionManager | undefined;
  const channels = new ChannelHub({
    isActive: (key) => managerRef !== undefined && managerRef.statusOf(key) !== "idle",
  });
  const recorder = new UsageRecorder(usageRepo, overrides.now ?? (() => new Date()));
  const errors = new ErrorRecorder(errorsRepo, overrides.now ?? (() => new Date()));
  const titles =
    overrides.titles ??
    new TitleGenerator({ sessions: sessionsRepo, channels, recorder, errors, log });
  // Session-origin registry: session_meta is the single source of truth (no DB column);
  // shared by the manager (subagent registration), the loader (self-heal rebuild) and
  // SessionService (creation / adoption / lazy list resolution).
  const sessionSources = new SessionSources();
  const manager = new SessionManager({
    sessions: sessionsRepo,
    channels,
    loader: overrides.loader ?? createCoreSessionLoader(config.root, sessionSources),
    sources: sessionSources,
    recorder,
    errors,
    titles,
    log,
  });
  managerRef = manager;

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
    projectConfig: projectConfigService,
    manager,
  });
  const authService = new AuthService({
    users: usersRepo,
    authSessions: authSessionsRepo,
    provisionInitialProject: (user, isAdmin) =>
      projectService.provisionInitialProject(user, isAdmin),
    sessionTtlMs: config.authSessionTtlMs,
    sessionRenewMs: config.authSessionRenewMs,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const adminService = new AdminService({
    users: usersRepo,
    authSessions: authSessionsRepo,
    projects: projectsRepo,
    projectService,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const sessionService = new SessionService({
    root: config.root,
    sessions: sessionsRepo,
    manager,
    projectConfig: projectConfigService,
    sources: sessionSources,
  });
  // Schedule scheduler: active only while the server is running. Only
  // assembled here; start() is called in index.ts (tests drive it via tickOnce, no real timer).
  const scheduler = new Scheduler({
    root: config.root,
    repo: schedulesRepo,
    projects: projectsRepo,
    sessions: sessionsRepo,
    runner: manager,
    sessionCreator: sessionService,
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
    authService,
    adminService,
    projectService,
    projectConfigService,
    agentService,
    agentConfigService,
    sessionService,
    traceService,
    usageService,
    workspaceFiles,
    previewTokens,
    benchmarks,
    snapshots,
    schedulesRepo,
    scheduler,
    channels,
    manager,
    sessionSources,
    errors,
    log,
  };
}

/** Assembles the Hono app (does not listen on a port). */
export function createApp(deps: AppDeps): Hono<AppEnv> {
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
  app.notFound((c) => c.json(errorBody("not_found", "Endpoint does not exist."), 404));

  // Request logging: a minimal one-liner (method path status ms).
  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    deps.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
  });

  // API common defenses: request body size cap (20MB) and write-request Content-Type (one of the CSRF MVP defenses).
  app.use("/api/*", async (c, next) => {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "payload_too_large", "Request body exceeds the 20MB limit.");
    }
    await next();
  });
  app.use("/api/*", jsonOnlyWrites);

  // Public routes (no login required).
  app.route("/api/auth", authRoutes(deps));

  // Protected routes: cookie -> auth_session -> user.
  const auth = authMiddleware(deps.authService);
  app.use("/api/*", auth);
  app.route("/api/me", meRoutes(deps));
  app.route("/api/admin/users", adminUsersRoutes(deps));
  app.route("/api/events", eventsRoutes(deps));
  // Skill library listing: readable once logged in, not nested under a Project prefix.
  app.route("/api/skills", skillLibraryRoutes());
  app.route("/api/projects", projectsRoutes(deps));
  app.route("/api/projects/:projectId/members", membersRoutes(deps));
  app.route("/api/projects/:projectId/models", modelsRoutes(deps));
  app.route("/api/projects/:projectId/agents", agentsRoutes(deps));
  app.route("/api/projects/:projectId/dirs", dirsRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/config", agentConfigRoutes(deps));
  app.route("/api/projects/:projectId/agents/:agentId/vault", vaultRoutes(deps));
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
  // signed token in the path is the only credential. Mounted before static hosting so the
  // SPA fallback cannot swallow it. See design § "Workspace 文件预览".
  app.route("/preview", previewRoutes(deps));

  // Static hosting (production): serves the frontend build output when webDist exists, with SPA fallback to index.html.
  if (fs.existsSync(deps.config.webDist)) {
    registerStaticRoutes(app, deps.config.webDist);
  }

  return app;
}

/**
 * The Project an error is attributed to: only
 * attributed when the URL has a `:projectId` **and** the requester genuinely has
 * access to that Project; otherwise recorded as unattributed (`project_id IS
 * NULL`, visible only to admins).
 *
 * onError also has to handle requests that **haven't passed permission checks
 * yet** — a 401 from being logged out, a 404 from not being a member, both get
 * recorded here. Attributing directly from the URL parameter would let anyone
 * (not necessarily a member of that Project, or even logged in) pick a projectId
 * and hammer it repeatedly to pollute another user's Project with error stats.
 * Traces that can't be attributed simply fall into the admin view (unattributed
 * errors are only visible to admins by design anyway), which is exactly where
 * unauthorized probing belongs.
 *
 * Two defenses here, because this code runs on the error-handling path:
 * - `c.var.user`'s static type is non-null, but authMiddleware never sets it
 *   **before** throwing the 401 when logged out, so at runtime it may actually be
 *   undefined — it can only be read safely, never destructured directly.
 * - Exceptions are swallowed entirely: throwing here would break onError itself
 *   (possibly recursively); any judgment failure falls back to unattributed.
 */
function attributedProjectId(c: Context<AppEnv>, deps: AppDeps): string | undefined {
  try {
    const projectId = c.req.param("projectId");
    if (projectId === undefined) return undefined;
    const user = c.get("user") as UserRow | undefined;
    if (user === undefined) return undefined;
    return deps.projectService.canAccess(user.userId, projectId) ? projectId : undefined;
  } catch {
    return undefined;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Minimal static file server (avoiding an extra dependency): path traversal protection + SPA fallback. */
function registerStaticRoutes(app: Hono<AppEnv>, webDist: string): void {
  app.get("*", async (c) => {
    const reqPath = decodeURIComponent(c.req.path);
    if (reqPath.startsWith("/api/")) {
      return c.json(errorBody("not_found", "Endpoint does not exist."), 404);
    }
    const rel = reqPath.replace(/^\/+/, "");
    const resolved = path.resolve(webDist, rel === "" ? "index.html" : rel);
    // Guard against path traversal: once resolved, it must still be inside webDist.
    const base = path.resolve(webDist);
    const target =
      resolved === base || resolved.startsWith(base + path.sep)
        ? resolved
        : path.join(base, "index.html");
    let file = target;
    try {
      const stat = await fsp.stat(file);
      if (stat.isDirectory()) file = path.join(file, "index.html");
      await fsp.access(file);
    } catch {
      file = path.join(base, "index.html"); // SPA fallback
    }
    let content: Buffer;
    try {
      content = await fsp.readFile(file);
    } catch {
      return c.json(errorBody("not_found", "Resource does not exist."), 404);
    }
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(content), {
      status: 200,
      headers: { "Content-Type": type },
    });
  });
}
