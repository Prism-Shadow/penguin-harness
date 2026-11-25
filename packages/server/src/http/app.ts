import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
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
import { ownOriginPrefixes } from "./own-origin.js";
import { adoptGroup } from "./foreign-groups.js";
import { upgradeDispatch } from "./upgrade-endpoints.js";
import type { WebSocketUpgrade } from "./upgrade-endpoints.js";
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
import type { AgentAuth, AgentAuthGrant } from "../mechanisms/agent-auth.js";
import {
  DEFAULT_ROLE_REGISTRY,
  RoleRegistry,
  matchesRouteGrant,
  resolveRouteRefiners,
  type RoleContribution,
  type RoleHttpBindingContribution,
} from "../auth/agent-roles.js";
import {
  AuthRefinerRegistry,
  type AuthRefiner,
  type AuthRefinerInput,
} from "../auth/auth-refiners.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL";

/**
 * The assembled business surface: one request in, one response (or a decline) out.
 */
@Interface()
export abstract class Http {
  abstract fetch(request: Opaque<"Request", Request>): Promise<Opaque<"Response", Response>>;
  abstract fetchAs(
    userId: string,
    request: Opaque<"Request", Request>,
  ): Promise<Opaque<"Response", Response>>;
  abstract upgrade(
    request: Opaque<"IncomingMessage", IncomingMessage>,
    socket: Opaque<"Duplex", Duplex>,
    head: Opaque<"Buffer", Buffer>,
  ): boolean;
  abstract ownOrigin(path: string): boolean;
}

export type { UpgradeCaller, WebSocketUpgrade } from "./upgrade-endpoints.js";

export interface HttpSlots {
  routes: Slot<
    {
      method?: HttpMethod;
      prefix: string;
      auth: "user" | "token" | "none";
      order: number;
      origin?: "own";
      role?: string;
      roles?: readonly string[];
    },
    Opaque<"Hono", Hono<AppEnv>>
  >;
  roles: Slot<RoleContribution>;
  roleBindings: Slot<RoleHttpBindingContribution>;
  authRefiners: Slot<
    { scope: readonly string[]; order?: number },
    Opaque<"AuthRefiner", AuthRefiner>
  >;
  upgrades: Slot<
    { prefix: string; auth: "none" | "user" },
    Opaque<"WebSocketUpgrade", WebSocketUpgrade>
  >;
}

/**
 * Extracts one `(method, subPath)` endpoint from a route group as a single-route Hono app
 * mounted at the endpoint's full path, preserving group-wide `ALL /*` middleware and errorHandler.
 */
export function endpointOf(group: Hono<AppEnv>, method: HttpMethod, subPath: string): Hono<AppEnv> {
  const normalized = subPath === "" ? "/" : subPath;
  const middlewares = group.routes.filter((r) => r.method === "ALL" && r.path === "/*");
  const matches = group.routes.filter((r) => r.method === method && r.path === normalized);
  if (matches.length === 0) {
    throw new Error(`No ${method} ${normalized} route found in group`);
  }
  const app = new Hono<AppEnv>();
  const groupErr = (group as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  const appErr = (app as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  if (groupErr !== appErr) app.onError(groupErr);
  for (const mw of middlewares) app.on(method, "/", mw.handler);
  for (const r of matches) app.on(method, "/", r.handler);
  return app;
}

const NON_ELEVATED_USER_ROUTE_PREFIXES = ["session.", "usage."] as const;

async function checkRouteAuth(
  c: Context<AppEnv>,
  routeId: string,
  groupId: string | undefined,
  refinerRegistry: AuthRefinerRegistry,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
  log?: { line(msg: string): void },
  agentAuthService?: AgentAuth,
): Promise<void> {
  const agentAuth = (c.var as AppEnv["Variables"]).agentAuth;
  if (agentAuth === undefined) return;
  const grant = agentAuth.grant as AgentAuthGrant;
  const normalized = roleRegistry.normalizeRouteId(routeId);
  const normalizedGroup =
    groupId !== undefined ? roleRegistry.normalizeRouteId(groupId) : undefined;
  const routeProjectId = c.req.param("projectId");
  if (
    !grant.allEndpoints &&
    routeProjectId !== undefined &&
    routeProjectId !== agentAuth.projectId
  ) {
    const info = roleRegistry.describeRouteAuthFailure(normalized, grant.role, normalizedGroup);
    log?.line(
      `[agent-auth] auth fail: code=permission_required reason=cross_project_denied route=${normalized} role=${grant.role} agent=${agentAuth.projectId}/${agentAuth.agentId} targetProject=${routeProjectId} sourceModule=${info.sourceModule}`,
    );
    throw new HttpError(
      403,
      "permission_required",
      `Agent session for project "${agentAuth.projectId}" cannot access project "${routeProjectId}" (sourceModule: ${info.sourceModule}).`,
      undefined,
      {
        sourceModule: info.sourceModule,
        routeSourceModule: info.routeSourceModule,
        routeId: normalized,
        role: grant.role,
        reason: "cross_project_denied",
      },
    );
  }

  const upgradeRequestEndpoint = `/api/projects/${agentAuth.projectId}/agents/${agentAuth.agentId}/auth/requests`;
  const hasMismatch = Boolean(grant.mismatches?.hasMismatch);

  const isSelfAuthIntrospection =
    (normalized === "agent.auth.get" || normalized === "agent.auth.requestUpgrade") &&
    routeProjectId === agentAuth.projectId &&
    c.req.param("agentId") === agentAuth.agentId;

  const assertSessionTokenStillActive = () => {
    if (
      agentAuth.tokenHash !== undefined &&
      typeof agentAuthService?.isActiveSessionToken === "function" &&
      !agentAuthService.isActiveSessionToken(
        agentAuth.projectId,
        agentAuth.agentId,
        agentAuth.tokenHash,
      )
    ) {
      throw new HttpError(
        401,
        "unauthorized",
        "Agent session token expired or rotated during authorization.",
      );
    }
  };

  assertSessionTokenStillActive();

  let consumedOnce = false;
  if (
    !grant.allEndpoints &&
    !isSelfAuthIntrospection &&
    !matchesRouteGrant(grant.apiIds, normalized, normalizedGroup, roleRegistry)
  ) {
    if (
      agentAuthService?.consumeOnceGrant?.(
        agentAuth.projectId,
        agentAuth.agentId,
        normalized,
        normalizedGroup,
        agentAuth.tokenHash,
      )
    ) {
      consumedOnce = true;
    } else {
      const info = roleRegistry.describeRouteAuthFailure(normalized, grant.role, normalizedGroup);
      log?.line(
        `[agent-auth] auth fail: code=permission_required reason=role_missing_route_grant route=${normalized} role=${grant.role} agent=${agentAuth.projectId}/${agentAuth.agentId} sourceModule=${info.sourceModule} routeSource=${info.routeSourceModule} roleSource=${info.roleSourceModules.join(",") || "none"} bindingSource=${info.bindingSourceModules.join(",") || "none"}`,
      );
      throw new HttpError(
        403,
        "permission_required",
        `Agent role "${grant.role}" does not grant "${normalized}" (sourceModule: ${info.sourceModule}).`,
        undefined,
        {
          sourceModule: info.sourceModule,
          routeSourceModule: info.routeSourceModule,
          ...(info.roleSourceModules.length > 0
            ? { roleSourceModule: info.roleSourceModules.join(",") }
            : {}),
          ...(info.bindingSourceModules.length > 0
            ? { bindingSourceModule: info.bindingSourceModules.join(",") }
            : {}),
          ...(info.requiredRoles.length > 0 ? { requiredRoles: info.requiredRoles.join(",") } : {}),
          ...(info.suggestedWithAsk.length > 0
            ? { suggestedWithAsk: info.suggestedWithAsk.join(",") }
            : {}),
          ...(info.suggestedUpgradeGrants.length > 0
            ? { suggestedUpgradeGrants: info.suggestedUpgradeGrants.join(",") }
            : {}),
          upgradeRequestEndpoint,
          ...(hasMismatch ? { roleMismatch: JSON.stringify(grant.mismatches) } : {}),
          routeId: normalized,
          ...(normalizedGroup !== undefined ? { groupId: normalizedGroup } : {}),
          role: grant.role,
          reason: "role_missing_route_grant",
        },
      );
    }
  }

  const refinerIds = resolveRouteRefiners(grant.apiIds, normalized, normalizedGroup, roleRegistry);
  if (!grant.allEndpoints && !consumedOnce && refinerIds !== undefined && refinerIds.length > 0) {
    const authCtx = {
      projectId: agentAuth.projectId,
      agentId: agentAuth.agentId,
      role: grant.role,
      generation: grant.generation,
      ...(agentAuth.tokenHash !== undefined ? { tokenHash: agentAuth.tokenHash } : {}),
    };
    const authAction = {
      routeId: normalized,
      ...(normalizedGroup !== undefined ? { groupId: normalizedGroup } : {}),
      method: c.req.method.toUpperCase(),
      path: c.req.path,
      params: (c.req.param() ?? {}) as Record<string, string>,
    };
    const nonInteractive = refinerIds.filter((id) => id !== "withAsk");
    let passedNonInteractive = false;
    if (nonInteractive.length > 0 && nonInteractive.length < refinerIds.length) {
      const preEval = await refinerRegistry.evaluate(
        nonInteractive,
        authCtx,
        authAction,
        c.req.raw,
      );
      assertSessionTokenStillActive();
      if (preEval.ok) passedNonInteractive = true;
    }
    if (!passedNonInteractive) {
      if (
        refinerIds.includes("withAsk") &&
        agentAuthService?.consumeOnceGrant?.(
          agentAuth.projectId,
          agentAuth.agentId,
          normalized,
          normalizedGroup,
          agentAuth.tokenHash,
        )
      ) {
        passedNonInteractive = true;
      }
    }
    if (!passedNonInteractive) {
      const targetRefiners =
        nonInteractive.length > 0 && nonInteractive.length < refinerIds.length
          ? ["withAsk"]
          : refinerIds;
      const evalResult = await refinerRegistry.evaluate(
        targetRefiners,
        authCtx,
        authAction,
        c.req.raw,
      );
      assertSessionTokenStillActive();
      if (!evalResult.ok) {
        if (
          evalResult.reason === "refiner_denied" &&
          agentAuthService?.consumeOnceGrant?.(
            agentAuth.projectId,
            agentAuth.agentId,
            normalized,
            normalizedGroup,
            agentAuth.tokenHash,
          )
        ) {
          consumedOnce = true;
        } else {
          const info = roleRegistry.describeRouteAuthFailure(
            normalized,
            grant.role,
            normalizedGroup,
          );
          log?.line(
            `[agent-auth] auth fail: code=${evalResult.code} reason=${evalResult.reason} route=${normalized} role=${grant.role} agent=${agentAuth.projectId}/${agentAuth.agentId} refiner=@${evalResult.refinerId} sourceModule=${evalResult.sourceModule} routeSource=${evalResult.routeSourceModule}`,
          );
          throw new HttpError(403, evalResult.code, evalResult.message, undefined, {
            sourceModule: evalResult.sourceModule,
            routeSourceModule: evalResult.routeSourceModule,
            ...(evalResult.refinerSourceModule !== undefined
              ? { refinerSourceModule: evalResult.refinerSourceModule }
              : {}),
            ...(info.requiredRoles.length > 0
              ? { requiredRoles: info.requiredRoles.join(",") }
              : {}),
            ...(info.suggestedWithAsk.length > 0
              ? { suggestedWithAsk: info.suggestedWithAsk.join(",") }
              : {}),
            ...(info.suggestedUpgradeGrants.length > 0
              ? { suggestedUpgradeGrants: info.suggestedUpgradeGrants.join(",") }
              : {}),
            upgradeRequestEndpoint,
            refinerId: evalResult.refinerId,
            routeId: normalized,
            role: grant.role,
            reason: evalResult.reason,
          });
        }
      }
    }
  }

  assertSessionTokenStillActive();

  if (
    !c.var.user.isAdmin &&
    !NON_ELEVATED_USER_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    c.set("user", { ...c.var.user, isAdmin: true });
  }
}

function withRouteAuth(
  source: Hono<AppEnv>,
  groupId: string,
  refinerRegistry: AuthRefinerRegistry,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
  log?: { line(msg: string): void },
  agentAuthService?: AgentAuth,
): Hono<AppEnv> {
  const normalizedGroup = roleRegistry.normalizeRouteId(groupId);
  if (normalizedGroup === "session.forward") return source;
  const gated = new Hono<AppEnv>();
  const sourceErr = (source as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  const gatedErr = (gated as unknown as { errorHandler: ErrorHandler<AppEnv> }).errorHandler;
  if (sourceErr !== gatedErr) gated.onError(sourceErr);
  const groupMiddlewares: MiddlewareHandler<AppEnv>[] = [];
  let hasConcreteRoute = false;
  for (const route of source.routes) {
    if (route.method === "ALL" && route.path === "/*" && normalizedGroup !== "machine.proxy") {
      if (!hasConcreteRoute) groupMiddlewares.push(route.handler);
      else gated.on(route.method, route.path, route.handler);
      continue;
    }
    hasConcreteRoute = true;
    gated.on(
      route.method,
      route.path,
      async (c, next) => {
        await checkRouteAuth(
          c,
          normalizedGroup,
          normalizedGroup,
          refinerRegistry,
          roleRegistry,
          log,
          agentAuthService,
        );
        await next();
      },
      ...groupMiddlewares,
      route.handler,
    );
  }
  if (!hasConcreteRoute) {
    for (const mw of groupMiddlewares) gated.on("ALL", "/*", mw);
  }
  return gated;
}

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
  private readonly refiners?: readonly AuthRefinerInput[];
  @Provide() http!: Http;

  setup({ contributions }: ClassCtx) {
    const roleRegistry = new RoleRegistry();
    for (const rc of (contributions.roles ?? []) as ReadonlyArray<{
      readonly id: string;
      readonly from?: string;
      readonly data: RoleContribution;
    }>) {
      roleRegistry.registerRole(rc.id, rc.data, rc.from);
      this.agentAuth?.registerRole?.(rc.id, rc.data, rc.from);
    }

    for (const rb of (contributions.roleBindings ?? []) as ReadonlyArray<{
      readonly id: string;
      readonly from?: string;
      readonly data: RoleHttpBindingContribution;
    }>) {
      roleRegistry.registerRoleBinding(rb.data, rb.from);
      this.agentAuth?.registerRoleBinding?.(rb.data, rb.from);
    }

    const rawRoutes = contributions.routes ?? [];
    for (const c of rawRoutes) {
      const role = c.data.role as string | undefined;
      const roles = c.data.roles as readonly string[] | undefined;
      const sourceModule = (c as { readonly from?: string }).from;
      const reg = {
        id: c.id,
        ...(role !== undefined ? { role } : {}),
        ...(roles !== undefined ? { roles } : {}),
        ...(sourceModule !== undefined ? { sourceModule } : {}),
      };
      roleRegistry.registerRoute(reg, sourceModule);
      this.agentAuth?.registerRoute?.(reg, sourceModule);
    }

    const routes = [...rawRoutes]
      .map((c, index) => ({
        id: c.id,
        from: (c as { readonly from?: string }).from ?? "",
        index,
        ...(c.data.method !== undefined ? { method: c.data.method as HttpMethod } : {}),
        prefix: c.data.prefix as string,
        auth: c.data.auth as "user" | "token" | "none",
        order: c.data.order as number,
        ...(c.data.origin === "own" ? { origin: "own" as const } : {}),
        app: c.code as Hono<AppEnv>,
      }))
      .sort((a, b) => a.order - b.order || a.from.localeCompare(b.from) || a.index - b.index);
    for (const r of routes) adoptGroup(r.app);
    const upgrade = upgradeDispatch(
      (contributions.upgrades ?? []).map((c) => ({
        id: c.id,
        prefix: c.data.prefix as string,
        auth: c.data.auth === "user" ? ("user" as const) : ("none" as const),
        code: c.code as WebSocketUpgrade,
      })),
      { auth: this.auth, rule: originRule(this.config), log: (line) => this.log.line(line) },
    );

    const refinerRegistry = new AuthRefinerRegistry(
      this.refiners,
      contributions.authRefiners ?? [],
      roleRegistry,
    );
    if (this.agentAuth !== undefined) {
      refinerRegistry.bindUpgradeDecisionHandler((decision, ctx, action) => {
        if (decision === "allowed_for_agent" || decision === "always_allowed") {
          const now = new Date();
          if (
            ctx.tokenHash !== undefined &&
            typeof this.agentAuth.isActiveSessionToken === "function" &&
            !this.agentAuth.isActiveSessionToken(ctx.projectId, ctx.agentId, ctx.tokenHash, now)
          ) {
            return;
          }
          this.agentAuth.applyUpgradeDecision?.(
            ctx.projectId,
            ctx.agentId,
            [action.routeId],
            decision,
            now,
            ctx.tokenHash,
          );
        }
      });
    }

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

    const cookieGated = this.assemble(
      routes,
      authMiddleware(this.auth, this.config.trustProxy, {
        ...(agentAuthHook !== undefined ? { agentAuth: agentAuthHook } : {}),
      }),
      refinerRegistry,
      roleRegistry,
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
            c.set("sessionVia", "password");
            await next();
          },
          refinerRegistry,
          roleRegistry,
        );
        asUser.set(userId, app);
      }
      return app;
    };
    this.http = {
      fetch: (request: Request) => Promise.resolve(cookieGated.fetch(request)),
      fetchAs: (userId: string, request: Request) =>
        Promise.resolve(enteredAs(userId).fetch(request)),
      upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) =>
        upgrade(request, socket, head),
      ownOrigin: ownOriginPrefixes(routes),
    };
  }

  private assemble(
    routes: {
      id: string;
      method?: HttpMethod;
      prefix: string;
      auth: "user" | "token" | "none";
      order: number;
      origin?: "own";
      app: Hono<AppEnv>;
    }[],
    gate: MiddlewareHandler<AppEnv>,
    refinerRegistry: AuthRefinerRegistry,
    roleRegistry: RoleRegistry,
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
    for (const scope of ["/api/*", "/server/*"]) {
      app.use(scope, jsonCompression());
      app.use(scope, jsonValidators());
    }
    app.use(`${AMSP_PREFIX}/*`, amspAllowOrigin);
    let capped: { size: number; mw: MiddlewareHandler } | null = null;
    app.use("/api/*", (c, next) => {
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

    const authenticate = gate;
    const authenticateToken = authMiddleware(this.auth, this.config.trustProxy, {
      apiTokenOnly: true,
    });
    const once: MiddlewareHandler<AppEnv> = (c, next) =>
      (c.var.user as AppEnv["Variables"]["user"] | undefined) === undefined
        ? authenticate(c, next)
        : next();
    const tokenGate: MiddlewareHandler<AppEnv> = (c, next) =>
      c.var.sessionVia === "token" && bearerToken(c.req.header("authorization")) !== null
        ? next()
        : authenticateToken(c, next);
    const userGatedPrefixes = new Set<string>();
    const tokenGatedPrefixes = new Set<string>();
    const mount = (r: (typeof routes)[number]) => {
      const wildcardPrefix = `${r.prefix.replace(/\/$/, "")}/*`;
      if (r.auth === "user" && !userGatedPrefixes.has(wildcardPrefix)) {
        userGatedPrefixes.add(wildcardPrefix);
        app.use(wildcardPrefix, once);
      }
      if (r.auth === "token" && !tokenGatedPrefixes.has(wildcardPrefix)) {
        tokenGatedPrefixes.add(wildcardPrefix);
        app.use(wildcardPrefix, tokenGate);
      }
      if (r.method !== undefined) {
        if (r.auth === "user") {
          app.on(r.method, r.prefix, once, async (c, next) => {
            await checkRouteAuth(
              c,
              r.id,
              undefined,
              refinerRegistry,
              roleRegistry,
              this.log,
              this.agentAuth,
            );
            await next();
          });
        }
        if (r.auth === "token") app.on(r.method, r.prefix, tokenGate);
        app.route(r.prefix, r.app);
      } else {
        if (r.auth === "user") {
          app.route(
            r.prefix,
            withRouteAuth(r.app, r.id, refinerRegistry, roleRegistry, this.log, this.agentAuth),
          );
        } else {
          app.route(r.prefix, r.app);
        }
      }
    };

    for (const r of routes) {
      if (r.origin !== "own") continue;
      app.use(`${r.prefix.replace(/\/$/, "")}/*`, jsonOnlyWrites(origins));
      mount(r);
    }
    app.use("/api/*", sameOriginWrites(origins));
    app.use("/server/*", sameOriginWrites(origins));
    app.use("/api/*", jsonOnlyWrites(origins));
    for (const r of routes) if (r.origin !== "own") mount(r);
    return app;
  }
}
