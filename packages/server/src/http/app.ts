import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque, Slot, ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { RuntimeModule } from "../hmr/capabilities.js";
import { Config } from "../config.js";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authMiddleware, jsonOnlyWrites } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import { HttpError, handleError } from "./errors.js";
import { attributedProjectId } from "./attribution.js";
import { bodyLimitBytes } from "../services/attachment-limits.js";
import { declined } from "../hmr/hono-seam.js";
import type { ErrorRecorder } from "../runtime/error-recorder.js";
import type { ProjectAccess } from "../services/project-access.js";
import type { ServerSettingsRepo } from "../db/repos/server-settings.js";

/** The assembled business surface: one request in, one response (or a decline) out. */
@Interface()
export abstract class Http {
  abstract fetch(request: Opaque<"Request", Request>): Promise<Opaque<"Response", Response>>;
}

export interface HttpSlots {
  /**
   * A route group. `auth: "user"` mounts it behind the cookie gate, `"none"` in front of
   * it; `order` is the mount position (a stable number, since Hono matches in order). The
   * code half is the group's Hono app.
   */
  routes: Slot<
    { prefix: string; auth: "user" | "none"; order: number },
    Opaque<"Hono", Hono<AppEnv>>
  >;
}

/** Prefixes the runtime owns; the platform declines them before anything else runs — in particular before the auth gate, which would otherwise 401 an unauthenticated /api/auth/login. */
const RUNTIME_PREFIXES = ["/api/auth", "/api/desktop", "/api/hmr"];

/**
 * The platform's whole HTTP surface, assembled from `HttpModule.routes` contributions: every
 * module that serves requests contributes its groups here as data (prefix, auth, order)
 * and binds the Hono app by id. Adding an endpoint is adding a line to a manifest.
 */
@Module()
export class HttpModule {
  @Use(RuntimeModule) private readonly config!: Config;
  @Use() private readonly auth!: AuthService;
  @Use() private readonly errors!: ErrorRecorder;
  @Use() private readonly settings!: ServerSettingsRepo;
  @Use() private readonly access!: ProjectAccess;
  @Provide() http!: Http;
  setup({ contributions }: ClassCtx) {
    const errors = this.errors;
    const access = this.access;
    const app = new Hono<AppEnv>();
    app.onError((err, c) => {
      const projectId = attributedProjectId(c, { access });
      errors.record({
        source: "http",
        err,
        ...(projectId !== undefined ? { ctx: { projectId } } : {}),
      });
      return handleError(err, c);
    });
    app.notFound(() => declined());
    // No request logger here: the runtime app logs every request, this surface's included,
    // before it reaches the seam — a second line per platform-handled request is noise.
    let capped: { size: number; mw: MiddlewareHandler } | null = null;
    app.use("/api/*", (c, next) => {
      const size = bodyLimitBytes(this.settings.getAttachmentLimitsMb());
      if (capped === null || capped.size !== size) {
        capped = {
          size,
          mw: bodyLimit({
            maxSize: size,
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

    const routes = [...(contributions.routes ?? [])]
      .map((c) => ({
        id: c.id,
        prefix: c.data.prefix as string,
        auth: c.data.auth as "user" | "none",
        order: c.data.order as number,
        app: c.code as Hono<AppEnv>,
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    // Protected routes: cookie -> auth_session -> user. Built once, mounted per group.
    const gate = authMiddleware(this.auth, this.config.trustProxy);
    let declinedRuntime = false;
    for (const r of routes) {
      // The terminal group (order 0) sits before the runtime-prefix decline, so a matched
      // terminal route ends the chain first; everything after it declines /api/auth etc.
      if (!declinedRuntime && r.order > 0) {
        app.use("*", async (c, next) => {
          if (RUNTIME_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
            return declined();
          }
          await next();
        });
        declinedRuntime = true;
      }
      // The gate sits on each group that asked for it, not once on `/api/*` at the first
      // such group: a contributor picks its own prefix and order, and `auth` has to mean
      // the same thing wherever the group lands — a public group after a protected one
      // stays public, a protected group outside /api is still protected.
      if (r.auth === "user") {
        const base = r.prefix.replace(/\/$/, "");
        app.use(base === "" ? "/" : base, gate);
        app.use(`${base}/*`, gate);
      }
      app.route(r.prefix, r.app);
    }
    this.http = { fetch: (request: Request) => Promise.resolve(app.fetch(request)) };
  }
}
