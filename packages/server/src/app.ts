/**
 * App assembly, both halves of it.
 *
 * The RUNTIME shell — `createRuntimeApp(deps)` — mounts the mechanism surface: the network
 * guards, `/api/auth`, `/api/desktop`, `/api/hmr`, the platform seam, and static hosting.
 * `bootAppDeps(config)` builds the shell's own core (database, auth, channels, HmrHost),
 * publishes its capabilities into the resource registry (see hmr/capabilities.ts), boots the
 * platform — which builds the business surface over those capabilities — and returns that
 * App's deps, read off the booted instance. Neither app listens on a port: tests inject
 * requests via `app.request()`, and the startup entry point is index.ts.
 *
 * The BUSINESS surface — `buildAppDeps` + `createApp`, at the bottom of this
 * file — is what a hot push replaces. Both are called from `platformImpl.create`
 * (hmr/platform.ts) at every App creation, over the capabilities claimed from the
 * registry, so every business service and route travels with the platform version rather
 * than with this build. Swap semantics for anything they hold that is not parked is a
 * HARD STOP: approvals deny, runs abort, the scheduler dies with its App.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bodyLimitBytes } from "./services/attachment-limits.js";
import type { DatabaseSync } from "node:sqlite";
import type { ServerConfig } from "./config.js";
import { applyProxySettings, mergedNoProxy } from "./net/proxy.js";
import {
  RUNTIME_INTERFACES,
  RUNTIME_INTERFACES_RESOURCE_ID,
  RUNTIME_AUTH_RESOURCE_ID,
  RUNTIME_CHANNELS_RESOURCE_ID,
  RUNTIME_CONFIG_RESOURCE_ID,
  RUNTIME_DB_RESOURCE_ID,
  RUNTIME_DESKTOP_RESOURCE_ID,
  RUNTIME_HMR_RESOURCE_ID,
  RUNTIME_OVERRIDES_RESOURCE_ID,
  RUNTIME_PROXY_RESOURCE_ID,
  RuntimeCapabilities,
} from "./hmr/capabilities.js";
import type { ProxyControl } from "./hmr/capabilities.js";
import { openDatabase } from "./db/database.js";
import { ErrorsRepo } from "./db/repos/errors.js";
import { GoalsRepo } from "./db/repos/goals.js";
import { SchedulesRepo } from "./db/repos/schedules.js";
import { ServerSettingsRepo } from "./db/repos/server-settings.js";
import { SessionsRepo } from "./db/repos/sessions.js";
import { UiPrefsRepo } from "./db/repos/ui-prefs.js";
import { UsersRepo } from "./db/repos/users.js";
import type { UserRow } from "./db/repos/users.js";
import { authMiddleware, jsonOnlyWrites } from "./auth/middleware.js";
import type { Identity } from "./terminal/identity.js";
import { terminalRoutes } from "./terminal/routes.js";
import type { TerminalManager } from "./terminal/manager.js";
import type { AppEnv } from "./auth/middleware.js";
import { AuthService } from "./auth/service.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { handleError, HttpError, errorBody } from "./http/errors.js";
import { attributedProjectId } from "./http/attribution.js";
import { authRoutes } from "./http/routes/auth.js";
import { ChannelHub } from "./runtime/channel.js";
import { ErrorRecorder } from "./runtime/error-recorder.js";
import {
  createCoreSessionLoader,
  SessionLoader,
  SessionManager,
} from "./runtime/session-manager.js";
import { SessionSources } from "./runtime/session-sources.js";
import { Scheduler } from "./runtime/scheduler.js";
import { TitleGenerator, TitleNotifier } from "./runtime/title-generator.js";
import { AdminService } from "./services/admin-service.js";
import { DesktopService } from "./services/desktop-service.js";
import { desktopRoutes, desktopUpdateRoutes } from "./http/routes/desktop.js";
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

import type { ProxyEnvPolicy } from "@prismshadow/penguin-core";
import { declined } from "./hmr/hono-seam.js";
import { AgentsRepo } from "./db/repos/agents.js";
import { MembersRepo } from "./db/repos/members.js";
import { ProjectsRepo } from "./db/repos/projects.js";
import { TraceIndexRepo } from "./db/repos/trace-index.js";
import { UsageRepo } from "./db/repos/usage.js";
import { adminUsersRoutes } from "./http/routes/admin.js";
import { adminSettingsRoutes } from "./http/routes/admin-settings.js";
import type { ServerEvent } from "./api/types.js";
import { meRoutes } from "./http/routes/me.js";
import { eventsRoutes, userChannelKey } from "./http/routes/events.js";
import { projectsRoutes } from "./http/routes/projects.js";
import { membersRoutes } from "./http/routes/members.js";
import { modelsRoutes } from "./http/routes/models.js";
import { chatDefaultsRoutes } from "./http/routes/chat-defaults.js";
import { commandPolicyRoutes } from "./http/routes/command-policy.js";
import { vaultRoutes } from "./http/routes/vault.js";
import { memoryRoutes } from "./http/routes/memory.js";
import { scheduleRoutes } from "./http/routes/schedules.js";
import { benchmarksRoutes } from "./http/routes/benchmarks.js";
import { agentSkillsRoutes, skillLibraryRoutes } from "./http/routes/skills.js";
import { agentTransferRoutes } from "./http/routes/agent-transfer.js";
import { agentsRoutes } from "./http/routes/agents.js";
import { dirsRoutes } from "./http/routes/dirs.js";
import { directorySkillsRoutes } from "./http/routes/directory-skills.js";
import { agentConfigRoutes } from "./http/routes/agent-config.js";
import { agentTracesRoutes } from "./http/routes/agent-traces.js";
import { usageRoutes } from "./http/routes/usage.js";
import { agentSessionsRoutes, sessionsRoutes } from "./http/routes/sessions.js";
import { versionRoutes } from "./http/routes/version.js";
import { UsageRecorder } from "./runtime/usage-recorder.js";
import { previewRoutes } from "./http/routes/preview.js";

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
  /**
   * Applies proxy settings to the RUNTIME's global dispatcher. A capability rather than a
   * direct import on purpose: a pushed bundle carries its own copy of net/proxy.js (and of
   * undici), so calling its own applyProxySettings would configure a dispatcher
   * globalThis.fetch never routes through.
   */
  proxyControl: ProxyControl;
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
  /**
   * Test double: scrypt work factor for password hashes written through this app.
   * Omitted in production, where the KDF runs at full strength.
   */
  passwordHashCost?: number;
  log?: (line: string) => void;
  now?: () => Date;
}

/**
 * Assemble the runtime core, publish its capabilities, boot the platform (which builds
 * the business surface — see app.ts), and return the merged view. Shared
 * by production and tests; tests pass dbPath=":memory:" and a temp root.
 */
export async function bootAppDeps(
  config: ServerConfig,
  overrides: BuildDepsOverrides = {},
): Promise<AppDeps> {
  const db = openDatabase(config.dbPath);

  const usersRepo = new UsersRepo(db);

  // Hoisted above the services so its registry can be populated before anything boots
  // against it.
  const hmr = new HmrHost(config.root);

  // Channel idle reclamation must skip active Sessions, but "is this session busy" is a
  // business question: the App installs the answer itself via setActivityProbe at every
  // create (see hmr/platform.ts) — ordinary use of the claimed capability, re-installed
  // by each generation. Until the first App boots, nothing is active.
  const channels = new ChannelHub();

  const authService = new AuthService({
    users: usersRepo,
    authSessions: new AuthSessionsRepo(db),
    // Auth is runtime mechanism, but WHAT a fresh user is provisioned with is business
    // policy: the App installs the real provisioner via setProvisioner at every create
    // (see hmr/platform.ts). This constructor fallback only answers before the first
    // boot, which the startup order below makes unreachable in practice.
    provisionInitialProject: () => {
      throw new Error("no business platform is running to provision the initial Project");
    },
    seedAdminPassword: config.seedAdminPassword,
    sessionTtlMs: config.authSessionTtlMs,
    sessionRenewMs: config.authSessionRenewMs,
    ...(overrides.passwordHashCost !== undefined
      ? { passwordHashCost: overrides.passwordHashCost }
      : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  // The capability set buildAppDeps claims (see hmr/capabilities.ts) — every
  // entry must be in place before ensure() below performs the first boot. The interface
  // descriptor leads: it is what a bundle's handshake reads before trusting any of the rest.
  hmr.resources.register(RUNTIME_INTERFACES_RESOURCE_ID, RUNTIME_INTERFACES);
  hmr.resources.register(RUNTIME_CONFIG_RESOURCE_ID, config);
  hmr.resources.register(RUNTIME_DB_RESOURCE_ID, db);
  hmr.resources.register(RUNTIME_AUTH_RESOURCE_ID, authService);
  hmr.resources.register(RUNTIME_CHANNELS_RESOURCE_ID, channels);
  hmr.resources.register(RUNTIME_PROXY_RESOURCE_ID, applyProxySettings);
  hmr.resources.register(RUNTIME_HMR_RESOURCE_ID, hmr);
  hmr.resources.register(RUNTIME_OVERRIDES_RESOURCE_ID, overrides);
  const desktop = config.desktopToken !== null ? new DesktopService(config.desktopToken) : null;
  hmr.resources.register(RUNTIME_DESKTOP_RESOURCE_ID, desktop);

  // Boot the platform now rather than on the first request: the business surface —
  // services, routes, the scheduler — is assembled inside its create(). The check reads
  // the in-process api member, not a registry entry: the instance IS the current App.
  const instance = await hmr.ensure();
  const business = instance.api.business();
  if (business === null) {
    throw new Error("the packaged platform built no business surface");
  }
  // The App's own deps, read off the booted instance — the same bag every caller of this
  // function always received. Callers that outlive swaps (index.ts, the runtime app) may
  // only touch its swap-stable members: the runtime singletons published above, and the
  // stateless repos over this process's own db handle. The business machinery on it
  // (manager, services, scheduler) belongs to THIS generation and goes stale at the next
  // push — per-request business dispatch rides the seam, never this reference.
  return business;
}

/** Assembles the Hono app (does not listen on a port). */
export function createRuntimeApp(deps: AppDeps): Hono<AppEnv> {
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
  //
  // The cap is DERIVED from the admin-settable attachment budget rather than fixed, because the
  // two must not disagree in either direction: a cap below the budget would reject a request whose
  // every attachment was individually legal (and with a body-shaped error, not a size-shaped one),
  // while a cap permanently sized for the largest budget an admin *could* set would keep accepting
  // 300MB bodies on a server whose limits were left at 10MB. It is re-derived per request, so an
  // admin's change takes effect immediately; the middleware itself is memoized on the resulting
  // size so the steady state allocates nothing.
  let capped: { size: number; mw: MiddlewareHandler } | null = null;
  app.use("/api/*", (c, next) => {
    const size = bodyLimitBytes(deps.serverSettingsRepo.getAttachmentLimitsMb());
    if (capped === null || capped.size !== size) {
      capped = {
        size,
        mw: bodyLimit({
          maxSize: size,
          // Its default is a bare text/plain 413; throw the App's own error instead so the
          // response stays the documented `payload_too_large` body that every client handles.
          onError: () => {
            throw new HttpError(
              413,
              "payload_too_large",
              `Request body exceeds the ${Math.floor(size / (1024 * 1024))}MB limit.`,
            );
          },
        }),
      };
    }
    return capped.mw(c, next);
  });
  app.use("/api/*", jsonOnlyWrites);

  // Public routes (no login required).
  app.route("/api/auth", authRoutes(deps));
  // Desktop shutdown authenticates with the shell's Bearer token, not the cookie
  // session, so it mounts outside authMiddleware (and only in desktop mode).
  if (deps.desktop) {
    app.route("/api/desktop", desktopRoutes(deps));
    // The client-update surface is runtime-owned like the rest of /api/desktop (the
    // platform declines that whole prefix): it reads the updater snapshot the shell
    // pushes over the parentPort this process wires at startup, and forwards
    // check/install back. Cookie-authed, unlike the Bearer-token shutdown above, so it
    // carries the auth middleware on its own subtree — the routes then gate on
    // `sessionVia === "desktop"`, i.e. the shell's own window.
    app.use("/api/desktop/update", authMiddleware(deps.authService, deps.config.trustProxy));
    app.use("/api/desktop/update/*", authMiddleware(deps.authService, deps.config.trustProxy));
    app.route("/api/desktop/update", desktopUpdateRoutes(deps));
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

  // Every protected business route — /api/me through /api/sessions, and /preview — is
  // served by the platform through the seam above (see app.ts). What
  // follows is the runtime's own tail: static hosting and the SPA fallback.

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

// ---------------------------------------------------------------------------
// The business surface: everything below travels with the platform version.
// Called from hmr/platform.ts's create() at every App creation — see the module doc.
// ---------------------------------------------------------------------------

/**
 * Assembles the business service graph over the claimed runtime capabilities.
 *
 * The db handle, auth service, channel hub, config object and hmr host come from the
 * claim — one live instance per process, shared with the runtime. Everything else is
 * built fresh per App, which is exactly what makes it hot-swappable.
 */
export function buildAppDeps(
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
  const snapshots = new SnapshotService(config.root);
  const agentService = new AgentService(config.root, agentsRepo, agentConfigService, snapshots);
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
  // Shared by SessionManager (run-state flips) and TitleGenerator (title updates): both are
  // list-row facts that must reach tabs not subscribed to the Session's own channel.
  //
  // Audience = the Project's owner plus its members, i.e. exactly who
  // ProjectsRepo.listAccessible would grant the Project to — nobody learns that a Session they
  // cannot open changed state or gained a title.
  //
  // `peek`, deliberately not `get`: a user who has never opened an event stream has no
  // channel, and conjuring one to buffer badge updates nobody is listening to is pure waste
  // (their next connection fetches the list, which carries the same statuses anyway).
  const notifyProjectUsers = (projectId: string, event: ServerEvent): void => {
    const ownerUserId = projectsRepo.findById(projectId)?.ownerUserId;
    if (ownerUserId === undefined) return;
    const audience = new Set([ownerUserId, ...membersRepo.list(projectId).map((m) => m.userId)]);
    for (const userId of audience) {
      channels.peek(userChannelKey(userId))?.publish(event, "server_event");
    }
  };
  const titles =
    overrides.titles ??
    new TitleGenerator({
      sessions: sessionsRepo,
      channels,
      recorder,
      errors,
      log,
      notifyProjectUsers,
    });
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
    // Run-state flips reach the whole login session, not just the tab watching that one
    // conversation (see the shared publisher above for the audience).
    notifyProjectUsers,
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
  const adminService = new AdminService({
    users: usersRepo,
    authSessions: new AuthSessionsRepo(db),
    projects: projectsRepo,
    projectService,
    ...(overrides.passwordHashCost !== undefined
      ? { passwordHashCost: overrides.passwordHashCost }
      : {}),
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

/** Prefixes the runtime serves itself; the platform app declines them unconditionally. */
const RUNTIME_PREFIXES = ["/api/auth", "/api/desktop", "/api/hmr"];

/**
 * Assembles the platform's ONE Hono app: every route the platform serves — the terminal
 * group and the business groups — registered together, so a swap replaces the whole route
 * table as a unit (routes + auth + error shaping; no listening, no logging).
 *
 * `deps` is null when the host published no business capabilities — a declared bare kernel:
 * the terminal group still serves, everything else declines. A runtime merely too OLD to
 * publish them never reaches here; the platform refuses to boot on one (hmr/platform.ts's
 * create), because that runtime still answers the business API out of its own routes.
 */
export function createApp(
  deps: AppDeps | null,
  terminals: TerminalManager,
  identity: Identity,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Error recording is layered in a lambda wrapping onError: handleError stays a
  // pure function with unchanged behavior (HttpError is mapped as-is, unknown
  // exceptions are logged with a stack trace and collapsed to 500), and recording
  // to the DB is just a side-effect layered on top — skipped when no business (and so
  // no errors table access) is running.
  app.onError((err, c) => {
    if (deps !== null) {
      const projectId = attributedProjectId(c, deps);
      deps.errors.record({
        source: "http",
        err,
        ...(projectId !== undefined ? { ctx: { projectId } } : {}),
      });
    }
    return handleError(err, c);
  });
  app.notFound(() => declined());

  // The terminal group mounts FIRST and carries its own per-route identity gate: a
  // matched terminal route ends the chain before the cookie auth below ever runs, and an
  // unmatched /api/terminals path falls through it into the same auth-then-decline shape
  // as any other unknown /api path.
  app.route("/", terminalRoutes(terminals, identity));

  if (deps === null) return app;

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
  app.use("/api/*", authMiddleware(deps.authService, deps.config.trustProxy));
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
  app.route("/api/projects/:projectId/command-policy", commandPolicyRoutes(deps));
  app.route("/api/projects/:projectId/agents", agentsRoutes(deps));
  app.route("/api/projects/:projectId/dirs", dirsRoutes(deps));
  app.route("/api/projects/:projectId/dir-skills", directorySkillsRoutes(deps));
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
