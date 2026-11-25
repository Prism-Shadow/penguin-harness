/**
 * Authorization role registry (`RoleRegistry`), declarative role/route/binding contributions,
 * exact route matching (wildcards forbidden), and `sourceModule` failure diagnostics.
 */
import table from "../ifaces.json" with { type: "json" };

export type AgentAuthRole = string;
export type RoleChildRef = string;

export const DEFAULT_AGENT_AUTH_ROLE: AgentAuthRole = "general";

export interface RoleFlags {
  allEndpoints?: boolean;
  agentApi?: boolean;
}

export interface RoleNode {
  children?: readonly RoleChildRef[];
  routes?: readonly string[];
  flags?: RoleFlags;
  sourceModules?: readonly string[];
}

export interface RoleContribution {
  role?: string;
  children?: readonly string[];
  withAsk?: readonly string[];
  routes?: readonly string[];
  flags?: RoleFlags;
  parents?: readonly string[];
  description?: string;
}

/**
 * High-level Agent Role definition: aggregates RoleTree capability nodes (`inherits`),
 * optional `@withAsk`-refined roles/routes (`withAsk`), and explicit routes to restrict Session permissions.
 */
export interface AgentRoleDefinition {
  readonly id: string;
  readonly inherits: readonly string[];
  readonly withAsk?: readonly string[];
  readonly routes?: readonly string[];
  readonly flags?: RoleFlags;
  readonly builtin?: boolean;
  readonly description?: string;
}

export interface RoleGrantMismatches {
  readonly hasMismatch: boolean;
  readonly unknownPrimaryRole: boolean;
  readonly fallbackRole?: string;
  readonly unknownRoles: readonly string[];
  readonly unknownRoutes: readonly string[];
}

export interface RouteRoleRegistration {
  id: string;
  role?: string;
  roles?: readonly string[];
  sourceModule?: string;
}

export interface RoleHttpBindingContribution {
  role?: string;
  routes?: readonly string[];
  bindings?: { readonly [roleId: string]: readonly string[] };
  roles?: { readonly [roleId: string]: readonly string[] };
  aliases?: { readonly [fromPrefix: string]: string };
}

export interface RouteAuthDebugInfo {
  readonly routeId: string;
  readonly groupId?: string;
  readonly role: string;
  readonly sourceModule: string;
  readonly routeSourceModule: string;
  readonly roleSourceModules: readonly string[];
  readonly bindingSourceModules: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly suggestedWithAsk: readonly string[];
  readonly suggestedUpgradeGrants: readonly string[];
}

export interface RefinedGrantRef {
  target: string;
  refinerId: string | null;
}

export interface ExpandedRoleGrant {
  allEndpoints: boolean;
  agentApi: boolean;
  apiIds: ReadonlySet<string>;
  routeRefiners: Record<string, string[]>;
  inheritedRoles: readonly string[];
  unconditionalRoutes: readonly string[];
  mismatches: RoleGrantMismatches;
}

interface MutableRoleNode {
  children: string[];
  routes: string[];
  flags: RoleFlags;
  sourceModules: string[];
}

interface RouteMeta {
  owner?: string;
  bindingSources: Set<string>;
  requiredRoles: Set<string>;
}

const COMPILED_GRANT_META = new WeakMap<
  ReadonlySet<string>,
  {
    readonly unconditionalSet: ReadonlySet<string>;
    readonly routeRefinerMap: ReadonlyMap<string, readonly string[]>;
  }
>();

export function parseRefinedGrant(spec: string): RefinedGrantRef {
  const trimmed = spec.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return { target: trimmed, refinerId: null };
  const target = trimmed.slice(0, atIdx).trim();
  const refinerId = trimmed.slice(atIdx + 1).trim();
  return { target, refinerId: refinerId !== "" ? refinerId : null };
}

export function assertNoWildcard(value: string, context: string): void {
  if (value.includes("*")) {
    throw new Error(
      `Wildcard pattern "${value}" is not allowed in ${context}; declare exact HTTP route IDs or role bindings.`,
    );
  }
}

function candidateIds(reg: RoleRegistry, routeId: string, groupId?: string): readonly string[] {
  const norm = reg.normalizeRouteId(routeId);
  const normGroup = groupId !== undefined ? reg.normalizeRouteId(groupId) : undefined;
  return [norm, routeId, ...(normGroup !== undefined ? [normGroup, groupId!] : [])];
}

export function matchesRouteGrant(
  grantedApiIds: ReadonlySet<string> | readonly string[],
  routeId: string,
  groupId?: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean {
  assertNoWildcard(routeId, "matchesRouteGrant(routeId)");
  if (groupId !== undefined) assertNoWildcard(groupId, "matchesRouteGrant(groupId)");
  const candidates = candidateIds(registry, routeId, groupId);
  if (!Array.isArray(grantedApiIds)) {
    const set = grantedApiIds as ReadonlySet<string>;
    return candidates.some((id) => set.has(id));
  }
  for (const g of grantedApiIds as readonly string[]) {
    assertNoWildcard(g, "matchesRouteGrant(grantedApiIds)");
    if (candidates.includes(g)) return true;
  }
  return false;
}

export function resolveRouteRefiners(
  grantedApiIds: ReadonlySet<string>,
  routeId: string,
  groupId?: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): readonly string[] | undefined {
  const meta = COMPILED_GRANT_META.get(grantedApiIds);
  if (!meta) return undefined;
  const candidates = candidateIds(registry, routeId, groupId);
  if (candidates.some((id) => meta.unconditionalSet.has(id))) return undefined;
  for (const key of candidates) {
    const found = meta.routeRefinerMap.get(key);
    if (found !== undefined) return found;
  }
  return undefined;
}

export class RoleRegistry {
  private readonly tree: Record<string, MutableRoleNode> = {};
  private readonly roleList: string[] = [];
  private readonly allRoutesList: string[] = [];
  private readonly routeMeta = new Map<string, RouteMeta>();
  private readonly prefixAliases: Record<string, string> = {};
  private readonly baseRoleCache = new Map<string, ExpandedRoleGrant>();
  private readonly refinerSources = new Map<string, string>();
  private readonly staticRefiners = new Map<string, { roles: Set<string>; routes: Set<string> }>();
  private readonly agentRoleDefs = new Map<string, AgentRoleDefinition>();
  private registryVersion = 0;

  constructor(options?: { seedBuiltin?: boolean }) {
    if (options?.seedBuiltin !== false) {
      const modules =
        (table as { modules?: Record<string, { contributes?: Record<string, unknown[]> }> })
          .modules ?? {};
      for (const [modName, mod] of Object.entries(modules)) {
        for (const slot of ["AgentAuthPermissionProvider.roles", "HttpModule.roles"]) {
          const items = mod.contributes?.[slot] as
            ReadonlyArray<{ id: string } & RoleContribution> | undefined;
          if (items) for (const item of items) this.registerRole(item.id, item, modName);
        }
      }
      for (const [modName, mod] of Object.entries(modules)) {
        for (const slot of [
          "AgentAuthPermissionProvider.roleBindings",
          "HttpModule.roleBindings",
        ]) {
          const items = mod.contributes?.[slot] as
            ReadonlyArray<RoleHttpBindingContribution> | undefined;
          if (items) for (const item of items) this.registerRoleBinding(item, modName);
        }
      }
      for (const [modName, mod] of Object.entries(modules)) {
        const routes = mod.contributes?.["HttpModule.routes"] as
          ReadonlyArray<RouteRoleRegistration> | undefined;
        if (routes) for (const route of routes) this.registerRoute(route, modName);
      }
    }
  }

  get version(): number {
    return this.registryVersion;
  }
  get roleTree(): Readonly<Record<string, RoleNode>> {
    return this.tree;
  }
  get roles(): readonly string[] {
    return this.roleList;
  }
  get allHttpRouteIds(): readonly string[] {
    return this.allRoutesList;
  }

  private bumpVersion(): void {
    this.registryVersion++;
    this.baseRoleCache.clear();
  }

  private ensureRouteMeta(routeId: string, recordInAllRoutes: boolean): RouteMeta {
    assertNoWildcard(routeId, "routeId");
    let meta = this.routeMeta.get(routeId);
    if (!meta) {
      meta = { bindingSources: new Set(), requiredRoles: new Set() };
      this.routeMeta.set(routeId, meta);
    }
    if (recordInAllRoutes && !this.allRoutesList.includes(routeId))
      this.allRoutesList.push(routeId);
    return meta;
  }

  private ensureRoleNode(roleId: string, sourceModule?: string): MutableRoleNode {
    assertNoWildcard(roleId, "roleId");
    let node = this.tree[roleId];
    if (!node) {
      node = { children: [], routes: [], flags: {}, sourceModules: [] };
      this.tree[roleId] = node;
      this.roleList.push(roleId);
    }
    if (sourceModule && !node.sourceModules.includes(sourceModule))
      node.sourceModules.push(sourceModule);
    return node;
  }

  private recordStaticRefiner(
    kind: "roles" | "routes",
    target: string,
    refinerId: string,
    sourceModule?: string,
  ): void {
    let entry = this.staticRefiners.get(refinerId);
    if (!entry) {
      entry = { roles: new Set(), routes: new Set() };
      this.staticRefiners.set(refinerId, entry);
    }
    entry[kind].add(target);
    if (sourceModule) this.refinerSources.set(`${target}@${refinerId}`, sourceModule);
  }

  isRole(value: string): boolean {
    return Object.hasOwn(this.tree, value);
  }

  isStaticallyRefinedRoute(refinerId: string, routeId: string): boolean {
    const entry = this.staticRefiners.get(refinerId);
    if (!entry) return false;
    const norm = this.normalizeRouteId(routeId);
    if (entry.routes.has(norm) || entry.routes.has(routeId)) return true;
    for (const roleId of entry.roles) {
      const { apiIds } = this.expandRoleGrant(roleId);
      if (apiIds.has(norm) || apiIds.has(routeId)) return true;
    }
    return false;
  }

  getRouteSourceModule(routeId: string, groupId?: string): string {
    const ids = candidateIds(this, routeId, groupId);
    for (const id of ids) {
      const owner = this.routeMeta.get(id)?.owner;
      if (owner) return owner;
    }
    for (const id of ids) {
      const sources = this.routeMeta.get(id)?.bindingSources;
      if (sources && sources.size > 0) return [...sources][0]!;
    }
    return "unknown";
  }

  getRoleSourceModules(roleId: string): readonly string[] {
    return this.tree[parseRefinedGrant(roleId).target]?.sourceModules ?? [];
  }

  getRefinerBindingSource(routeId: string, refinerId: string, roleId?: string): string | undefined {
    const norm = this.normalizeRouteId(routeId);
    if (roleId !== undefined) {
      const byRole =
        this.refinerSources.get(`${parseRefinedGrant(roleId).target}@${refinerId}`) ??
        this.refinerSources.get(`${roleId}@${refinerId}`);
      if (byRole !== undefined) return byRole;
    }
    return (
      this.refinerSources.get(`${norm}@${refinerId}`) ??
      this.refinerSources.get(`${routeId}@${refinerId}`)
    );
  }

  describeRouteAuthFailure(routeId: string, role: string, groupId?: string): RouteAuthDebugInfo {
    const norm = this.normalizeRouteId(routeId);
    const normGroup = groupId !== undefined ? this.normalizeRouteId(groupId) : undefined;
    const routeSourceModule = this.getRouteSourceModule(norm, normGroup);
    const roleSourceModules = this.getRoleSourceModules(role);
    const meta =
      this.routeMeta.get(norm) ??
      (normGroup !== undefined ? this.routeMeta.get(normGroup) : undefined);
    const bindingSourceModules = meta ? [...meta.bindingSources] : [];
    const requiredRoles = meta ? [...meta.requiredRoles] : [];
    const sourceModule =
      routeSourceModule !== "unknown"
        ? routeSourceModule
        : (bindingSourceModules[0] ?? roleSourceModules[0] ?? "unknown");
    const suggestedUpgradeGrants = [...new Set([...requiredRoles, norm])];
    const suggestedWithAsk = suggestedUpgradeGrants.map((g) => `${g}@withAsk`);
    return {
      routeId: norm,
      ...(normGroup !== undefined ? { groupId: normGroup } : {}),
      role,
      sourceModule,
      routeSourceModule,
      roleSourceModules,
      bindingSourceModules,
      requiredRoles,
      suggestedWithAsk,
      suggestedUpgradeGrants,
    };
  }

  registerRouteAlias(fromPrefix: string, toPrefix: string): void {
    assertNoWildcard(fromPrefix, "registerRouteAlias(fromPrefix)");
    assertNoWildcard(toPrefix, "registerRouteAlias(toPrefix)");
    const from = fromPrefix.trim().replace(/^penguin\./, "");
    const to = toPrefix.trim().replace(/^penguin\./, "");
    if (from !== "" && to !== "") {
      this.prefixAliases[from] = to;
      this.bumpVersion();
    }
  }

  normalizeRouteId(routeId: string): string {
    const trimmed = routeId.trim();
    const stripped = trimmed.startsWith("penguin.") ? trimmed.slice("penguin.".length) : trimmed;
    for (const [aliasFrom, canonicalTo] of Object.entries(this.prefixAliases)) {
      if (stripped === aliasFrom) return canonicalTo;
      if (stripped.startsWith(`${aliasFrom}.`))
        return `${canonicalTo}${stripped.slice(aliasFrom.length)}`;
    }
    return stripped;
  }

  private bindRouteToRole(
    roleSpec: string,
    rawRouteSpec: string,
    sourceModule?: string,
    isRouteOwner = false,
  ): void {
    assertNoWildcard(roleSpec, `role binding "${roleSpec}"`);
    assertNoWildcard(rawRouteSpec, `route binding "${rawRouteSpec}"`);
    const parsedRole = parseRefinedGrant(roleSpec);
    const parsedRoute = parseRefinedGrant(rawRouteSpec);
    if (!parsedRole.target || !parsedRoute.target) return;

    const roleNode = this.ensureRoleNode(parsedRole.target, sourceModule);
    const normRoute = this.normalizeRouteId(parsedRoute.target);
    const refiner = parsedRoute.refinerId ?? parsedRole.refinerId;
    const routeEntry = refiner !== null ? `${normRoute}@${refiner}` : normRoute;
    if (!roleNode.routes.includes(routeEntry)) roleNode.routes.push(routeEntry);

    const meta = this.ensureRouteMeta(normRoute, true);
    if (sourceModule && (isRouteOwner || meta.owner === undefined)) meta.owner = sourceModule;
    meta.requiredRoles.add(parsedRole.target);
    if (sourceModule) meta.bindingSources.add(sourceModule);
    if (refiner !== null) {
      this.recordStaticRefiner("routes", normRoute, refiner, sourceModule);
      if (sourceModule) this.refinerSources.set(`${parsedRole.target}@${refiner}`, sourceModule);
    }
  }

  registerRole(roleId: string, contribution: RoleContribution, sourceModule?: string): void {
    const rawTarget = (contribution.role ?? roleId.replace(/^role\./, "")).trim();
    assertNoWildcard(rawTarget, `registerRole("${rawTarget}")`);
    const targetRole = parseRefinedGrant(rawTarget).target;
    if (!targetRole) return;
    const node = this.ensureRoleNode(targetRole, sourceModule);

    const childrenWithAsk = [
      ...(contribution.children ?? []),
      ...(contribution.withAsk ?? []).map((s) => {
        const t = s.trim();
        return t && !t.includes("@") ? `${t}@withAsk` : t;
      }),
    ];
    for (const childSpec of childrenWithAsk) {
      const trimmed = childSpec.trim();
      if (!trimmed) continue;
      assertNoWildcard(trimmed, `registerRole("${targetRole}").children`);
      const parsed = parseRefinedGrant(trimmed);
      if (parsed.refinerId !== null)
        this.recordStaticRefiner("roles", parsed.target, parsed.refinerId, sourceModule);
      if (!node.children.includes(trimmed)) node.children.push(trimmed);
    }
    for (const routeSpec of contribution.routes ?? []) {
      if (routeSpec.trim()) this.bindRouteToRole(targetRole, routeSpec.trim(), sourceModule, false);
    }
    if (contribution.flags?.allEndpoints) node.flags.allEndpoints = true;
    if (contribution.flags?.agentApi) node.flags.agentApi = true;

    for (const parentSpec of contribution.parents ?? []) {
      const trimmed = parentSpec.trim();
      if (!trimmed) continue;
      assertNoWildcard(trimmed, `registerRole("${targetRole}").parents`);
      const parsed = parseRefinedGrant(trimmed);
      if (!parsed.target) continue;
      const parentNode = this.ensureRoleNode(parsed.target, sourceModule);
      const childRef = parsed.refinerId !== null ? `${targetRole}@${parsed.refinerId}` : targetRole;
      if (parsed.refinerId !== null)
        this.recordStaticRefiner("roles", targetRole, parsed.refinerId, sourceModule);
      if (!parentNode.children.includes(childRef)) parentNode.children.push(childRef);
    }
    if (sourceModule === "AgentAuthPermissionProvider" || contribution.description !== undefined) {
      this.agentRoleDefs.set(targetRole, {
        id: targetRole,
        inherits: [...node.children],
        ...(contribution.withAsk !== undefined ? { withAsk: [...contribution.withAsk] } : {}),
        ...(node.routes.length > 0 ? { routes: [...node.routes] } : {}),
        flags: { ...node.flags },
        builtin: sourceModule === "AgentAuthPermissionProvider",
        ...(contribution.description !== undefined
          ? { description: contribution.description }
          : {}),
      });
    }
    this.bumpVersion();
  }

  defineAgentRole(def: AgentRoleDefinition, sourceModule = "user"): AgentRoleDefinition {
    const targetRole = def.id.replace(/^role\./, "").trim();
    assertNoWildcard(targetRole, `defineAgentRole("${targetRole}")`);
    if (!targetRole) throw new Error("Agent role id must not be empty.");
    const node = this.ensureRoleNode(targetRole, sourceModule);
    node.children = [];
    node.routes = [];
    node.flags = {};
    this.registerRole(
      targetRole,
      {
        role: targetRole,
        children: def.inherits,
        ...(def.withAsk !== undefined ? { withAsk: def.withAsk } : {}),
        ...(def.routes !== undefined ? { routes: def.routes } : {}),
        ...(def.flags !== undefined ? { flags: def.flags } : {}),
        ...(def.description !== undefined ? { description: def.description } : {}),
      },
      sourceModule,
    );
    const stored: AgentRoleDefinition = {
      id: targetRole,
      inherits: [...def.inherits],
      ...(def.withAsk !== undefined ? { withAsk: [...def.withAsk] } : {}),
      ...(def.routes !== undefined ? { routes: [...def.routes] } : {}),
      ...(def.flags !== undefined ? { flags: { ...def.flags } } : {}),
      builtin: Boolean(def.builtin),
      ...(def.description !== undefined ? { description: def.description } : {}),
    };
    this.agentRoleDefs.set(targetRole, stored);
    return stored;
  }

  getAgentRole(id: string): AgentRoleDefinition | undefined {
    return this.agentRoleDefs.get(id.replace(/^role\./, "").trim());
  }

  listAgentRoles(): readonly AgentRoleDefinition[] {
    return [...this.agentRoleDefs.values()];
  }

  registerRoles(
    input:
      | Readonly<Record<string, RoleContribution>>
      | ReadonlyArray<
          {
            readonly id: string;
            readonly from?: string;
            readonly data?: RoleContribution;
          } & RoleContribution
        >,
    defaultSourceModule?: string,
  ): void {
    if (Array.isArray(input)) {
      for (const item of input)
        this.registerRole(item.id, item.data ?? item, item.from ?? defaultSourceModule);
      return;
    }
    for (const [roleId, contrib] of Object.entries(
      input as Readonly<Record<string, RoleContribution>>,
    )) {
      this.registerRole(roleId, contrib, defaultSourceModule);
    }
  }

  registerRoute(registration: RouteRoleRegistration, sourceModule?: string): void {
    const rawId = registration.id.trim();
    if (!rawId) return;
    assertNoWildcard(rawId, `registerRoute("${rawId}")`);
    const src = registration.sourceModule ?? sourceModule;
    const normId = this.normalizeRouteId(rawId);
    const meta = this.ensureRouteMeta(
      normId,
      Boolean(registration.role || registration.roles?.length),
    );
    if (src) meta.owner = src;

    const roles = [
      ...(registration.role?.trim() ? [registration.role.trim()] : []),
      ...(registration.roles ?? []).map((r) => r.trim()).filter(Boolean),
    ];
    for (const roleSpec of roles) {
      assertNoWildcard(roleSpec, `registerRoute("${rawId}").roles`);
      this.bindRouteToRole(roleSpec, normId, src, true);
    }
    this.bumpVersion();
  }

  registerRoutes(
    routes: ReadonlyArray<
      RouteRoleRegistration & {
        readonly from?: string;
        readonly data?: { readonly role?: string; readonly roles?: readonly string[] };
      }
    >,
    defaultSourceModule?: string,
  ): void {
    for (const item of routes) {
      const role = item.role ?? item.data?.role;
      const roles = item.roles ?? item.data?.roles;
      const sourceModule = item.sourceModule ?? item.from ?? defaultSourceModule;
      this.registerRoute({
        id: item.id,
        ...(role ? { role } : {}),
        ...(roles ? { roles } : {}),
        ...(sourceModule ? { sourceModule } : {}),
      });
    }
  }

  registerRoleBinding(contribution: RoleHttpBindingContribution, sourceModule?: string): void {
    for (const [from, to] of Object.entries(contribution.aliases ?? {}))
      this.registerRouteAlias(from, to);
    if (contribution.role && contribution.routes) {
      const roleSpec = contribution.role.trim();
      assertNoWildcard(roleSpec, "registerRoleBinding(role)");
      for (const r of contribution.routes) {
        if (r.trim()) this.bindRouteToRole(roleSpec, r.trim(), sourceModule, false);
      }
    }
    for (const [roleSpec, routeList] of Object.entries(
      contribution.bindings ?? contribution.roles ?? {},
    )) {
      const trimmedRole = roleSpec.trim();
      if (!trimmedRole) continue;
      assertNoWildcard(trimmedRole, `registerRoleBinding("${trimmedRole}")`);
      for (const r of routeList) {
        if (r.trim()) this.bindRouteToRole(trimmedRole, r.trim(), sourceModule, false);
      }
    }
    this.bumpVersion();
  }

  registerRoleBindings(
    bindings: ReadonlyArray<
      {
        readonly id?: string;
        readonly from?: string;
        readonly data?: RoleHttpBindingContribution;
      } & RoleHttpBindingContribution
    >,
    defaultSourceModule?: string,
  ): void {
    for (const item of bindings)
      this.registerRoleBinding(item.data ?? item, item.from ?? defaultSourceModule);
  }

  expandRoleGrant(
    role: string,
    extraGrants: readonly string[] = [],
    options?: { fallbackOnUnknownPrimary?: boolean },
  ): ExpandedRoleGrant {
    assertNoWildcard(role, `expandRoleGrant(role="${role}")`);
    for (const extra of extraGrants)
      assertNoWildcard(extra, `expandRoleGrant(extraGrants="${extra}")`);
    if (extraGrants.length === 0 && !options?.fallbackOnUnknownPrimary) {
      const cached = this.baseRoleCache.get(role);
      if (cached) return cached;
    }

    const visited = new Set<string>();
    const inheritedRoles: string[] = [];
    const allRoutes = new Set<string>();
    const unconditionalRoutes = new Set<string>();
    const refinedRouteMap = new Map<string, Set<string>>();
    const unknownRoles: string[] = [];
    const unknownRoutes: string[] = [];
    let unknownPrimaryRole = false;
    let fallbackRole: string | undefined;
    let allEndpoints = false;
    let agentApi = false;

    const recordRoute = (routeId: string, refinerId: string | null): void => {
      assertNoWildcard(routeId, `expandRoleGrant route "${routeId}"`);
      const norm = this.normalizeRouteId(routeId);
      if (!norm) return;
      allRoutes.add(norm);
      if (refinerId === null) {
        unconditionalRoutes.add(norm);
      } else {
        let set = refinedRouteMap.get(norm);
        if (!set) {
          set = new Set<string>();
          refinedRouteMap.set(norm, set);
        }
        set.add(refinerId);
      }
    };

    const visitRole = (
      r: string,
      inheritedRefiner: string | null,
      isRootRefined: boolean,
    ): void => {
      const isReadTier = r === "readonly" || r.endsWith(".read");
      const eff =
        inheritedRefiner !== null && isReadTier && !isRootRefined ? null : inheritedRefiner;
      const key = `${r}@${eff ?? ""}`;
      if (visited.has(key)) return;
      visited.add(key);

      const node = this.tree[r];
      if (!node) return;
      const roleLabel = eff !== null ? `${r}@${eff}` : r;
      if (!inheritedRoles.includes(roleLabel)) inheritedRoles.push(roleLabel);
      if (eff === null) {
        if (node.flags.allEndpoints) allEndpoints = true;
        if (node.flags.agentApi) agentApi = true;
      }
      for (const routeSpec of node.routes) {
        const parsed = parseRefinedGrant(routeSpec);
        recordRoute(parsed.target, parsed.refinerId ?? eff);
      }
      for (const childSpec of node.children) {
        const parsed = parseRefinedGrant(childSpec);
        if (this.isRole(parsed.target)) {
          visitRole(parsed.target, parsed.refinerId ?? eff, parsed.refinerId !== null);
        } else if (parsed.target) {
          recordRoute(parsed.target, parsed.refinerId ?? eff);
        }
      }
    };

    const classifyUnknown = (target: string, isPrimary: boolean): void => {
      const norm = this.normalizeRouteId(target);
      if (this.routeMeta.has(norm) || this.allRoutesList.includes(norm)) return;
      if (isPrimary || target.startsWith("role.") || /\.(read|maintain|all)$/.test(target)) {
        if (!unknownRoles.includes(target)) unknownRoles.push(target);
      } else if (!unknownRoutes.includes(norm)) {
        unknownRoutes.push(norm);
      }
    };

    const applySpec = (spec: string, isPrimary = false): void => {
      const parsed = parseRefinedGrant(spec);
      if (!parsed.target) return;
      const cleanRole = parsed.target.replace(/^role\./, "");
      if (this.isRole(cleanRole)) {
        visitRole(cleanRole, parsed.refinerId, parsed.refinerId !== null);
      } else if (isPrimary && !this.routeMeta.has(this.normalizeRouteId(parsed.target))) {
        unknownPrimaryRole = true;
        classifyUnknown(parsed.target, true);
        if (this.isRole("readonly")) {
          fallbackRole = "readonly";
          if (options?.fallbackOnUnknownPrimary) {
            visitRole("readonly", parsed.refinerId, parsed.refinerId !== null);
          }
        }
      } else {
        classifyUnknown(parsed.target, false);
        recordRoute(parsed.target, parsed.refinerId);
      }
    };

    applySpec(role, true);
    for (const extra of extraGrants) applySpec(extra, false);

    const routeRefiners: Record<string, string[]> = {};
    const routeRefinerMap = new Map<string, readonly string[]>();
    if (!allEndpoints) {
      for (const [routeId, refiners] of refinedRouteMap.entries()) {
        if (!unconditionalRoutes.has(routeId) && refiners.size > 0) {
          const list = [...refiners];
          routeRefiners[routeId] = list;
          routeRefinerMap.set(routeId, list);
        }
      }
    }
    COMPILED_GRANT_META.set(allRoutes, { unconditionalSet: unconditionalRoutes, routeRefinerMap });
    const mismatches: RoleGrantMismatches = {
      hasMismatch: unknownPrimaryRole || unknownRoles.length > 0 || unknownRoutes.length > 0,
      unknownPrimaryRole,
      ...(fallbackRole !== undefined ? { fallbackRole } : {}),
      unknownRoles,
      unknownRoutes,
    };
    const result: ExpandedRoleGrant = {
      allEndpoints,
      agentApi,
      apiIds: allRoutes,
      routeRefiners,
      inheritedRoles,
      unconditionalRoutes: [...unconditionalRoutes].sort(),
      mismatches,
    };
    if (extraGrants.length === 0 && !options?.fallbackOnUnknownPrimary) {
      this.baseRoleCache.set(role, result);
    }
    return result;
  }

  roleHasAgentApi(role: string): boolean {
    return this.expandRoleGrant(role).agentApi;
  }
}

export const DEFAULT_ROLE_REGISTRY = new RoleRegistry();
export const ROLE_TREE: Readonly<Record<string, RoleNode>> = DEFAULT_ROLE_REGISTRY.roleTree;
export const AGENT_AUTH_ROLES: readonly string[] = DEFAULT_ROLE_REGISTRY.roles;
export const ALL_HTTP_ROUTE_IDS: readonly string[] = DEFAULT_ROLE_REGISTRY.allHttpRouteIds;

export const normalizeRouteId = (routeId: string): string =>
  DEFAULT_ROLE_REGISTRY.normalizeRouteId(routeId);
export const expandRoleGrant = (
  role: string,
  extraGrants: readonly string[] = [],
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): ExpandedRoleGrant => registry.expandRoleGrant(role, extraGrants);
export const roleHasAgentApi = (
  role: string,
  registry: RoleRegistry = DEFAULT_ROLE_REGISTRY,
): boolean => registry.roleHasAgentApi(role);
