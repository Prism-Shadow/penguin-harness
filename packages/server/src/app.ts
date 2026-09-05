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
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bodyLimitBytes, toAttachmentLimits } from "./services/attachment-limits.js";
import type { DatabaseSync } from "node:sqlite";
import type { ModuleTree } from "@prismshadow/penguin-core/kernel";
import type { ServerConfig } from "./config.js";
import { applyProxySettings, mergedNoProxy } from "./net/proxy.js";
import {
  RUNTIME_INTERFACES,
  RUNTIME_INTERFACES_RESOURCE_ID,
  RUNTIME_AUTH_STATE_RESOURCE_ID,
  RUNTIME_CHANNELS_RESOURCE_ID,
  RUNTIME_CONFIG_RESOURCE_ID,
  RUNTIME_DB_RESOURCE_ID,
  RUNTIME_DESKTOP_RESOURCE_ID,
  RUNTIME_HMR_RESOURCE_ID,
  RUNTIME_OVERRIDES_RESOURCE_ID,
  type Replacements,
  RUNTIME_PROXY_RESOURCE_ID,
  RuntimeCapabilities,
  type ProxyControl,
} from "./hmr/capabilities.js";
import { openDatabase } from "./db/database.js";
import { MachinesRepo } from "./db/repos/machines.js";
import { migrate } from "./db/migrations.js";
import { ErrorsRepo } from "./db/repos/errors.js";
import { MessagingBindingsRepo } from "./db/repos/messaging-bindings.js";
import { SchedulesRepo } from "./db/repos/schedules.js";
import { ServerSettingsRepo } from "./db/repos/server-settings.js";
import { SessionsRepo } from "./db/repos/sessions.js";
import { UiPrefsRepo } from "./db/repos/ui-prefs.js";
import { UsersRepo } from "./db/repos/users.js";
import type { UserRow } from "./db/repos/users.js";
import { authMiddleware, jsonOnlyWrites } from "./auth/middleware.js";
import { mintApiToken, storeApiToken } from "./auth/api-token.js";
import type { Identity } from "./terminal/identity.js";
import { terminalRoutes } from "./terminal/routes.js";
import type { TerminalManager } from "./terminal/manager.js";
import { PLUGINS_RESOURCE_ID, type PluginHost } from "./plugin/host.js";
import type { AppEnv } from "./auth/middleware.js";
import { AuthService } from "./auth/service.js";
import { newAuthRuntimeState } from "./auth/runtime-state.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { ensureInstallId } from "./install-id.js";
import { handleError, HttpError, errorBody } from "./http/errors.js";
import { attributedProjectId } from "./http/attribution.js";
import { authRoutes } from "./http/routes/auth.js";
import { installRoutes } from "./http/routes/install.js";
import { ChannelHub } from "./runtime/channel.js";
import { ErrorRecorder } from "./runtime/error-recorder.js";
import {
  createCoreSessionLoader,
  SessionLoader,
  SessionManager,
} from "./runtime/session-manager.js";
import { SessionSources } from "./runtime/session-sources.js";
import { Scheduler } from "./runtime/scheduler.js";
import { MessagingBridge } from "./runtime/messaging/bridge.js";
import { FeishuConnector } from "./runtime/messaging/feishu-connector.js";
import { createLarkSdk } from "./runtime/messaging/feishu-sdk.js";
import type { FeishuSdk } from "./runtime/messaging/feishu-sdk.js";
import { TelegramConnector } from "./runtime/messaging/telegram-connector.js";
import { createTelegramTransport } from "./runtime/messaging/telegram-api.js";
import type { TelegramTransport } from "./runtime/messaging/telegram-api.js";
import { QQConnector } from "./runtime/messaging/qq-connector.js";
import { createQQTransport } from "./runtime/messaging/qq-api.js";
import type { QQTransport } from "./runtime/messaging/qq-api.js";
import { QQScanService, createQQScanTransport } from "./runtime/messaging/qq-scan.js";
import { WeChatConnector } from "./runtime/messaging/wechat-connector.js";
import { createWeChatTransport } from "./runtime/messaging/wechat-api.js";
import type { WeChatTransport } from "./runtime/messaging/wechat-api.js";
import { WeChatScanService, createWeChatScanTransport } from "./runtime/messaging/wechat-scan.js";
import type { WeChatScanTransport } from "./runtime/messaging/wechat-scan.js";
import type { QQScanTransport } from "./runtime/messaging/qq-scan.js";
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
import { ModelOAuthService } from "./services/model-oauth-service.js";
import { ProjectService } from "./services/project-service.js";
import { SessionService } from "./services/session-service.js";
import { TraceIndexService } from "./services/trace-index.js";
import { TraceService } from "./services/trace-service.js";
import { UpdateCheckService } from "./services/update-check-service.js";
import { UpdateJobService } from "./services/update-job.js";
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

import type { ControlEnvContext, ProxyEnvPolicy, SpawnConfiner } from "@prismshadow/penguin-core";
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
import { modelOAuthCallbackRoutes, modelOAuthRoutes } from "./http/routes/model-oauth.js";
import { chatDefaultsRoutes } from "./http/routes/chat-defaults.js";
import { commandPolicyRoutes } from "./http/routes/command-policy.js";
import { vaultRoutes } from "./http/routes/vault.js";
import { memoryRoutes } from "./http/routes/memory.js";
import { scheduleRoutes } from "./http/routes/schedules.js";
import { benchmarksRoutes } from "./http/routes/benchmarks.js";
import { agentSkillsRoutes } from "./http/routes/skills.js";
import {
  agentHooksRoutes,
  agentPluginsRoutes,
  pluginLibraryRoutes,
} from "./http/routes/plugins.js";
import { agentTransferRoutes } from "./http/routes/agent-transfer.js";
import { agentsRoutes } from "./http/routes/agents.js";
import { dirsRoutes } from "./http/routes/dirs.js";
import { directorySkillsRoutes } from "./http/routes/directory-skills.js";
import { agentConfigRoutes } from "./http/routes/agent-config.js";
import { agentTracesRoutes } from "./http/routes/agent-traces.js";
import { usageRoutes } from "./http/routes/usage.js";
import { agentSessionsRoutes, sessionsRoutes } from "./http/routes/sessions.js";
import { sessionMessagingRoutes } from "./http/routes/messaging.js";
import { versionRoutes } from "./http/routes/version.js";
import { machinesRoutes } from "./http/routes/machines.js";
import { UsageRecorder } from "./runtime/usage-recorder.js";
import { previewRoutes } from "./http/routes/preview.js";
import { MachinesService } from "./machines/service.js";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { Settings } from "./mechanisms/settings.js";
import type { Errors } from "./mechanisms/observability.js";
import type { Access } from "./mechanisms/projects.js";
import type { Auth } from "./mechanisms/identity.js";

/**
 * What the runtime process holds after boot: the capabilities it owns for the process
 * lifetime, and the module tree the platform built over them (src/modules). There is no
 * flat bag of services here any more — a module names what it needs in its manifest.
 */
export interface ServerBoot {
  config: ServerConfig;
  db: DatabaseSync;
  channels: ChannelHub;
  hmr: HmrHost;
  desktop: DesktopService | null;
  tree: ModuleTree;
}

/**
 * Assemble the runtime core, publish its capabilities, boot the platform (which builds
 * the business surface — see app.ts), and return the merged view. Shared
 * by production and tests; tests pass dbPath=":memory:" and a temp root.
 *
 * `plugins` is the host index.ts's loadPlugins step filled from plugins.json — handed in
 * rather than registered by the caller because the platform boots inside this function,
 * and everything it claims has to be in the registry first. Absent (tests), the platform
 * falls back to an empty host (see plugin/index.ts's pluginHostFrom).
 */
export async function bootAppDeps(
  config: ServerConfig,
  replacements: Replacements = [],
  plugins?: PluginHost,
): Promise<ServerBoot> {
  const db = openDatabase(config.dbPath);

  const usersRepo = wire(UsersRepo, { db: db });

  // Hoisted above the services so its registry can be populated before anything boots
  // against it.
  const hmr = new HmrHost(config.root);

  // Channel idle reclamation must skip active Sessions, but "is this session busy" is a
  // business question: the App installs the answer itself via setActivityProbe at every
  // create (see hmr/platform.ts) — ordinary use of the claimed capability, re-installed
  // by each generation. Until the first App boots, nothing is active.
  const channels = new ChannelHub();

  // Authentication itself is business behaviour and is built per App (buildAppDeps), so a
  // change to it ships by push. Only the values that must survive a push live out here.
  const authState = newAuthRuntimeState();

  // Local API token: minted per boot, persisted at <root>/api-token (0600) and published on
  // the runtime auth state, so authMiddleware accepts it as the admin for this process's
  // whole life — across hot swaps too, since the App that verifies it is rebuilt but the
  // file on disk is not rewritten. Local filesystem access to the data root is admin
  // authority (the reset-admin-password rule); see auth/api-token.ts.
  const apiToken = mintApiToken();
  storeApiToken(config.root, apiToken);
  authState.apiToken = apiToken;

  // Install identity: minted here so a root gets its name the first time it is used rather
  // than on the first browser request, which keeps `<root>/install-id` alongside the other
  // files a boot creates and makes the id observable to the CLI and to tests. The return
  // value is deliberately unused — GET /api/install re-reads the file per request (see
  // http/routes/install.ts); this call exists for the minting side effect. Nothing fails
  // when it cannot be persisted: the browser then simply never sweeps.
  ensureInstallId(config.root);

  // The capability set buildAppDeps claims (see hmr/capabilities.ts) — every
  // entry must be in place before ensure() below performs the first boot. The interface
  // descriptor leads: it is what a bundle's handshake reads before trusting any of the rest.
  hmr.resources.register(RUNTIME_INTERFACES_RESOURCE_ID, RUNTIME_INTERFACES);
  hmr.resources.register(RUNTIME_CONFIG_RESOURCE_ID, config);
  hmr.resources.register(RUNTIME_DB_RESOURCE_ID, db);
  hmr.resources.register(RUNTIME_AUTH_STATE_RESOURCE_ID, authState);
  hmr.resources.register(RUNTIME_CHANNELS_RESOURCE_ID, channels);
  hmr.resources.register(RUNTIME_PROXY_RESOURCE_ID, applyProxySettings);
  hmr.resources.register(RUNTIME_HMR_RESOURCE_ID, hmr);
  hmr.resources.register(RUNTIME_OVERRIDES_RESOURCE_ID, replacements);
  const desktop = config.desktopToken !== null ? new DesktopService(config.desktopToken) : null;
  hmr.resources.register(RUNTIME_DESKTOP_RESOURCE_ID, desktop);
  // The registry sweep only STARTS plugin disposal (its disposers are sync) — the
  // fallback for exit paths that skip the graceful shutdown. The graceful path awaits
  // host.dispose() itself, bounded (index.ts); dispose is idempotent, so both may fire.
  if (plugins !== undefined) {
    hmr.resources.register(PLUGINS_RESOURCE_ID, plugins, () => void plugins.dispose());
  }

  // Boot the platform now rather than on the first request: the business surface —
  // services, routes, the scheduler — is assembled inside its create(). The check reads
  // the in-process api member, not a registry entry: the instance IS the current App.
  const instance = await hmr.ensure();
  const tree = instance.api.business();
  if (tree === null) {
    throw new Error("the packaged platform built no business surface");
  }
  // Callers that outlive swaps (index.ts, the runtime app) may only touch the swap-stable
  // members: the runtime singletons published above. The tree is THIS generation's and
  // goes stale at the next push — per-request business dispatch rides the seam.
  return { config, db, channels, hmr, desktop, tree };
}

/** Assembles the Hono app (does not listen on a port). */
export function createRuntimeApp(boot: ServerBoot): Hono<AppEnv> {
  const { tree } = boot;
  const errors = tree.api<Errors>("ObservabilityModule", "Errors");
  const log = tree.api<{ line(text: string): void }>("RuntimeModule", "Log");
  const settings = tree.api<Settings>("SettingsModule", "Settings");
  const access = tree.api<Access>("ProjectsModule", "Access");
  const authService = tree.api<Auth>("IdentityModule", "Auth");
  const deps = {
    config: boot.config,
    desktop: boot.desktop,
    authService,
    hmr: boot.hmr,
    channels: boot.channels,
  };
  const app = new Hono<AppEnv>();

  // Error recording is layered in a lambda wrapping onError: handleError stays a
  // pure function with unchanged behavior (HttpError is mapped as-is, unknown
  // exceptions are logged with a stack trace and collapsed to 500), and recording
  // to the DB is just a side-effect layered on top.
  app.onError((err, c) => {
    const projectId = attributedProjectId(c, { access });
    errors.record({
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
    log.line(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
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
    const size = bodyLimitBytes(settings.getAttachmentLimitsMb());
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
  // Hot platform APIs run their own gate — the network gate, then the SAME auth middleware
  // the routes below use (the boot's local API token as `Authorization: Bearer`, or an admin
  // cookie session) with an admin check on top; see hmr/routes.ts. That is why they mount
  // above the blanket /api/* middleware rather than under it.
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
 * The SPA's caching contract, without which a hot-pushed web is invisible to returning
 * clients until they happen to hard-refresh:
 *
 * - Vite's `assets/*` files are content-hashed, so their bytes can never change under
 *   their name → cache forever, never revalidate.
 * - Everything else — `index.html` above all, including every SPA-fallback answer — must
 *   revalidate on each navigation (`no-cache` means "store, but ask first"), and the ETag
 *   makes that ask a 304 instead of a re-download. A web push changes the ETag, so the
 *   very next load anywhere picks the new app up.
 */
function cacheControlFor(servedPath: string): string {
  return servedPath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

/** Content ETags for the in-memory dist, computed once per Buffer (pushes swap the Buffers). */
const memEtags = new WeakMap<Buffer, string>();

function etagOfBuffer(content: Buffer): string {
  let etag = memEtags.get(content);
  if (etag === undefined) {
    etag = `"${createHash("sha256").update(content).digest("base64url").slice(0, 16)}"`;
    memEtags.set(content, etag);
  }
  return etag;
}

/**
 * Whether `If-None-Match` claims this exact representation, per RFC 9110's rules rather than
 * by string equality — both of which a real deployment hits:
 *
 * - It is a LIST. A client holding several validators sends `"a", "b"`.
 * - Comparison is WEAK, so `W/"x"` and `"x"` are the same tag. A proxy that re-encodes a
 *   response (nginx's gzip module is the common one) downgrades a strong ETag to weak on the
 *   way out, and the client sends back what it was given.
 *
 * Getting this wrong costs only 304s — the bytes are still correct — which is exactly why it
 * would never be noticed, and why it is worth a few lines rather than a string compare.
 */
function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  // `*` means "any current representation": for a resource that exists, that is a match.
  if (header.trim() === "*") return true;
  const want = bare(etag);
  return header.split(",").some((tag) => bare(tag) === want);
}

/**
 * Extensions worth compressing. Everything absent is either already compressed (png, woff2,
 * ico) or too small for the round trip to pay for the CPU — recompressing a PNG spends time
 * to make the response slightly larger.
 */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".map", ".txt"]);

/**
 * Below this, compression is not worth doing: a few hundred bytes rarely shrink past the
 * gzip header, and the transfer was never the cost at that size.
 */
const COMPRESS_MIN_BYTES = 1024;

/**
 * The best encoding this client accepts, or null for none.
 *
 * Brotli first — on the app bundle it is meaningfully smaller than gzip, and everything that
 * speaks it also speaks gzip, so the fallback is free. Parsed rather than substring-matched
 * because `q=0` means REFUSED: a client that sends `gzip;q=0` is saying "not gzip", and a
 * naive `includes("gzip")` reads that as consent and returns bytes it cannot decode.
 */
function pickEncoding(header: string | undefined): "br" | "gzip" | null {
  if (header === undefined) return null;
  const accepted = new Set<string>();
  for (const part of header.split(",")) {
    const [rawToken, ...params] = part.split(";");
    const token = (rawToken ?? "").trim().toLowerCase();
    const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/i.exec(p)).find((m) => m !== null)?.[1];
    if (q !== undefined && Number.parseFloat(q) === 0) continue;
    accepted.add(token);
  }
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return null;
}

/**
 * Compressed bodies, keyed by `<encoding> <etag>` — the ETag already identifies one exact
 * representation, so it is the only key this needs, and it changes when the bytes do.
 *
 * Cached because the alternative is compressing the same 1.2 MB bundle on every page load.
 * Bounded and insertion-ordered (oldest evicted first): a dist is tens of files, but a hot
 * push replaces all of them, and nothing should grow without a ceiling across a long uptime.
 */
const COMPRESSED_CACHE_ENTRIES = 128;
const compressedCache = new Map<string, Buffer>();

function compressedBody(content: Buffer, encoding: "br" | "gzip", etag: string): Buffer {
  const key = `${encoding} ${etag}`;
  const hit = compressedCache.get(key);
  if (hit !== undefined) return hit;
  const body =
    encoding === "br"
      ? zlib.brotliCompressSync(content, {
          params: {
            // Text mode and the real size let brotli pick its window; quality 5 is the knee
            // of the curve — near-max ratio for a fraction of the time of 11, which on a
            // megabyte is the difference between imperceptible and a visible stall.
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.byteLength,
          },
        })
      : zlib.gzipSync(content, { level: 6 });
  if (compressedCache.size >= COMPRESSED_CACHE_ENTRIES) {
    const oldest = compressedCache.keys().next();
    if (!oldest.done) compressedCache.delete(oldest.value);
  }
  compressedCache.set(key, body);
  return body;
}

/** The static response for one resolved file: 304 on an ETag match, the bytes otherwise. */
function staticResponse(
  c: Context<AppEnv>,
  content: Buffer,
  servedPath: string,
  etag: string,
): Response {
  const ext = path.extname(servedPath).toLowerCase();
  const mayCompress = COMPRESSIBLE.has(ext) && content.byteLength >= COMPRESS_MIN_BYTES;
  // Chosen BEFORE the 304, because it decides which representation is being talked about —
  // and a 304 has to carry the validator of the one the client would have got.
  const encoding = mayCompress ? pickEncoding(c.req.header("accept-encoding")) : null;
  // Weakened when compressed, as a re-encoding proxy would: those bytes are a different
  // representation of the same thing, and a weak validator is exactly the claim "equivalent,
  // not identical". Revalidation matches either spelling — ifNoneMatchHits compares weakly.
  const responseEtag = encoding !== null && !etag.startsWith("W/") ? `W/${etag}` : etag;
  const headers: Record<string, string> = {
    "Cache-Control": cacheControlFor(servedPath),
    ETag: responseEtag,
  };
  // Announced whenever the answer COULD have varied — on the 304 too, and even when this
  // particular client took no encoding: a shared cache keys on what the header says, so
  // leaving it off is how one client's gzip reaches another that cannot read it.
  if (mayCompress) headers["Vary"] = "Accept-Encoding";
  if (ifNoneMatchHits(c.req.header("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers["Content-Type"] = CONTENT_TYPES[ext] ?? "application/octet-stream";
  if (encoding === null) {
    return new Response(new Uint8Array(content), { status: 200, headers });
  }
  headers["Content-Encoding"] = encoding;
  return new Response(new Uint8Array(compressedBody(content, encoding, etag)), {
    status: 200,
    headers,
  });
}

/**
 * Minimal static file server (avoiding an extra dependency): path traversal
 * protection + SPA fallback, over either an in-memory pushed/restored dist (the
 * hot host's primary path — no filesystem at all) or the packaged webDist
 * directory on disk. Serves the caching contract above, so pushes take effect
 * on the next navigation and hashed assets stop re-downloading.
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
      return staticResponse(c, content, servedPath, etagOfBuffer(content));
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
    let mtimeMs = 0;
    try {
      // ONE handle for both, not stat-then-read: a handle names an inode, so the validator
      // is guaranteed to describe the bytes being sent. Read and stat as separate lookups
      // can straddle a file replacement and tag old bytes with a new mtime — after which
      // the client revalidates, matches, and keeps the stale copy indefinitely.
      const handle = await fsp.open(file, "r");
      try {
        mtimeMs = (await handle.stat()).mtimeMs;
        content = await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch {
      return c.json(errorBody("not_found", "Resource does not exist."), 404);
    }
    // A weak size+mtime validator, the classic disk-file shape — hashing every
    // response would cost more than the 304s save.
    const etag = `W/"${content.byteLength}-${Math.round(mtimeMs)}"`;
    return staticResponse(c, content, path.relative(base, file).split(path.sep).join("/"), etag);
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
