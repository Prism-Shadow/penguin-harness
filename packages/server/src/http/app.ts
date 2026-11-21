import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque, Slot, ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { Config, Log } from "../hmr/capabilities.js";
import { bodyLimit } from "hono/body-limit";
import {
  authMiddleware,
  bearerToken,
  jsonOnlyWrites,
  sameOriginWrites,
} from "../auth/middleware.js";
import { AMSP_PREFIX, amspAllowOrigin } from "../amsp/cors.js";
import { HttpError, handleError } from "./errors.js";
import { originRule } from "@prismshadow/penguin-library-http/public-origin";
import { attributedProjectId } from "@prismshadow/penguin-library-http/attribution";
import { jsonCompression } from "@prismshadow/penguin-library-http/json-compression";
import { jsonValidators } from "@prismshadow/penguin-library-http/json-validators";
import { bodyLimitBytes } from "@prismshadow/penguin-library-setting/attachment-limits";
import { isAgentImport, MAX_PACKAGE_BYTES } from "../services/agent-zip.js";
import { declined } from "../hmr/hono-seam.js";
import type { Auth, Users } from "@prismshadow/penguin-library-auth";
import type { Access, Projects } from "@prismshadow/penguin-library-project";
import type { Errors } from "@prismshadow/penguin-library-observability";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { AgentAuth } from "../mechanisms/agent-auth.js";
import { normalizeRouteId, resolveHttpRouteId } from "../auth/agent-roles.js";
import {
  AuthRefinerRegistry,
  type AuthRefiner,
  type AuthRefinerAction,
  type AuthRefinerContext,
  type AuthRefinerInput,
} from "../auth/auth-refiners.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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
}

export interface HttpSlots {
  /**
   * A route group or single-method endpoint. `auth: "user"` accepts a cookie, the local API
   * token, or an Agent auth session whose grant includes the route's `id`; `"token"` accepts
   * only the local API token, without renewing cookies; `"none"` is public. `order` is the
   * mount position (a stable number, since Hono matches in order). The code half is the Hono app.
   */
  routes: Slot<
    { method?: HttpMethod; prefix: string; auth: "user" | "token" | "none"; order: number },
    Opaque<"Hono", Hono<AppEnv>>
  >;
  /**
   * An auth refiner (`<roleOrRoute>@<refinerId>`) contributed by a component or plugin.
   * `scope` declares the route IDs, role node names, or domain prefixes (e.g. `["agent."]`)
   * this refiner matches, avoiding middleware scans across unrelated actions.
   */
  authRefiners: Slot<
    { scope: readonly string[] },
    Opaque<"AuthRefiner", AuthRefiner>
  >;
}

/**
 * Extracts one `(method, subPath)` endpoint from a route group as a single-route Hono app
 * mounted at the endpoint's full path (`mergePath(groupPrefix, subPath)`). Any group-wide
 * middleware (`ALL /*`) on the source group runs ahead of the route's own handler on the
 * same `(method, "/")` entry, so mounting the endpoint adds no wildcard middleware.
 */
export function endpointOf(
  group: Hono<AppEnv>,
  method: HttpMethod,
  subPath: string,
): Hono<AppEnv> {
  const normalized = subPath === "" ? "/" : subPath;
  const middlewares = group.routes.filter((r) => r.method === "ALL" && r.path === "/*");
  const matches = group.routes.filter((r) => r.method === method && r.path === normalized);
  if (matches.length === 0) {
    throw new Error(`No ${method} ${normalized} route found in group`);
  }
  const app = new Hono<AppEnv>();
  const groupErr = (group as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  const appErr = (app as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  if (groupErr !== appErr) {
    app.onError(groupErr);
  }
  for (const mw of middlewares) app.on(method, "/", mw.handler);
  for (const r of matches) app.on(method, "/", r.handler);
  return app;
}

/**
 * Checks whether an Agent-authenticated request is granted the matched route's `id`,
 * evaluates any `<roleOrRoute>@<refinerId>` refiners bound to that route, and enforces
 * project and cross-Agent isolation.
 */
async function checkRouteAuth(
  c: Context<AppEnv>,
  routeId: string,
  groupId: string | undefined,
  refinerRegistry: AuthRefinerRegistry,
): Promise<void> {
  const agentAuth = (c.var as AppEnv["Variables"]).agentAuth;
  if (agentAuth === undefined) return;
  const { grant } = agentAuth;
  const normalized = normalizeRouteId(routeId);
  const normalizedGroup = groupId !== undefined ? normalizeRouteId(groupId) : undefined;
  if (
    !grant.allEndpoints &&
    !grant.apiIds.includes(normalized) &&
    !grant.apiIds.includes(routeId) &&
    (normalizedGroup === undefined ||
      (!grant.apiIds.includes(normalizedGroup) && !grant.apiIds.includes(groupId!)))
  ) {
    throw new HttpError(
      403,
      "permission_required",
      `Agent role "${grant.role}" does not grant "${normalized}".`,
    );
  }
  const routeProjectId = c.req.param("projectId");
  if (
    !grant.allEndpoints &&
    routeProjectId !== undefined &&
    routeProjectId !== agentAuth.projectId
  ) {
    throw new HttpError(
      403,
      "permission_required",
      `Agent session for project "${agentAuth.projectId}" cannot access project "${routeProjectId}".`,
    );
  }

  const refinerIds =
    grant.routeRefiners?.[normalized] ??
    grant.routeRefiners?.[routeId] ??
    (normalizedGroup !== undefined ? grant.routeRefiners?.[normalizedGroup] : undefined);
  if (!grant.allEndpoints && refinerIds !== undefined && refinerIds.length > 0) {
    const rawParams = (c.req.param() ?? {}) as Record<string, string>;
    const refinerCtx: AuthRefinerContext = {
      projectId: agentAuth.projectId,
      agentId: agentAuth.agentId,
      role: grant.role,
      generation: grant.generation,
      ...(agentAuth.askApproval !== undefined ? { askApproval: agentAuth.askApproval } : {}),
    };
    const action: AuthRefinerAction = {
      routeId: normalized,
      ...(normalizedGroup !== undefined ? { groupId: normalizedGroup } : {}),
      method: c.req.method.toUpperCase(),
      path: c.req.path,
      params: rawParams,
    };
    const evalResult = await refinerRegistry.evaluate(refinerIds, refinerCtx, action);
    if (!evalResult.ok) {
      throw new HttpError(403, evalResult.code, evalResult.message);
    }
    return;
  }

  const routeAgentId = c.req.param("agentId");
  if (
    !grant.allEndpoints &&
    grant.crossAgent !== true &&
    routeAgentId !== undefined &&
    routeAgentId !== agentAuth.agentId &&
    c.req.method !== "GET" &&
    normalized !== "session.create"
  ) {
    throw new HttpError(
      403,
      "permission_required",
      `Agent session for agent "${agentAuth.agentId}" cannot modify agent "${routeAgentId}".`,
    );
  }
}

function withRouteAuth(
  source: Hono<AppEnv>,
  groupId: string,
  refinerRegistry: AuthRefinerRegistry,
): Hono<AppEnv> {
  const normalizedGroup = normalizeRouteId(groupId);
  if (normalizedGroup === "session.forward") return source;
  const gated = new Hono<AppEnv>();
  const sourceErr = (source as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  const gatedErr = (gated as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  if (sourceErr !== gatedErr) {
    gated.onError(sourceErr);
  }
  for (const route of source.routes) {
    if (
      route.method === "ALL" &&
      route.path === "/*" &&
      normalizedGroup !== "machines.server-proxy"
    ) {
      gated.on(route.method, route.path, route.handler);
      continue;
    }
    const resolvedId = resolveHttpRouteId(normalizedGroup, route.method, route.path);
    gated.on(route.method, route.path, async (c, next) => {
      await checkRouteAuth(c, resolvedId, normalizedGroup, refinerRegistry);
      return route.handler(c, next);
    });
  }
  return gated;
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
  @Use() private readonly agentAuth!: AgentAuth;
  @Use() private readonly errors!: Errors;
  @Use() private readonly settings!: Settings;
  @Use() private readonly access!: Access;
  @Use() private readonly projects!: Projects;
  @Use() private readonly users!: Users;
  /** Optional priority-ordered refiner list (`[AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]`). */
  private readonly refiners?: readonly AuthRefinerInput[];
  @Provide() http!: Http;
  setup({ contributions }: ClassCtx) {
    const routes = [...(contributions.routes ?? [])]
      .map((c) => ({
        id: c.id,
        ...(c.data.method !== undefined ? { method: c.data.method as HttpMethod } : {}),
        prefix: c.data.prefix as string,
        auth: c.data.auth as "user" | "token" | "none",
        order: c.data.order as number,
        app: c.code as Hono<AppEnv>,
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    const refinerRegistry = new AuthRefinerRegistry(
      this.refiners,
      contributions.authRefiners ?? [],
    );

    const agentAuthHook =
      this.agentAuth !== undefined
        ? {
            authenticate: (bearer: string, now: Date) => this.agentAuth.authenticate(bearer, now),
            resolveUser: (projectId: string) => {
              const project = this.projects?.findById(projectId);
              if (project !== null && project !== undefined) {
                const owner = this.users?.findById(project.ownerUserId);
                if (owner !== null && owner !== undefined) return owner;
              }
              return this.users?.findById("admin") ?? null;
            },
          }
        : undefined;

    // The HTTP surface, gated on the cookie; and the same surface once per socket user,
    // gated on that user — assembled lazily, since most users never open a socket, and kept,
    // since the one who did opens it on every page load. Hono copies a group's routes into
    // each parent it is mounted on, so mounting the groups twice shares handlers, not state.
    const cookieGated = this.assemble(
      routes,
      authMiddleware(this.auth, this.config.trustProxy, {
        ...(agentAuthHook !== undefined ? { agentAuth: agentAuthHook } : {}),
      }),
      refinerRegistry,
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
          refinerRegistry,
        );
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
    routes: {
      id: string;
      method?: HttpMethod;
      prefix: string;
      auth: "user" | "token" | "none";
      order: number;
      app: Hono<AppEnv>;
    }[],
    gate: MiddlewareHandler<AppEnv>,
    refinerRegistry: AuthRefinerRegistry,
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
    app.use("/api/*", sameOriginWrites(origins));
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
      if (r.method !== undefined) {
        if (r.auth === "user") {
          app.on(r.method, r.prefix, once, async (c, next) => {
            await checkRouteAuth(c, r.id, undefined, refinerRegistry);
            await next();
          });
        }
        if (r.auth === "token") app.on(r.method, r.prefix, tokenGate);
        app.route(r.prefix, r.app);
      } else {
        if (r.auth === "user") {
          app.use(`${r.prefix.replace(/\/$/, "")}/*`, once);
          app.route(r.prefix, withRouteAuth(r.app, r.id, refinerRegistry));
        } else {
          if (r.auth === "token") app.use(`${r.prefix.replace(/\/$/, "")}/*`, tokenGate);
          app.route(r.prefix, r.app);
        }
      }
    }
    return app;
  }
}
