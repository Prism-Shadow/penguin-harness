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
import type { Auth, Users } from "../mechanisms/identity.js";
import type { Access } from "../mechanisms/projects.js";
import type { Errors } from "../mechanisms/observability.js";
import type { Settings } from "../mechanisms/settings.js";

/**
 * The assembled business surface: one request in, one response (or a decline) out.
 *
 * `fetchAs` is the same surface entered as a user already established by other means — the
 * API socket (socket/serve.ts), whose handshake the runtime authenticated and whose owner it
 * checked before the platform ever saw the socket. Those requests carry no cookie, so the
 * gate in front of the routes is not the cookie one but "this user": the routes themselves,
 * their authorization and their errors are identical.
 */
export abstract class Http extends Interface<{
  fetch(request: Opaque<"Request", Request>): Promise<Opaque<"Response", Response>>;
  fetchAs(
    userId: string,
    request: Opaque<"Request", Request>,
  ): Promise<Opaque<"Response", Response>>;
}>() {}

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
const HMR_LAYER_PREFIXES = ["/api/auth", "/api/desktop", "/api/hmr"];

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
  @Use() private readonly users!: Users;
  @Provide() http!: Http;
  setup({ contributions }: ClassCtx) {
    const routes = [...(contributions.routes ?? [])]
      .map((c) => ({
        id: c.id,
        prefix: c.data.prefix as string,
        auth: c.data.auth as "user" | "none",
        order: c.data.order as number,
        app: c.code as Hono<AppEnv>,
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    // The HTTP surface, gated on the cookie; and the same surface once per socket user,
    // gated on that user — assembled lazily, since most users never open a socket, and kept,
    // since the one who did opens it on every page load. Hono copies a group's routes into
    // each parent it is mounted on, so mounting the groups twice shares handlers, not state.
    const cookieGated = this.assemble(routes, authMiddleware(this.auth, this.config.trustProxy));
    const asUser = new Map<string, Hono<AppEnv>>();
    const enteredAs = (userId: string): Hono<AppEnv> => {
      let app = asUser.get(userId);
      if (app === undefined) {
        app = this.assemble(routes, async (c, next) => {
          const user = this.users.findById(userId);
          if (user === null) throw new HttpError(401, "unauthorized", "Unknown user.");
          c.set("user", user);
          // The handshake does not say how the cookie behind it was minted, so the most
          // demanding kind is assumed: what needs the old password keeps needing it.
          c.set("sessionVia", "password");
          await next();
        });
        asUser.set(userId, app);
      }
      return app;
    };
    this.http = {
      fetch: (request: Request) => Promise.resolve(cookieGated.fetch(request)),
      fetchAs: (userId: string, request: Request) =>
        Promise.resolve(enteredAs(userId).fetch(request)),
    };
  }

  /** The whole surface behind one gate: error handling, logging, body cap, JSON-only writes, the runtime-prefix decline, then every group in order. */
  private assemble(
    routes: { prefix: string; auth: "user" | "none"; order: number; app: Hono<AppEnv> }[],
    gate: MiddlewareHandler<AppEnv>,
  ): Hono<AppEnv> {
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
    app.use("*", async (c, next) => {
      const start = performance.now();
      await next();
      this.log.line(
        `${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`,
      );
    });
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

    let gated = false;
    let declinedRuntime = false;
    for (const r of routes) {
      // The terminal group (order 0) sits before the runtime-prefix decline, so a matched
      // terminal route ends the chain first; everything after it declines /api/auth etc.
      if (!declinedRuntime && r.order > 0) {
        app.use("*", async (c, next) => {
          const path = c.req.path;
          const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
          if (!PLATFORM_PATHS.some(under) && HMR_LAYER_PREFIXES.some(under)) {
            return declined();
          }
          await next();
        });
        declinedRuntime = true;
      }
      if (r.auth === "user") {
        // Protected routes: cookie -> auth_session -> user. /api/* is gated once, ahead of
        // the first protected group. A protected group under another prefix — the machine
        // proxy at /server/ — is gated on its own prefix: the gate is what puts the user on
        // the context, and a handler reading it behind an ungated prefix would throw.
        if (!gated) {
          app.use("/api/*", gate);
          gated = true;
        }
        if (!r.prefix.startsWith("/api")) {
          app.use(`${r.prefix.replace(/\/$/, "")}/*`, gate);
        }
      }
      app.route(r.prefix, r.app);
    }
    return app;
  }
}
