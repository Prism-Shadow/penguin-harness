/**
 * Auth Refiners (`<roleOrRoute>@<refinerId>`): lightweight, scoped authorization components
 * that refine role or route grants (e.g. `agent.maintain@self`, `agent.maintain@withAsk`).
 */
import {
  Bind,
  Component,
  moduleMetaOf,
  type ModuleClass,
  type Opaque,
} from "@prismshadow/penguin-core/kernel";
import { DEFAULT_ROLE_REGISTRY, RoleRegistry } from "./agent-roles.js";

export interface AuthRefinerContext {
  readonly projectId: string;
  readonly agentId: string;
  readonly role: string;
  readonly generation: number;
  readonly tokenHash?: string;
}

export interface AuthRefinerAction {
  readonly routeId: string;
  readonly groupId?: string;
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
}

export type AuthRefinerScopeInput = readonly string[] | { readonly routes: readonly string[] };

export interface AuthRefiner {
  authenticate(
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request: Opaque<"Request", Request>,
  ): Promise<boolean>;
}

export interface CompiledRefinerScope {
  readonly raw: readonly string[];
  readonly wildcard: boolean;
  readonly exactRouteIds: ReadonlySet<string>;
  readonly prefixes: readonly string[];
}

export function compileRefinerScope(
  scopeInput?: AuthRefinerScopeInput,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): CompiledRefinerScope {
  const rawList =
    scopeInput === undefined
      ? ["*"]
      : Array.isArray(scopeInput)
        ? (scopeInput as readonly string[])
        : (scopeInput as { readonly routes: readonly string[] }).routes;

  let wildcard = false;
  const exactRouteIds = new Set<string>();
  const prefixes: string[] = [];

  for (const item of rawList) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const normalized = roleRegistry.normalizeRouteId(trimmed);
    if (trimmed === "*" || normalized === "*") {
      wildcard = true;
    } else if (normalized.endsWith(".*") && !normalized.slice(0, -2).includes("*")) {
      prefixes.push(normalized.slice(0, -1));
    } else if (normalized.endsWith(".")) {
      prefixes.push(normalized);
    } else if (roleRegistry.isRole(normalized)) {
      for (const routeId of roleRegistry.expandRoleGrant(normalized).apiIds) {
        exactRouteIds.add(routeId);
      }
    } else {
      exactRouteIds.add(normalized);
      if (!roleRegistry.allHttpRouteIds.includes(normalized)) prefixes.push(`${normalized}.`);
    }
  }
  return { raw: rawList, wildcard, exactRouteIds, prefixes };
}

export function matchesRefinerScope(
  scope: CompiledRefinerScope,
  routeId: string,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
  refinerId?: string,
  allowStaticallyRefinedFallback = false,
): boolean {
  if (scope.wildcard) return true;
  const normalized = roleRegistry.normalizeRouteId(routeId);
  if (scope.exactRouteIds.has(normalized) || scope.exactRouteIds.has(routeId)) return true;
  if (scope.prefixes.some((p) => normalized.startsWith(p) || routeId.startsWith(p))) return true;
  return (
    allowStaticallyRefinedFallback &&
    refinerId !== undefined &&
    roleRegistry.isStaticallyRefinedRoute(refinerId, normalized)
  );
}

/** Built-in `@self` refiner: restricts Agent-scoped mutations to `ctx.agentId` within `ctx.projectId`. */
@Component({
  contributes: {
    "HttpModule.authRefiners": [
      {
        id: "self",
        order: 1001,
        scope: [
          "agent.",
          "memory.",
          "schedule.",
          "skill.",
          "plugin.",
          "workbench.",
          "vault.",
          "session.",
          "workspace.",
          "agents.messaging.",
          "messaging.",
          "org.",
          "browser.",
          "command.",
          "trace.",
          "benchmark.",
        ],
      },
    ],
  },
})
export class AuthSelfRefiner {
  @Bind("self") readonly refiner: AuthRefiner = this;

  async authenticate(
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    _request?: Opaque<"Request", Request>,
  ): Promise<boolean> {
    if (action.params.projectId !== undefined && action.params.projectId !== ctx.projectId) {
      return false;
    }
    if (action.params.agentId !== undefined && action.params.agentId !== ctx.agentId) {
      return action.method === "GET" || action.routeId === "session.create";
    }
    return true;
  }
}

export type PermissionUpgradeDecision =
  "allowed_once" | "allowed_for_agent" | "always_allowed" | "deny";

export type WithAskDecisionInput =
  boolean | PermissionUpgradeDecision | "once" | "agent" | "always";

export function parseUpgradeDecision(
  raw: WithAskDecisionInput | string | undefined,
): PermissionUpgradeDecision | null {
  if (raw === true || raw === "once" || raw === "allowed_once" || raw === "1") {
    return "allowed_once";
  }
  if (
    raw === "agent" ||
    raw === "allowed_for_agent" ||
    raw === "when_use_this_agent" ||
    raw === "2"
  ) {
    return "allowed_for_agent";
  }
  if (raw === "always" || raw === "always_allowed" || raw === "write_role" || raw === "3") {
    return "always_allowed";
  }
  if (raw === false || raw === "deny" || raw === "denied" || raw === "reject") {
    return "deny";
  }
  return null;
}

export function normalizeUpgradeDecision(
  raw: WithAskDecisionInput | string | undefined,
): PermissionUpgradeDecision {
  return parseUpgradeDecision(raw) ?? "deny";
}

/** Built-in `@withAsk` refiner: requires interactive approval within `ctx.projectId`. */
@Component({
  contributes: {
    "HttpModule.authRefiners": [{ id: "withAsk", order: 1000, scope: ["*"] }],
  },
})
export class AuthWithAskRefiner {
  @Bind("withAsk") readonly refiner: AuthRefiner = this;
  private upgradeHandler?: (
    decision: Exclude<PermissionUpgradeDecision, "deny">,
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
  ) => Promise<void> | void;

  constructor(
    private readonly decide?: (
      ctx: AuthRefinerContext,
      action: AuthRefinerAction,
      request?: Opaque<"Request", Request>,
    ) => Promise<WithAskDecisionInput> | WithAskDecisionInput,
    onUpgradeDecision?: (
      decision: Exclude<PermissionUpgradeDecision, "deny">,
      ctx: AuthRefinerContext,
      action: AuthRefinerAction,
    ) => Promise<void> | void,
  ) {
    if (onUpgradeDecision !== undefined) this.upgradeHandler = onUpgradeDecision;
  }

  setUpgradeDecisionHandler(
    handler: (
      decision: Exclude<PermissionUpgradeDecision, "deny">,
      ctx: AuthRefinerContext,
      action: AuthRefinerAction,
    ) => Promise<void> | void,
  ): void {
    if (this.upgradeHandler === undefined) this.upgradeHandler = handler;
  }

  async authenticate(
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request?: Opaque<"Request", Request>,
  ): Promise<boolean> {
    if (action.params.projectId !== undefined && action.params.projectId !== ctx.projectId) {
      return false;
    }
    if (typeof this.decide !== "function") return false;
    const raw = await this.decide(ctx, action, request);
    const normalized = normalizeUpgradeDecision(raw);
    if (normalized === "deny") return false;
    if (this.upgradeHandler) await this.upgradeHandler(normalized, ctx, action);
    return true;
  }
}

export const DEFAULT_AUTH_REFINERS = [AuthWithAskRefiner, AuthSelfRefiner] as const;

export interface RegisteredAuthRefiner {
  readonly id: string;
  readonly scope: CompiledRefinerScope;
  readonly refiner: AuthRefiner;
  readonly sourceModule: string;
}

export type AuthRefinerClass = new () => AuthRefiner & {
  readonly id?: string;
  readonly scope?: AuthRefinerScopeInput;
  readonly sourceModule?: string;
};

export interface AuthRefinerDescriptor {
  readonly id: string;
  readonly scope?: AuthRefinerScopeInput;
  readonly sourceModule?: string;
  readonly refiner?: AuthRefiner;
  readonly authenticate?: (
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request: Opaque<"Request", Request>,
  ) => Promise<boolean> | boolean;
}

export type AuthRefinerInput = AuthRefinerClass | AuthRefinerDescriptor;

export type AuthRefinerFailureCode =
  "auth_refiner_undefined" | "auth_refiner_mismatch" | "permission_required";

export type AuthRefinerFailureReason =
  "refiner_undefined" | "refiner_scope_mismatch" | "refiner_error" | "refiner_denied";

export type AuthRefinerEvaluationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: AuthRefinerFailureCode;
      readonly refinerId: string;
      readonly sourceModule: string;
      readonly routeSourceModule: string;
      readonly refinerSourceModule?: string;
      readonly reason: AuthRefinerFailureReason;
      readonly message: string;
    };

export const ADMIN_REPAIR_INSTRUCTION =
  "Please start the agent with admin permission to repair its authorization configuration.";

function resolveRefinerInput(
  input: AuthRefinerInput,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): RegisteredAuthRefiner[] {
  if (typeof input === "function") {
    const cls = input as AuthRefinerClass & {
      readonly id?: string;
      readonly scope?: AuthRefinerScopeInput;
      readonly sourceModule?: string;
    };
    const instance = new cls();
    let moduleName = instance.sourceModule ?? cls.sourceModule ?? cls.name ?? "AuthRefiner";
    const entries: Array<{ id: string; scope?: AuthRefinerScopeInput }> = [];
    try {
      const meta = moduleMetaOf(cls as unknown as ModuleClass);
      if (meta.name) moduleName = meta.name;
      for (const list of Object.values(meta.contributes ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const rawItem of list) {
          const item = rawItem as { id?: unknown; scope?: AuthRefinerScopeInput };
          if (typeof item.id === "string" && item.id !== "") {
            entries.push({
              id: item.id,
              ...(item.scope !== undefined ? { scope: item.scope } : {}),
            });
          }
        }
      }
    } catch {
      // Plain undecorated class: fall through to instance/static id & scope.
    }
    if (entries.length > 0) {
      return entries.map((e) => ({
        id: e.id,
        scope: compileRefinerScope(e.scope ?? instance.scope ?? cls.scope, roleRegistry),
        refiner: instance,
        sourceModule: moduleName,
      }));
    }
    const id =
      instance.id ??
      cls.id ??
      cls.name
        .replace(/^Auth/, "")
        .replace(/Refiner$/, "")
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
    return [
      {
        id,
        scope: compileRefinerScope(instance.scope ?? cls.scope, roleRegistry),
        refiner: instance,
        sourceModule: moduleName,
      },
    ];
  }
  const desc = input as AuthRefinerDescriptor;
  const refiner: AuthRefiner = desc.refiner ?? {
    authenticate: async (ctx, action, request) => {
      if (typeof desc.authenticate !== "function") {
        throw new Error(`Refiner "${desc.id}" has no authenticate method.`);
      }
      return Boolean(await desc.authenticate(ctx, action, request));
    },
  };
  return [
    {
      id: desc.id,
      scope: compileRefinerScope(desc.scope, roleRegistry),
      refiner,
      sourceModule: desc.sourceModule ?? desc.id,
    },
  ];
}

export class AuthRefinerRegistry {
  private readonly byId = new Map<string, RegisteredAuthRefiner[]>();
  private readonly orderIndex = new Map<string, number>();
  private readonly roleRegistry: RoleRegistry;

  constructor(
    refinerList: readonly AuthRefinerInput[] = [],
    contributed: ReadonlyArray<{
      readonly id: string;
      readonly from?: string;
      readonly data: Record<string, unknown>;
      readonly code?: unknown;
    }> = [],
    roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
  ) {
    this.roleRegistry = roleRegistry;
    let rank = 0;
    const register = (entry: RegisteredAuthRefiner) => {
      if (!entry.id) return;
      let bucket = this.byId.get(entry.id);
      if (!bucket) {
        bucket = [];
        this.byId.set(entry.id, bucket);
        this.orderIndex.set(entry.id, rank++);
      }
      bucket.push(entry);
    };

    for (const item of refinerList) {
      for (const entry of resolveRefinerInput(item, this.roleRegistry)) register(entry);
    }

    const ordered = [...contributed].sort(
      (a, b) =>
        (typeof a.data.order === "number" ? a.data.order : 0) -
        (typeof b.data.order === "number" ? b.data.order : 0),
    );
    for (const c of ordered) {
      const code = c.code as AuthRefiner | undefined;
      if (code === undefined || typeof code.authenticate !== "function") continue;
      register({
        id: c.id,
        scope: compileRefinerScope(
          c.data.scope as AuthRefinerScopeInput | undefined,
          this.roleRegistry,
        ),
        refiner: code,
        sourceModule: c.from ?? c.id,
      });
    }

    for (const builtin of DEFAULT_AUTH_REFINERS) {
      for (const entry of resolveRefinerInput(builtin, this.roleRegistry)) register(entry);
    }
  }

  has(refinerId: string): boolean {
    return this.byId.has(refinerId);
  }

  bindUpgradeDecisionHandler(
    handler: (
      decision: Exclude<PermissionUpgradeDecision, "deny">,
      ctx: AuthRefinerContext,
      action: AuthRefinerAction,
    ) => Promise<void> | void,
  ): void {
    for (const entries of this.byId.values()) {
      for (const entry of entries) {
        if (entry.refiner instanceof AuthWithAskRefiner) {
          entry.refiner.setUpgradeDecisionHandler(handler);
        }
      }
    }
  }

  resolveForRoute(
    refinerId: string,
    routeId: string,
  ):
    | { readonly status: "undefined" }
    | { readonly status: "mismatch"; readonly refinerSourceModule: string }
    | { readonly status: "matched"; readonly entry: RegisteredAuthRefiner } {
    const candidates = this.byId.get(refinerId);
    if (!candidates || candidates.length === 0) return { status: "undefined" };
    for (const candidate of candidates) {
      if (
        matchesRefinerScope(
          candidate.scope,
          routeId,
          this.roleRegistry,
          refinerId,
          candidate.refiner instanceof AuthSelfRefiner,
        )
      ) {
        return { status: "matched", entry: candidate };
      }
    }
    return { status: "mismatch", refinerSourceModule: candidates[0]?.sourceModule ?? refinerId };
  }

  sortRefinerIds(refinerIds: readonly string[]): string[] {
    return [...refinerIds].sort((a, b) => {
      if (a === "withAsk" && b !== "withAsk") return 1;
      if (b === "withAsk" && a !== "withAsk") return -1;
      const ra = this.orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rb = this.orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.localeCompare(b);
    });
  }

  async evaluate(
    refinerIds: readonly string[],
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request?: Opaque<"Request", Request>,
  ): Promise<AuthRefinerEvaluationResult> {
    if (refinerIds.length === 0) return { ok: true };
    const req: Opaque<"Request", Request> =
      request ??
      new Request(
        `http://localhost${action.path.startsWith("/") ? action.path : `/${action.path}`}`,
        {
          method: action.method,
        },
      );
    const routeSourceModule = this.roleRegistry.getRouteSourceModule(
      action.routeId,
      action.groupId,
    );
    const fail = (
      code: AuthRefinerFailureCode,
      reason: AuthRefinerFailureReason,
      refinerId: string,
      sourceModule: string,
      message: string,
      refinerSourceModule?: string,
    ): AuthRefinerEvaluationResult => ({
      ok: false,
      code,
      refinerId,
      sourceModule,
      routeSourceModule,
      ...(refinerSourceModule !== undefined ? { refinerSourceModule } : {}),
      reason,
      message,
    });

    let lastDenial: AuthRefinerEvaluationResult | null = null;
    for (const refinerId of this.sortRefinerIds(refinerIds)) {
      const resolved = this.resolveForRoute(refinerId, action.routeId);
      if (resolved.status === "undefined") {
        const src =
          this.roleRegistry.getRefinerBindingSource(action.routeId, refinerId, ctx.role) ??
          routeSourceModule;
        return fail(
          "auth_refiner_undefined",
          "refiner_undefined",
          refinerId,
          src,
          `Auth refiner "@${refinerId}" is not defined (route "${action.routeId}", sourceModule: ${src}). ${ADMIN_REPAIR_INSTRUCTION}`,
        );
      }
      if (resolved.status === "mismatch") {
        const src = resolved.refinerSourceModule;
        return fail(
          "auth_refiner_mismatch",
          "refiner_scope_mismatch",
          refinerId,
          src,
          `Auth refiner "@${refinerId}" failed to match action "${action.routeId}" in the current session (sourceModule: ${src}, routeSourceModule: ${routeSourceModule}). ${ADMIN_REPAIR_INSTRUCTION}`,
          src,
        );
      }
      const src = resolved.entry.sourceModule;
      let allowed: unknown;
      try {
        allowed = await resolved.entry.refiner.authenticate(ctx, action, req);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return fail(
          "auth_refiner_mismatch",
          "refiner_error",
          refinerId,
          src,
          `Auth refiner "@${refinerId}" failed while matching action "${action.routeId}" (${detail}) (sourceModule: ${src}, routeSourceModule: ${routeSourceModule}). ${ADMIN_REPAIR_INSTRUCTION}`,
          src,
        );
      }
      if (typeof allowed !== "boolean") {
        return fail(
          "auth_refiner_mismatch",
          "refiner_error",
          refinerId,
          src,
          `Auth refiner "@${refinerId}" returned a non-boolean result for action "${action.routeId}" (sourceModule: ${src}, routeSourceModule: ${routeSourceModule}). ${ADMIN_REPAIR_INSTRUCTION}`,
          src,
        );
      }
      if (allowed) return { ok: true };
      lastDenial = fail(
        "permission_required",
        "refiner_denied",
        refinerId,
        src,
        `Auth refiner "@${refinerId}" denied action "${action.routeId}" for role "${ctx.role}" (sourceModule: ${src}, routeSourceModule: ${routeSourceModule}).`,
        src,
      );
    }
    return lastDenial ?? { ok: true };
  }
}
