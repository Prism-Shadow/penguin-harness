/**
 * The RUNTIME shell: Hono assembly of the mechanism surface (auth, desktop, HMR, the
 * platform seam, static hosting) + capability publication for the hot platform.
 *
 * The business surface — every business service and route — lives in
 * platform/business.ts and is assembled per App inside platformImpl.create
 * (platform/platform.ts), so a hot push replaces it wholesale.
 *
 * `createApp(deps)` is pure assembly (does not listen on a port): tests inject requests
 * via `app.request()`; `buildAppDeps(config)` builds the runtime core, publishes its
 * capabilities, boots the platform (which builds the business surface), and returns the
 * merged view. The startup entry point is in index.ts.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { DatabaseSync } from "node:sqlite";
import type { ServerConfig } from "./config.js";
import { applyProxySettings } from "./net/proxy.js";
import {
  BUSINESS_DEPS_RESOURCE_ID,
  RUNTIME_AUTH_RESOURCE_ID,
  RUNTIME_CHANNELS_RESOURCE_ID,
  RUNTIME_CONFIG_RESOURCE_ID,
  RUNTIME_DB_RESOURCE_ID,
  RUNTIME_DESKTOP_RESOURCE_ID,
  RUNTIME_HMR_RESOURCE_ID,
  RUNTIME_OVERRIDES_RESOURCE_ID,
  RUNTIME_PROXY_RESOURCE_ID,
} from "./platform/capabilities.js";
import type { ProxyControl } from "./platform/capabilities.js";
import { openDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import type { ErrorsRepo } from "./db/repos/errors.js";
import type { GoalsRepo } from "./db/repos/goals.js";
import type { SchedulesRepo } from "./db/repos/schedules.js";
import type { ServerSettingsRepo } from "./db/repos/server-settings.js";
import type { SessionsRepo } from "./db/repos/sessions.js";
import type { UiPrefsRepo } from "./db/repos/ui-prefs.js";
import { UsersRepo } from "./db/repos/users.js";
import { jsonOnlyWrites, SESSION_COOKIE } from "./auth/middleware.js";
import { IDENTITY_RESOURCE_ID } from "./platform/terminal/identity.js";
import type { AppEnv } from "./auth/middleware.js";
import { ADMIN_USER_ID, AuthService } from "./auth/service.js";
import { clearInitialAdminPassword } from "./initial-password.js";
import { handleError, HttpError, errorBody } from "./http/errors.js";
import { attributedProjectId } from "./http/attribution.js";
import { authRoutes } from "./http/routes/auth.js";
import { ChannelHub } from "./runtime/channel.js";
import type { ErrorRecorder } from "./runtime/error-recorder.js";
import type { SessionManager, SessionLoader } from "./runtime/session-manager.js";
import type { SessionSources } from "./runtime/session-sources.js";
import type { Scheduler } from "./runtime/scheduler.js";
import type { TitleNotifier } from "./runtime/title-generator.js";
import type { AdminService } from "./services/admin-service.js";
import { DesktopService } from "./services/desktop-service.js";
import { desktopRoutes } from "./http/routes/desktop.js";
import type { AgentConfigService } from "./services/agent-config-service.js";
import type { MemoryService } from "./services/memory-service.js";
import type { AgentService } from "./services/agent-service.js";
import type { BenchmarkService } from "./services/benchmark-service.js";
import type { SnapshotService } from "./services/snapshot-service.js";
import type { ProjectConfigService } from "./services/project-config-service.js";
import type { ProjectService } from "./services/project-service.js";
import type { SessionService } from "./services/session-service.js";
import type { TraceIndexService } from "./services/trace-index.js";
import type { TraceService } from "./services/trace-service.js";
import type { UpdateCheckService } from "./services/update-check-service.js";
import type { UsageService } from "./services/usage-service.js";
import type { WorkspaceFilesService } from "./services/workspace-files-service.js";
import { HmrHost } from "./hmr/host.js";
import { hmrRoutes } from "./hmr/routes.js";
import { platformHttpSeam } from "./hmr/http-seam.js";
import { hostOnly, loopbackHostRoles, requestAuthority } from "./services/preview-token.js";
import type { PreviewTokenSigner } from "./services/preview-token.js";

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
  log?: (line: string) => void;
  now?: () => Date;
}

/**
 * Assemble the runtime core, publish its capabilities, boot the platform (which builds
 * the business surface — see platform/business.ts), and return the merged view. Shared
 * by production and tests; tests pass dbPath=":memory:" and a temp root.
 */
export async function buildAppDeps(
  config: ServerConfig,
  overrides: BuildDepsOverrides = {},
): Promise<AppDeps> {
  const db = openDatabase(config.dbPath);

  const usersRepo = new UsersRepo(db);
  const authSessionsRepo = new AuthSessionsRepo(db);

  // Hoisted above the services so its registry can be populated before anything boots
  // against it.
  const hmr = new HmrHost(config.root);

  // Channel idle reclamation skips active Sessions (running/compacting can go a long time
  // without a publish, e.g. while waiting for approval). The manager lives platform-side
  // and is rebuilt by every swap: resolve the CURRENT one through the registry at sweep
  // time rather than capturing any one incarnation.
  const channels = new ChannelHub({
    isActive: (key) => {
      const business = hmr.resources.claim<AppDeps>(BUSINESS_DEPS_RESOURCE_ID);
      return business !== undefined && business.manager.statusOf(key) !== "idle";
    },
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
    // Auth is runtime mechanism, but WHAT a fresh user is provisioned with is business
    // policy — late-bound through the registry so it always reaches the current App.
    provisionInitialProject: (user, isAdmin) => {
      const business = hmr.resources.claim<AppDeps>(BUSINESS_DEPS_RESOURCE_ID);
      if (business === undefined) {
        throw new Error("no business platform is running to provision the initial Project");
      }
      return business.projectService.provisionInitialProject(user, isAdmin);
    },
    seedAdminPassword: config.seedAdminPassword,
    onPasswordChanged,
    sessionTtlMs: config.authSessionTtlMs,
    sessionRenewMs: config.authSessionRenewMs,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  // The seam runs before the auth middleware, so a platform serving an API of its own has
  // no `c.var.user`. Authenticating is the runtime's job, not something a bundle should
  // re-implement against cookie names and session TTLs — so it is published as a
  // capability the booting platform claims (see platform/terminal/identity.ts).
  hmr.resources.register(IDENTITY_RESOURCE_ID, async (request: Request) => {
    const token = readSessionCookie(request.headers.get("cookie"));
    const authed = token === null ? null : authService.authenticateWithMeta(token);
    return authed === null ? null : { userId: authed.user.userId };
  });
  // The capability set buildBusinessDeps claims (see platform/capabilities.ts) — every
  // entry must be in place before ensure() below performs the first boot.
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
  // services, routes, the scheduler — is assembled inside its create().
  await hmr.ensure();
  const business = hmr.resources.claim<AppDeps>(BUSINESS_DEPS_RESOURCE_ID);
  if (business === undefined) {
    throw new Error("the packaged platform built no business surface");
  }
  return business;
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

  // Every protected business route — /api/me through /api/sessions, and /preview — is
  // served by the platform through the seam above (see platform/business.ts). What
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
