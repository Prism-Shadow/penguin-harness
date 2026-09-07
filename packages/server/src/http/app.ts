import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque, Slot, ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { Config, Log } from "../hmr/capabilities.js";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authMiddleware, jsonOnlyWrites } from "../auth/middleware.js";
import { HttpError, handleError } from "./errors.js";
import { attributedProjectId } from "./attribution.js";
import { bodyLimitBytes } from "../services/attachment-limits.js";
import { declined } from "../hmr/hono-seam.js";
import type { Auth } from "../mechanisms/identity.js";
import type { Access } from "../mechanisms/projects.js";
import type { Errors } from "../mechanisms/observability.js";
import type { Settings } from "../mechanisms/settings.js";

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

/**
 * Prefixes the runtime owns; the platform declines them before anything else runs — in
 * particular before the auth gate, which would otherwise 401 an unauthenticated
 * /api/auth/login. `/api/command` used to be on this list and is not any more: what a host
 * command is and does is policy (hmr/README.md), so the platform serves it and the runtime
 * keeps a copy below the seam for a platform that still declines it.
 */
const RUNTIME_PREFIXES = ["/api/auth", "/api/desktop", "/api/hmr"];

/**
 * …and the paths inside those prefixes that the platform DOES serve. `/api/desktop` is the
 * shell's own mechanism surface — a one-shot login token and a process shutdown — but the
 * update relay under it is policy: who may see an update, what consent a download needs,
 * what the page is shown. Checked before the prefixes, so the narrower rule wins.
 */
const PLATFORM_PATHS = ["/api/desktop/update"];

/**
 * The platform's whole HTTP surface, assembled from `HttpModule.routes` contributions: every
 * module that serves requests contributes its groups here as data (prefix, auth, order)
 * and binds the Hono app by id. Adding an endpoint is adding a line to a manifest.
 */
@Module()
export class HttpModule {
  @Use() private readonly config!: Config;
  @Use() private readonly log!: Log;
  @Use() private readonly auth!: Auth;
  @Use() private readonly errors!: Errors;
  @Use() private readonly settings!: Settings;
  @Use() private readonly access!: Access;
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
          const path = c.req.path;
          const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
          if (!PLATFORM_PATHS.some(under) && RUNTIME_PREFIXES.some(under)) {
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
