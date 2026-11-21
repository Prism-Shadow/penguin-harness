/**
 * Auth Refiners (`<roleOrRoute>@<refinerId>`): lightweight, scoped authorization scripts
 * that refine role or route grants without exploding the declarative Role Tree.
 *
 * Syntax examples:
 * - `agent.maintain@self`
 * - `agent.maintain@withAsk`
 *
 * Design guarantees:
 * 1. Scoped O(1) dispatch: each refiner declares its `scope` (route IDs, role node names,
 *    or domain prefixes like `"agent."`). During request authorization, only the refiner IDs
 *    bound to the matched `routeId` are looked up by ID in O(1) time — never scanning
 *    hundreds of middleware functions across unrelated actions.
 * 2. Deterministic list override: passing an ordered list such as
 *    `[AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]` prioritizes earlier entries
 *    when overriding the same refiner `id`, while falling back to later entries if an
 *    override narrows its `scope` to a specific subdomain.
 * 3. Strict failure semantics & 99.999% match safety:
 *    - Referencing an undefined refiner ID is immediately rejected (`403 auth_refiner_undefined`).
 *    - If a session's refiner fails to match the target action's scope or throws, the server
 *      rejects the request (`403 auth_refiner_mismatch`) and instructs the user to start the
 *      Agent with `admin` permission to repair its configuration.
 *    - Built-in `@self` and `@withAsk` cover all role domains, unconditional `.read` base tiers
 *      automatically bypass redundant refiners during role-tree expansion, and role-named scopes
 *      expand statically to exact route IDs so mismatches do not occur in normal operation.
 */
import {
  Bind,
  Component,
  moduleMetaOf,
  type ModuleClass,
  type Opaque,
} from "@prismshadow/penguin-core/kernel";
import {
  DEFAULT_ROLE_REGISTRY,
  RoleRegistry,
  routePatternMatches,
} from "./agent-roles.js";

/** The authenticated Agent session context passed to `AuthRefiner.authenticate`. */
export interface AuthRefinerContext {
  readonly projectId: string;
  readonly agentId: string;
  readonly role: string;
  readonly generation: number;
  /**
   * Optional interactive approval callback invoked by `@withAsk` (or custom interactive refiners).
   */
  readonly askApproval?: (action: AuthRefinerAction, request?: Request) => Promise<boolean>;
}

/** The HTTP route action being authorized by an `AuthRefiner`. */
export interface AuthRefinerAction {
  /** Normalized fine-grained HTTP route ID (e.g. `"agent.config.update"`). */
  readonly routeId: string;
  /** HTTP route group ID when mounted as a group (e.g. `"sessions.agent-config"`). */
  readonly groupId?: string;
  /** Uppercase HTTP method (`"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`). */
  readonly method: string;
  /** Request URL pathname. */
  readonly path: string;
  /** Route path parameters extracted by Hono (e.g. `{ projectId: "p1", agentId: "a1" }`). */
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Scope declaration for an `AuthRefiner`: lists the route IDs, role node names
 * (e.g. `"agent.maintain"`), domain prefixes (e.g. `"agent."`), or `"*"` that this
 * refiner matches.
 */
export interface AuthRefinerScope {
  readonly routes: readonly string[];
}

export type AuthRefinerScopeInput = readonly string[] | AuthRefinerScope;

/** Contract implemented by every Auth Refiner component. */
export interface AuthRefiner {
  authenticate(
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request: Opaque<"Request", Request>,
  ): Promise<boolean>;
}

/** Pre-compiled O(1) lookup structure for a refiner's declared scope. */
export interface CompiledRefinerScope {
  readonly raw: readonly string[];
  readonly wildcard: boolean;
  readonly exactRouteIds: ReadonlySet<string>;
  readonly prefixes: readonly string[];
}

/** Compiles a refiner scope declaration into an O(1) route matcher. */
export function compileRefinerScope(
  scopeInput?: AuthRefinerScopeInput,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): CompiledRefinerScope {
  const rawList =
    scopeInput === undefined
      ? ["*"]
      : Array.isArray(scopeInput)
        ? (scopeInput as readonly string[])
        : (scopeInput as AuthRefinerScope).routes;

  let wildcard = false;
  const exactRouteIds = new Set<string>();
  const prefixes: string[] = [];

  for (const item of rawList) {
    const trimmed = item.trim();
    if (trimmed === "" || trimmed === "*") {
      if (trimmed === "*") wildcard = true;
      continue;
    }
    const normalized = roleRegistry.normalizeRouteId(trimmed);
    if (normalized === "*") {
      wildcard = true;
      continue;
    }
    if (normalized.endsWith(".*") && !normalized.slice(0, -2).includes("*")) {
      prefixes.push(normalized.slice(0, -1));
      continue;
    }
    if (normalized.endsWith(".")) {
      prefixes.push(normalized);
      continue;
    }
    // If the scope names a Role Tree node (e.g. "agent.maintain" or a custom plugin role),
    // include all leaf routes in that role as well as the prefix if it names a domain root.
    if (roleRegistry.isRole(normalized)) {
      for (const routeId of roleRegistry.expandRoleGrant(normalized).apiIds) {
        exactRouteIds.add(routeId);
      }
      continue;
    }
    // Check if it is a known leaf route ID; if it is a bare domain name (e.g. "agent"), treat as prefix "agent."
    if (roleRegistry.allHttpRouteIds.includes(normalized) || normalized.includes("*")) {
      exactRouteIds.add(normalized);
    } else {
      exactRouteIds.add(normalized);
      prefixes.push(`${normalized}.`);
    }
  }

  return {
    raw: rawList,
    wildcard,
    exactRouteIds,
    prefixes,
  };
}

/** Checks whether a compiled refiner scope covers `routeId`. */
export function matchesRefinerScope(
  scope: CompiledRefinerScope,
  routeId: string,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  if (scope.wildcard) return true;
  const normalized = roleRegistry.normalizeRouteId(routeId);
  if (scope.exactRouteIds.has(normalized) || scope.exactRouteIds.has(routeId)) {
    return true;
  }
  for (const prefix of scope.prefixes) {
    if (normalized.startsWith(prefix) || routeId.startsWith(prefix)) {
      return true;
    }
  }
  for (const pattern of scope.exactRouteIds) {
    if (pattern.includes("*") && routePatternMatches(pattern, normalized, roleRegistry)) {
      return true;
    }
  }
  return false;
}

/**
 * Built-in `@self` refiner (`agent.maintain@self`, `schedule.maintain@self`, etc.).
 * Restricts Agent-scoped mutations to the session's own `agentId` within `ctx.projectId`.
 */
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
          "*",
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
    const targetProjectId = action.params.projectId;
    if (targetProjectId !== undefined && targetProjectId !== ctx.projectId) {
      return false;
    }
    const targetAgentId = action.params.agentId;
    if (targetAgentId !== undefined && targetAgentId !== ctx.agentId) {
      if (action.method === "GET" || action.routeId === "session.create") {
        return true;
      }
      return false;
    }
    return true;
  }
}

/**
 * Built-in `@withAsk` refiner (`agent.maintain@withAsk`, `plugin.maintain@withAsk`, etc.).
 * Requires interactive approval via `ctx.askApproval(action, request)` within `ctx.projectId`.
 */
@Component({
  contributes: {
    "HttpModule.authRefiners": [
      {
        id: "withAsk",
        order: 1000,
        scope: ["*"],
      },
    ],
  },
})
export class AuthWithAskRefiner {
  @Bind("withAsk") readonly refiner: AuthRefiner = this;

  async authenticate(
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request?: Opaque<"Request", Request>,
  ): Promise<boolean> {
    const targetProjectId = action.params.projectId;
    if (targetProjectId !== undefined && targetProjectId !== ctx.projectId) {
      return false;
    }
    if (typeof ctx.askApproval !== "function") {
      return false;
    }
    return Boolean(await ctx.askApproval(action, request));
  }
}

/** Default built-in refiner list in priority order. */
export const DEFAULT_AUTH_REFINERS = [AuthWithAskRefiner, AuthSelfRefiner] as const;

export interface RegisteredAuthRefiner {
  readonly id: string;
  readonly scope: CompiledRefinerScope;
  readonly refiner: AuthRefiner;
}

export type AuthRefinerClass = new () => AuthRefiner & {
  readonly id?: string;
  readonly scope?: AuthRefinerScopeInput;
};

export interface AuthRefinerDescriptor {
  readonly id: string;
  readonly scope?: AuthRefinerScopeInput;
  readonly refiner?: AuthRefiner;
  readonly authenticate?: (
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request: Opaque<"Request", Request>,
  ) => Promise<boolean> | boolean;
}

export type AuthRefinerInput = AuthRefinerClass | AuthRefinerDescriptor;

export type AuthRefinerEvaluationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "auth_refiner_undefined" | "auth_refiner_mismatch" | "permission_required";
      readonly refinerId: string;
      readonly message: string;
    };

export const ADMIN_REPAIR_INSTRUCTION =
  "Please start the agent with admin permission to repair its authorization configuration.";

/** Extracts one or more `RegisteredAuthRefiner` entries from a class or descriptor. */
function resolveRefinerInput(
  input: AuthRefinerInput,
  roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): RegisteredAuthRefiner[] {
  if (typeof input === "function") {
    const cls = input as AuthRefinerClass & {
      readonly id?: string;
      readonly scope?: AuthRefinerScopeInput;
    };
    const instance = new cls();
    const contributedEntries: Array<{ id: string; scope?: AuthRefinerScopeInput }> = [];
    try {
      const meta = moduleMetaOf(cls as unknown as ModuleClass);
      if (meta.contributes !== undefined) {
        for (const list of Object.values(meta.contributes)) {
          if (!Array.isArray(list)) continue;
          for (const rawItem of list) {
            const item = rawItem as { id?: unknown; scope?: AuthRefinerScopeInput };
            if (typeof item.id === "string" && item.id !== "") {
              contributedEntries.push({
                id: item.id,
                ...(item.scope !== undefined ? { scope: item.scope } : {}),
              });
            }
          }
        }
      }
    } catch {
      // Plain undecorated class: fall through to instance/static id & scope.
    }
    if (contributedEntries.length > 0) {
      return contributedEntries.map((entry) => ({
        id: entry.id,
        scope: compileRefinerScope(entry.scope ?? instance.scope ?? cls.scope, roleRegistry),
        refiner: instance,
      }));
    }
    const fallbackId =
      instance.id ??
      cls.id ??
      cls.name
        .replace(/^Auth/, "")
        .replace(/Refiner$/, "")
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
    return [
      {
        id: fallbackId,
        scope: compileRefinerScope(instance.scope ?? cls.scope, roleRegistry),
        refiner: instance,
      },
    ];
  }

  const desc = input as AuthRefinerDescriptor;
  const refinerObj: AuthRefiner =
    desc.refiner !== undefined
      ? desc.refiner
      : {
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
      refiner: refinerObj,
    },
  ];
}

/**
 * Registry of Auth Refiners ordered by user-supplied priority list
 * (e.g. `[AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]`) and
 * `HttpModule.authRefiners` slot contributions.
 *
 * Ordering rules:
 * 1. Explicit `refinerList` (when supplied) takes top priority in exact list order.
 * 2. `HttpModule.authRefiners` slot contributions are stably sorted by `data.order ?? 0`
 *    while preserving module `children` list order (`[AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]`)
 *    for equal `order`. Built-in `AuthWithAskRefiner` (`order: 1000`) and `AuthSelfRefiner`
 *    (`order: 1001`) sit after custom/plugin components that omit `order` (default `0`).
 * 3. Built-in `DEFAULT_AUTH_REFINERS` are appended last as a fallback when not already registered.
 *
 * Earlier entries in the list override later entries with the same `id` when their
 * `scope` matches the target action.
 */
export class AuthRefinerRegistry {
  private readonly byId = new Map<string, RegisteredAuthRefiner[]>();
  private readonly orderIndex = new Map<string, number>();
  private readonly roleRegistry: RoleRegistry;

  constructor(
    refinerList: readonly AuthRefinerInput[] = [],
    contributed: ReadonlyArray<{
      readonly id: string;
      readonly data: Record<string, unknown>;
      readonly code?: unknown;
    }> = [],
    roleRegistry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
  ) {
    this.roleRegistry = roleRegistry;
    let rank = 0;
    const register = (entry: RegisteredAuthRefiner) => {
      if (entry.id === "") return;
      let bucket = this.byId.get(entry.id);
      if (bucket === undefined) {
        bucket = [];
        this.byId.set(entry.id, bucket);
        this.orderIndex.set(entry.id, rank++);
      }
      bucket.push(entry);
    };

    // 1. User-supplied ordered list takes top priority in exact list order.
    for (const item of refinerList) {
      for (const entry of resolveRefinerInput(item, this.roleRegistry)) {
        register(entry);
      }
    }

    // 2. Slot contributions from `HttpModule.authRefiners`, stably sorted by `order ?? 0`
    //    so module `children` list order is preserved while custom/plugin refiners (order 0)
    //    precede built-in defaults (`order: 1000` / `1001`).
    const orderedContributed = [...contributed].sort((a, b) => {
      const oa = typeof a.data.order === "number" ? a.data.order : 0;
      const ob = typeof b.data.order === "number" ? b.data.order : 0;
      return oa - ob;
    });
    for (const c of orderedContributed) {
      const code = c.code as AuthRefiner | undefined;
      if (code === undefined || typeof code.authenticate !== "function") continue;
      const rawScope = c.data.scope as AuthRefinerScopeInput | undefined;
      register({
        id: c.id,
        scope: compileRefinerScope(rawScope, this.roleRegistry),
        refiner: code,
      });
    }

    // 3. Ensure built-in defaults (`withAsk`, `self`) are always present as fallback.
    for (const builtin of DEFAULT_AUTH_REFINERS) {
      for (const entry of resolveRefinerInput(builtin, this.roleRegistry)) {
        register(entry);
      }
    }
  }

  /** Whether `refinerId` is defined in this registry. */
  has(refinerId: string): boolean {
    return this.byId.has(refinerId);
  }

  /**
   * Resolves the highest-priority refiner candidate for `refinerId` whose declared `scope`
   * matches `routeId`. Returns:
   * - `{ status: "undefined" }` if `refinerId` is not registered at all;
   * - `{ status: "mismatch" }` if `refinerId` is registered, but none of its candidates cover `routeId`;
   * - `{ status: "matched", entry }` with the winning `RegisteredAuthRefiner`.
   */
  resolveForRoute(
    refinerId: string,
    routeId: string,
  ):
    | { readonly status: "undefined" }
    | { readonly status: "mismatch" }
    | { readonly status: "matched"; readonly entry: RegisteredAuthRefiner } {
    const candidates = this.byId.get(refinerId);
    if (candidates === undefined || candidates.length === 0) {
      return { status: "undefined" };
    }
    for (const candidate of candidates) {
      if (matchesRefinerScope(candidate.scope, routeId, this.roleRegistry)) {
        return { status: "matched", entry: candidate };
      }
    }
    return { status: "mismatch" };
  }

  /** Sorts a set of `refinerIds` according to the registry's priority list order. */
  sortRefinerIds(refinerIds: readonly string[]): string[] {
    return [...refinerIds].sort((a, b) => {
      const ra = this.orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rb = this.orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.localeCompare(b);
    });
  }

  /**
   * Evaluates all `refinerIds` attached to a route in priority order.
   * - Undefined refiner -> immediate reject (`auth_refiner_undefined`).
   * - Scope mismatch or runtime error in session -> reject (`auth_refiner_mismatch`)
   *   requesting the user to start the agent with `admin` permission to repair.
   * - `authenticate` returns `false` -> reject (`permission_required`).
   */
  async evaluate(
    refinerIds: readonly string[],
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request?: Opaque<"Request", Request>,
  ): Promise<AuthRefinerEvaluationResult> {
    if (refinerIds.length === 0) {
      return { ok: true };
    }
    const req: Opaque<"Request", Request> =
      request ??
      new Request(`http://localhost${action.path.startsWith("/") ? action.path : `/${action.path}`}`, {
        method: action.method,
      });
    const orderedIds = this.sortRefinerIds(refinerIds);
    for (const refinerId of orderedIds) {
      const resolved = this.resolveForRoute(refinerId, action.routeId);
      if (resolved.status === "undefined") {
        return {
          ok: false,
          code: "auth_refiner_undefined",
          refinerId,
          message: `Auth refiner "@${refinerId}" is not defined (route "${action.routeId}"). ${ADMIN_REPAIR_INSTRUCTION}`,
        };
      }
      if (resolved.status === "mismatch") {
        return {
          ok: false,
          code: "auth_refiner_mismatch",
          refinerId,
          message: `Auth refiner "@${refinerId}" failed to match action "${action.routeId}" in the current session. ${ADMIN_REPAIR_INSTRUCTION}`,
        };
      }
      let allowed: unknown;
      try {
        allowed = await resolved.entry.refiner.authenticate(ctx, action, req);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          code: "auth_refiner_mismatch",
          refinerId,
          message: `Auth refiner "@${refinerId}" failed while matching action "${action.routeId}" (${detail}). ${ADMIN_REPAIR_INSTRUCTION}`,
        };
      }
      if (typeof allowed !== "boolean") {
        return {
          ok: false,
          code: "auth_refiner_mismatch",
          refinerId,
          message: `Auth refiner "@${refinerId}" returned a non-boolean result for action "${action.routeId}". ${ADMIN_REPAIR_INSTRUCTION}`,
        };
      }
      if (!allowed) {
        return {
          ok: false,
          code: "permission_required",
          refinerId,
          message: `Auth refiner "@${refinerId}" denied action "${action.routeId}" for role "${ctx.role}".`,
        };
      }
    }
    return { ok: true };
  }
}
