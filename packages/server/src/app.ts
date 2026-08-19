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
import { bodyLimit } from "hono/body-limit";
import type { DatabaseSync } from "node:sqlite";
import type { ProxyEnvPolicy } from "@prismshadow/penguin-core";
import type { ServerConfig } from "./config.js";
import { mergedNoProxy } from "./net/proxy.js";
import { openDatabase } from "./db/database.js";
import { AgentsRepo } from "./db/repos/agents.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { ErrorsRepo } from "./db/repos/errors.js";
import { MembersRepo } from "./db/repos/members.js";
import { ProjectsRepo } from "./db/repos/projects.js";
import { GoalsRepo } from "./db/repos/goals.js";
import { SchedulesRepo } from "./db/repos/schedules.js";
import { ServerSettingsRepo } from "./db/repos/server-settings.js";
import { SessionsRepo } from "./db/repos/sessions.js";
import { TraceIndexRepo } from "./db/repos/trace-index.js";
import { UiPrefsRepo } from "./db/repos/ui-prefs.js";
import { UsageRepo } from "./db/repos/usage.js";
import { UsersRepo } from "./db/repos/users.js";
import type { UserRow } from "./db/repos/users.js";
import { authMiddleware, jsonOnlyWrites, SESSION_COOKIE } from "./auth/middleware.js";
import { IDENTITY_RESOURCE_ID } from "./hmr/identity.js";
import type { AppEnv } from "./auth/middleware.js";
import { ADMIN_USER_ID, AuthService } from "./auth/service.js";
import { clearInitialAdminPassword } from "./initial-password.js";
import { handleError, HttpError, errorBody } from "./http/errors.js";
import { adminUsersRoutes } from "./http/routes/admin.js";
import { adminSettingsRoutes } from "./http/routes/admin-settings.js";
import { authRoutes } from "./http/routes/auth.js";
import { meRoutes } from "./http/routes/me.js";
import { eventsRoutes, userChannelKey } from "./http/routes/events.js";
import { projectsRoutes } from "./http/routes/projects.js";
import { membersRoutes } from "./http/routes/members.js";
import { modelsRoutes } from "./http/routes/models.js";
import { chatDefaultsRoutes } from "./http/routes/chat-defaults.js";
import { vaultRoutes } from "./http/routes/vault.js";
import { memoryRoutes } from "./http/routes/memory.js";
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
import { versionRoutes } from "./http/routes/version.js";
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
import { DesktopService } from "./services/desktop-service.js";
import { desktopRoutes } from "./http/routes/desktop.js";
import { AgentConfigService } from "./services/agent-config-service.js";
import { MemoryService } from "./services/memory-service.js";
import { AgentService } from "./services/agent-service.js";
import { BenchmarkService } from "./services/benchmark-service.js";
import { SnapshotService } from "./services/snapshot-service.js";
import { ProjectConfigService } from "./services/project-config-service.js";
import { ProjectService } from "./services/project-service.js";
import { SessionService } from "./services/session-service.js";
import { TraceIndexService } from "./services/trace-index.js";
import { TraceService } from "./services/trace-service.js";
import { UpdateCheckService } from "./services/update-check-service.js";
import { UsageService } from "./services/usage-service.js";
import { WorkspaceFilesService } from "./services/workspace-files-service.js";
import { HmrHost } from "./hmr/host.js";
import { hmrRoutes } from "./hmr/routes.js";
import { platformHttpSeam } from "./hmr/http-seam.js";
import {
  createPreviewTokenSigner,
  hostOnly,
  loopbackHostRoles,
  requestAuthority,
} from "./services/preview-token.js";
import type { PreviewTokenSigner } from "./services/preview-token.js";
import { previewRoutes } from "./http/routes/preview.js";

/** Request body size limit (tasks may carry data: images): 20MB. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

export interface AppDeps {
  config: ServerConfig;
  db: DatabaseSync;
  sessionsRepo: SessionsRepo;
  prefsRepo: UiPrefsRepo;
  /** Admin-level server-global settings (currently the proxy switches and address). */
  serverSettingsRepo: ServerSettingsRepo;
  authService: AuthService;
  adminService: AdminService;
  projectService: ProjectService;
  projectConfigService: ProjectConfigService;
  agentService: AgentService;
  agentConfigService: AgentConfigService;
  memoryService: MemoryService;
  sessionService: SessionService;
  traceService: TraceService;
  /** Trace-file index (derived cache + reconciler); routes use it for delete-time coherence. */
  traceIndex: TraceIndexService;
  usageService: UsageService;
  /** GitHub latest-release lookup for the web UI's update reminder (cached, fail-soft). */
  updateCheck: UpdateCheckService;
  workspaceFiles: WorkspaceFilesService;
  /** Signs/verifies short-lived Workspace preview tokens (separate preview origin). */
  previewTokens: PreviewTokenSigner;
  benchmarks: BenchmarkService;
  snapshots: SnapshotService;
  schedulesRepo: SchedulesRepo;
  goalsRepo: GoalsRepo;
  errorsRepo: ErrorsRepo;
  scheduler: Scheduler;
  channels: ChannelHub;
  manager: SessionManager;
  /** Session-origin registry derived from session_meta (single source of truth; no DB column). */
  sessionSources: SessionSources;
  /** Error persistence (shared by app.onError and various background capture points; the process-level fallback is in index.ts). */
  errors: ErrorRecorder;
  /** Desktop mode (PENGUIN_DESKTOP_TOKEN): one-shot login + shutdown token holder; null outside desktop mode. */
  desktop: DesktopService | null;
  /** HMR host: loads/swaps/persists the platform and web bundles (park/boot kernel). */
  hmr: HmrHost;
  /** Request log output (minimal one-liner); tests inject a noop. */
  log: (line: string) => void;
}

export interface BuildDepsOverrides {
  /** Test double: session-manager's underlying loader (avoids the real LLM/SDK path). */
  loader?: SessionLoader;
  /** Test double: Session title generator (avoids real LLM requests). */
  titles?: TitleNotifier;
  /** Test double: update-check service with a stubbed fetch/clock (avoids real network calls). */
  updateCheck?: UpdateCheckService;
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
  // harmless and there is nothing to persist or rotate.
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
    goals: goalsRepo,
    projectConfig: projectConfigService,
    manager,
    traceIndex,
  });
  // Any password update for the built-in admin makes the persisted initial-password
  // plaintext stale (either the password is no longer initial, or a reset replaced it
  // with an admin-chosen value that is never persisted): drop the file so later startups
  // stop re-printing a credential that no longer signs in.
  const onPasswordChanged = (userId: string): void => {
    if (userId === ADMIN_USER_ID) clearInitialAdminPassword(config.root);
  };
  const authService = new AuthService({
    users: usersRepo,
    authSessions: authSessionsRepo,
    provisionInitialProject: (user, isAdmin) =>
      projectService.provisionInitialProject(user, isAdmin),
    seedAdminPassword: config.seedAdminPassword,
    onPasswordChanged,
    sessionTtlMs: config.authSessionTtlMs,
    sessionRenewMs: config.authSessionRenewMs,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const adminService = new AdminService({
    users: usersRepo,
    authSessions: authSessionsRepo,
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
  // Schedule scheduler: active only while the server is running. Only
  // assembled here; start() is called in index.ts (tests drive it via tickOnce, no real timer).
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

  // Hoisted out of the returned literal so its resource registry can be populated before
  // anything boots against it.
  const hmr = new HmrHost(config.root);
  // Identity for platform-served HTTP: the seam offers a pushed platform every request
  // BEFORE the auth middleware runs, so platform code answering its own endpoint has no
  // user in hand. Publishing the runtime's own resolver is what keeps session lookup out
  // of pushed code — see hmr/identity.ts.
  hmr.resources.register(IDENTITY_RESOURCE_ID, async (request: Request) => {
    const token = readSessionCookie(request.headers.get("cookie"));
    const authed = token === null ? null : authService.authenticateWithMeta(token);
    return authed === null ? null : { userId: authed.user.userId };
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
    desktop: config.desktopToken !== null ? new DesktopService(config.desktopToken) : null,
    hmr,
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

  // Canonical-host guard (loopback binds only): the App is served on one loopback name and
  // previews on its counterpart, but the SAME process answers on both. Without this, Agent-
  // written preview HTML on the preview host could call /api same-origin and — if a session
  // cookie had ever been set on that host — act as the user. So the preview host serves ONLY
  // /preview/*: /api answers 401 (it never sets or honors a cookie there, closing both the
  // login and the stale-cookie paths), and everything else 302s to the canonical App host.
  // Off when PENGUIN_PREVIEW_ORIGIN is set: previews then
  // use that origin rather than the loopback counterpart, so 127.0.0.1 is an ordinary App
  // access point and must not be locked down — deployments enforce the equivalent at the
  // reverse proxy (route only /preview/* to the App on the preview origin).
  const previewRoles = deps.config.previewOrigin ? null : loopbackHostRoles(deps.config.host);
  if (previewRoles) {
    app.use("*", async (c, next) => {
      const host = hostOnly(requestAuthority(c.req.url, c.req.header("host"))).toLowerCase();
      if (host === previewRoles.preview && !c.req.path.startsWith("/preview/")) {
        if (c.req.path.startsWith("/api/")) {
          throw new HttpError(401, "unauthorized", "The API is not served on the preview host.");
        }
        const url = new URL(c.req.url);
        url.hostname = previewRoles.app;
        return c.redirect(url.toString(), 302);
      }
      await next();
    });
  }

  // API common defenses: request body size cap (20MB) and write-request Content-Type (one of the CSRF MVP defenses).
  //
  // The cap has to be measured, not read: a chunked request carries no `content-length` at all,
  // so a header check alone passes a body of any size — the sinks behind it (task input images,
  // file attachments, Trace import) then decode whatever arrives. hono's bodyLimit keeps the
  // header fast path when the length is declared and otherwise counts bytes off the stream,
  // aborting the moment the total crosses the cap.
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      // Its default is a bare text/plain 413; throw the App's own error instead so the response
      // stays the documented `payload_too_large` body that every client already handles.
      onError: () => {
        throw new HttpError(413, "payload_too_large", "Request body exceeds the 20MB limit.");
      },
    }),
  );
  app.use("/api/*", jsonOnlyWrites);

  // Public routes (no login required).
  app.route("/api/auth", authRoutes(deps));
  // Desktop shutdown authenticates with the shell's Bearer token, not the cookie
  // session, so it mounts outside authMiddleware (and only in desktop mode).
  if (deps.desktop) {
    app.route("/api/desktop", desktopRoutes(deps));
  }
  // Hot platform APIs authenticate themselves (local-agent Bearer token OR
  // admin cookie session, see hot/routes.ts), so they mount outside the
  // cookie-only authMiddleware below.
  app.route("/api/hmr", hmrRoutes(deps));

  // THE seam: from here down, every route is one the platform may take over by push. Mounted
  // after /api/hmr (which stays runtime-owned — see http-seam.ts) and before both the auth
  // gate and the built-in routes, so a pushed platform can add endpoints, replace existing
  // ones, and decide its own authentication. Declining costs one property read and lands on
  // the runtime's own routes below, which is what a platform without an `http` handler does.
  app.use("*", platformHttpSeam(deps.hmr));

  // Protected routes: cookie -> auth_session -> user.
  const auth = authMiddleware(deps.authService);
  app.use("/api/*", auth);
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
  // signed token in the path is the only credential. Mounted before static hosting so the
  // SPA fallback cannot swallow it.
  app.route("/preview", previewRoutes(deps));

  // Static hosting (production): serves the frontend build output with SPA fallback to
  // index.html. The source resolves per request — the hot host can point it at a
  // freshly pushed/restored web dist (in memory) without a restart; when nothing has
  // been pushed, it falls back to the configured webDist. `hmr.ensure()` is awaited
  // FIRST: web is only restored from harness.json as part of the platform+cli+web
  // version's lazy first boot (see HmrHost.restore()), which nothing else here
  // triggers — without this, a request landing right after a restart (before any
  // /api/hmr/* call warms the host up) would miss a restored version entirely and
  // silently fall back to the packaged webDist.
  registerStaticRoutes(app, async () => {
    await deps.hmr.ensure();
    return deps.hmr.resolveWebSource() ?? { kind: "dir", dir: deps.config.webDist };
  });

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

/** Where registerStaticRoutes reads a request's bytes from, resolved fresh per request. */
export type WebSource = { kind: "mem"; files: Map<string, Buffer> } | { kind: "dir"; dir: string };

/**
 * Minimal static file server (avoiding an extra dependency): path traversal
 * protection + SPA fallback, over either an in-memory pushed/restored dist (the
 * hot host's primary path — no filesystem at all) or the packaged webDist
 * directory on disk.
 */
function registerStaticRoutes(app: Hono<AppEnv>, resolveSource: () => Promise<WebSource>): void {
  app.get("*", async (c) => {
    const reqPath = decodeURIComponent(c.req.path);
    if (reqPath.startsWith("/api/")) {
      return c.json(errorBody("not_found", "Endpoint does not exist."), 404);
    }
    const rel = reqPath.replace(/^\/+/, "") || "index.html";
    // Resolved per request: the hot host may retarget it between requests.
    const source = await resolveSource();

    if (source.kind === "mem") {
      // No filesystem involved, so no traversal guard is needed: an unknown
      // key simply isn't in the map, same as a missing file on disk.
      const servedPath = source.files.has(rel) ? rel : "index.html"; // SPA fallback
      const content = source.files.get(servedPath);
      if (content === undefined) {
        return c.json(errorBody("not_found", "Resource does not exist."), 404);
      }
      const type =
        CONTENT_TYPES[path.extname(servedPath).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(content), {
        status: 200,
        headers: { "Content-Type": type },
      });
    }

    const webDist = source.dir;
    if (!fs.existsSync(webDist)) {
      return c.json(errorBody("not_found", "Resource does not exist."), 404);
    }
    const resolved = path.resolve(webDist, rel);
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

/** The session cookie out of a raw Cookie header (the seam hands over a plain Request). */
function readSessionCookie(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
