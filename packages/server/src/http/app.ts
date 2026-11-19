import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque, Slot, ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { Config, Log } from "../hmr/capabilities.js";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  authMiddleware,
  bearerToken,
  jsonOnlyWrites,
  sameOriginWrites,
} from "../auth/middleware.js";
import { AMSP_PREFIX, amspAllowOrigin } from "../amsp/cors.js";
import { HttpError, handleError } from "./errors.js";
import { originRule } from "./public-origin.js";
import { ownOriginRule } from "./own-origin.js";
import type { OwnOrigin } from "./own-origin.js";
import { mostSpecific } from "./route-prefix.js";
import { attributedProjectId } from "./attribution.js";
import { jsonCompression } from "./json-compression.js";
import { jsonValidators } from "./json-validators.js";
import { bodyLimitBytes } from "@prismshadow/penguin-library-setting/attachment-limits";
import { isAgentImport, MAX_PACKAGE_BYTES } from "../services/agent-zip.js";
import { declined } from "../hmr/hono-seam.js";
import type { Auth, Users } from "@prismshadow/penguin-library-auth";
import type { Access } from "@prismshadow/penguin-library-project";
import type { Errors } from "@prismshadow/penguin-library-observability";
import type { Settings } from "@prismshadow/penguin-library-setting";

/**
 * The assembled business surface: one request in, one response (or a decline) out.
 *
 * `fetchAs` is the same surface entered as a user already established by other means — the
 * API socket (socket/serve.ts), whose handshake the runtime authenticated and whose owner it
 * checked before the platform ever saw the socket. Those requests carry no cookie, so the
 * gate in front of the routes is not the cookie one but "this user": the routes themselves,
 * their authorization and their errors are identical.
 */
@Interface()
export abstract class Http {
  abstract fetch(request: Opaque<"Request", Request>): Promise<Opaque<"Response", Response>>;
  abstract fetchAs(
    userId: string,
    request: Opaque<"Request", Request>,
  ): Promise<Opaque<"Response", Response>>;
  /**
   * Hands a WebSocket upgrade to the contributed endpoint (`HttpModule.upgrades`) whose prefix
   * covers its path most specifically, and answers true; false when none does, leaving the socket
   * untouched. The runtime asks this per upgrade of the generation current at that moment
   * (hmr/upgrade-seam.ts): a socket cannot cross the HTTP seam, so this is the in-process half.
   */
  abstract upgrade(
    request: Opaque<"IncomingMessage", IncomingMessage>,
    socket: Opaque<"Duplex", Duplex>,
    head: Opaque<"Buffer", Buffer>,
  ): boolean;
  /**
   * Whether the route group serving `path` judges its callers' origin itself (`origin: "own"`,
   * http/own-origin.ts). The runtime's own copy of the same-origin rule, in front of the seam,
   * asks this too (app.ts).
   */
  abstract ownOrigin(path: string): boolean;
}

/**
 * A WebSocket endpoint's code half: it receives the upgrade request untouched — nothing has
 * answered or read it — and owns the handshake. It refuses by writing a status line and
 * destroying the socket, or upgrades it (with `ws`'s `handleUpgrade`, say) and holds the
 * connection from then on. The connection belongs to the generation that contributed the
 * endpoint: its module closes it on dispose, and the client reconnects to the next one.
 */
export interface WebSocketUpgrade {
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export interface HttpSlots {
  /**
   * A route group. `auth: "user"` accepts a cookie or the local API token; `"token"` accepts
   * only the local API token, without renewing cookies; `"none"` is public. `order` is the
   * mount position (a stable number, since Hono matches in order). `origin: "own"` says the
   * group judges its callers' origin itself (a caller that is cross-origin by design, such as a
   * browser extension), so the same-origin rule for writes does not apply to the paths it
   * covers (http/own-origin.ts). The code half is the Hono app.
   */
  routes: Slot<
    { prefix: string; auth: "user" | "token" | "none"; order: number; origin?: "own" },
    Opaque<"Hono", Hono<AppEnv>>
  >;
  /**
   * A WebSocket endpoint: the upgrades whose path `prefix` covers (that path, or below it) are
   * handed to the code half. The runtime's own upgrades (a terminal's stream, the API socket)
   * are never offered here.
   */
  upgrades: Slot<{ prefix: string }, Opaque<"WebSocketUpgrade", WebSocketUpgrade>>;
}

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
        auth: c.data.auth as "user" | "token" | "none",
        order: c.data.order as number,
        ...(c.data.origin === "own" ? { origin: "own" as const } : {}),
        app: c.code as Hono<AppEnv>,
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const ownOrigin = ownOriginRule(routes);
    const upgrades = [...(contributions.upgrades ?? [])]
      .map((c) => ({ id: c.id, prefix: c.data.prefix as string, code: c.code as WebSocketUpgrade }))
      .sort((a, b) => a.id.localeCompare(b.id));

    // The HTTP surface, gated on the cookie; and the same surface once per socket user,
    // gated on that user — assembled lazily, since most users never open a socket, and kept,
    // since the one who did opens it on every page load. Hono copies a group's routes into
    // each parent it is mounted on, so mounting the groups twice shares handlers, not state.
    const cookieGated = this.assemble(
      routes,
      authMiddleware(this.auth, this.config.trustProxy),
      ownOrigin,
    );
    const asUser = new Map<string, Hono<AppEnv>>();
    const enteredAs = (userId: string): Hono<AppEnv> => {
      let app = asUser.get(userId);
      if (app === undefined) {
        app = this.assemble(
          routes,
          async (c, next) => {
            const user = this.users.findById(userId);
            if (user === null) throw new HttpError(401, "unauthorized", "Unknown user.");
            c.set("user", user);
            // The handshake does not say how the cookie behind it was minted, so the most
            // demanding kind is assumed; the routes whose answer turns on the kind never reach
            // here, the socket declines them for HTTP (api/types.ts sessionKindPath).
            c.set("sessionVia", "password");
            await next();
          },
          ownOrigin,
        );
        asUser.set(userId, app);
      }
      return app;
    };
    this.http = {
      fetch: (request: Request) => Promise.resolve(cookieGated.fetch(request)),
      fetchAs: (userId: string, request: Request) =>
        Promise.resolve(enteredAs(userId).fetch(request)),
      upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        const endpoint = mostSpecific(upgrades, path)[0];
        if (endpoint === undefined) return false;
        endpoint.code.upgrade(request, socket, head);
        return true;
      },
      ownOrigin,
    };
  }

  /** The whole surface behind one gate: error handling, logging, body cap, JSON-only writes, the runtime-prefix decline, then every group in order. */
  private assemble(
    routes: { prefix: string; auth: "user" | "token" | "none"; order: number; app: Hono<AppEnv> }[],
    gate: MiddlewareHandler<AppEnv>,
    ownOrigin: OwnOrigin,
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
    // Every JSON answer under the API — this server's own and those it relays from a machine —
    // carries a validator and answers a caller who holds it with a 304 (json-validators.ts), and
    // is compressed for a caller that asks (json-compression.ts). Inside the request line, so it
    // logs the 304; compression outside the validator, so it encodes what the validator kept.
    for (const scope of ["/api/*", "/server/*"]) {
      app.use(scope, jsonCompression());
      app.use(scope, jsonValidators());
    }
    // The same header the host layer puts ahead of its copies of these two checks (src/app.ts):
    // their refusals answer before the Agent API's group runs, and a browser caller must read the
    // code, not a CORS failure.
    app.use(`${AMSP_PREFIX}/*`, amspAllowOrigin);
    let capped: { size: number; mw: MiddlewareHandler } | null = null;
    app.use("/api/*", (c, next) => {
      // An Agent package is uploaded raw, under the package cap rather than the attachment budget.
      const size = isAgentImport(c.req.method, c.req.path)
        ? MAX_PACKAGE_BYTES
        : bodyLimitBytes(this.settings.getAttachmentLimitsMb());
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
    const origins = originRule(this.config);
    app.use("/api/*", sameOriginWrites(origins, ownOrigin));
    // A machine's API is reached through this server (machines/proxy.ts), with this server's
    // cookie: the same question, asked here because the hop drops the Origin.
    app.use("/server/*", sameOriginWrites(origins));
    app.use("/api/*", jsonOnlyWrites(origins));

    // A group's own auth declaration applies to both HTTP and socket calls, independent of order.
    const authenticate = gate;
    const authenticateToken = authMiddleware(this.auth, this.config.trustProxy, {
      apiTokenOnly: true,
    });
    const once: MiddlewareHandler<AppEnv> = (c, next) =>
      (c.var.user as AppEnv["Variables"]["user"] | undefined) === undefined
        ? authenticate(c, next)
        : next();
    // Only an actual Bearer may exchange credentials: a cookie an earlier user gate already
    // authenticated (a Remote one included) must not skip this transport check.
    const tokenGate: MiddlewareHandler<AppEnv> = (c, next) =>
      c.var.sessionVia === "token" && bearerToken(c.req.header("authorization")) !== null
        ? next()
        : authenticateToken(c, next);
    for (const r of routes) {
      // Each group keeps its own gate, including protected prefixes outside /api.
      if (r.auth === "user") app.use(`${r.prefix.replace(/\/$/, "")}/*`, once);
      if (r.auth === "token") app.use(`${r.prefix.replace(/\/$/, "")}/*`, tokenGate);
      app.route(r.prefix, r.app);
    }
    return app;
  }
}
