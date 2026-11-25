/**
 * The Agent auth service: issuing Agent sessions, authenticating a presented token, and
 * re-deriving the per-route grant from the Agent's CURRENT generation.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  AgentAuth,
  AgentAuthGrant,
  AgentAuthPermissions,
  AgentPermissionUpgradeRequest,
  AgentTemporaryGrantsSummary,
  AuthRoleSessions,
  UpdateAgentGrantOptions,
} from "../mechanisms/agent-auth.js";
import {
  authRoleSessionTokenHash,
  type AuthRoleSessionRow,
} from "../db/repos/auth-role-sessions.js";
import {
  DEFAULT_AGENT_AUTH_ROLE,
  RoleRegistry,
  assertNoWildcard,
  matchesRouteGrant,
  parseRefinedGrant,
  roleHasAgentApi,
  type AgentAuthRole,
  type AgentRoleDefinition,
  type RoleContribution,
  type RoleHttpBindingContribution,
  type RoleNode,
  type RouteAuthDebugInfo,
  type RouteRoleRegistration,
} from "./agent-roles.js";
import {
  parseUpgradeDecision,
  type PermissionUpgradeDecision,
  type WithAskDecisionInput,
} from "./auth-refiners.js";

export const AGENT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export class UpgradeRequestDecisionError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code:
      | "upgrade_request_not_found"
      | "upgrade_request_already_decided"
      | "upgrade_request_session_inactive"
      | "invalid_upgrade_decision",
    message: string,
  ) {
    super(message);
    this.name = "UpgradeRequestDecisionError";
  }
}

export interface AgentAuthContext {
  projectId: string;
  agentId: string;
  grant: AgentAuthGrant;
  agentApi: boolean;
  tokenHash?: string;
}

interface OnceGrantEntry {
  grants: readonly string[];
  remainingUses: number;
  requestId?: string;
  createdAt: string;
  tokenHash?: string;
}

interface AgentSessionGrantState {
  tokenHash?: string;
  grants: Set<string>;
}

@Component()
export class AgentAuthService implements AgentAuth {
  @Use() private readonly authRoleSessions!: AuthRoleSessions;
  @Use() private readonly agentAuthPermissions!: AgentAuthPermissions;
  private readonly activeTokens = new Map<string, string>();
  private readonly activeTokenHashes = new Map<string, string>();
  private readonly onceGrants = new Map<string, OnceGrantEntry[]>();
  private readonly agentSessionGrants = new Map<string, AgentSessionGrantState>();
  private readonly upgradeRequests = new Map<string, AgentPermissionUpgradeRequest[]>();
  private requestSeq = 0;

  private agentKey(projectId: string, agentId: string): string {
    return `${projectId}\0${agentId}`;
  }

  private clearSessionTemporaryGrants(key: string): void {
    this.onceGrants.delete(key);
    this.agentSessionGrants.delete(key);
  }

  private ensureLiveActiveTokenHash(
    projectId: string,
    agentId: string,
    now = new Date(),
  ): string | null {
    const key = this.agentKey(projectId, agentId);
    const hash = this.activeTokenHashes.get(key);
    if (hash === undefined) return null;
    const row = this.authRoleSessions.findByTokenHash(hash);
    if (row === null || row.expiresAt <= now.toISOString()) {
      this.clearSessionTemporaryGrants(key);
      this.activeTokens.delete(key);
      this.activeTokenHashes.delete(key);
      return null;
    }
    return hash;
  }

  isActiveSessionToken(
    projectId: string,
    agentId: string,
    tokenHash: string | undefined,
    now = new Date(),
  ): boolean {
    const key = this.agentKey(projectId, agentId);
    const liveHash = this.ensureLiveActiveTokenHash(projectId, agentId, now);
    if (tokenHash === undefined) return liveHash === null;
    const row = this.authRoleSessions.findByTokenHash(tokenHash);
    if (
      row === null ||
      row.projectId !== projectId ||
      row.agentId !== agentId ||
      row.expiresAt <= now.toISOString()
    ) {
      if (this.activeTokenHashes.get(key) === tokenHash) {
        this.clearSessionTemporaryGrants(key);
        this.activeTokens.delete(key);
        this.activeTokenHashes.delete(key);
      }
      return false;
    }
    if (liveHash !== null && liveHash !== tokenHash) return false;
    if (liveHash === null) {
      this.activeTokenHashes.set(key, tokenHash);
    }
    return true;
  }

  private sessionExtrasFor(
    projectId: string,
    agentId: string,
    tokenHash?: string,
    now = new Date(),
  ): readonly string[] {
    const key = this.agentKey(projectId, agentId);
    const liveHash = this.ensureLiveActiveTokenHash(projectId, agentId, now);
    const state = this.agentSessionGrants.get(key);
    if (!state || state.grants.size === 0) return [];
    if (state.tokenHash !== undefined) {
      if (liveHash === null || state.tokenHash !== liveHash) {
        this.agentSessionGrants.delete(key);
        return [];
      }
      if (tokenHash !== undefined && state.tokenHash !== tokenHash) return [];
    } else if (tokenHash !== undefined && liveHash !== null && liveHash !== tokenHash) {
      return [];
    }
    return [...state.grants];
  }

  issueSession(
    projectId: string,
    agentId: string,
    now: Date,
  ): { token: string; expiresAt: string; generation: number; role: AgentAuthRole } {
    const key = this.agentKey(projectId, agentId);
    this.clearSessionTemporaryGrants(key);
    this.authRoleSessions.deleteSessionsOf(projectId, agentId);
    const out = this.authRoleSessions.issue({
      projectId,
      agentId,
      role: DEFAULT_AGENT_AUTH_ROLE,
      apiIds: [],
      generation: 0,
      now,
      ttlMs: AGENT_SESSION_TTL_MS,
    });
    this.activeTokens.set(key, out.token);
    this.activeTokenHashes.set(key, authRoleSessionTokenHash(out.token));
    const current = this.authRoleSessions.generationOf(projectId, agentId);
    return { ...out, role: current?.role ?? DEFAULT_AGENT_AUTH_ROLE };
  }

  ensureSessionToken(projectId: string, agentId: string, now: Date): string {
    const cached = this.activeTokens.get(this.agentKey(projectId, agentId));
    if (cached !== undefined && this.authenticate(cached, now) !== null) return cached;
    return this.issueSession(projectId, agentId, now).token;
  }

  updateGrant(
    projectId: string,
    agentId: string,
    role: AgentAuthRole,
    apiIds: readonly string[],
    now: Date,
    options?: UpdateAgentGrantOptions,
  ): { generation: number; role: AgentAuthRole; apiIds: readonly string[]; token: string } {
    assertNoWildcard(role, "updateGrant(role)");
    const merged: string[] = [];
    for (const item of options?.inherits ?? []) {
      const t = item.trim();
      if (!t) continue;
      assertNoWildcard(t, "updateGrant(inherits)");
      if (!merged.includes(t)) merged.push(t);
    }
    for (const item of options?.withAsk ?? []) {
      const t = item.trim();
      if (!t) continue;
      assertNoWildcard(t, "updateGrant(withAsk)");
      const spec = t.includes("@") ? t : `${t}@withAsk`;
      if (!merged.includes(spec)) merged.push(spec);
    }
    for (const apiId of apiIds) {
      const t = apiId.trim();
      if (!t) continue;
      assertNoWildcard(t, "updateGrant(apiIds)");
      if (!merged.includes(t)) merged.push(t);
    }
    if (options?.clearTemporaryGrants !== false) {
      const key = this.agentKey(projectId, agentId);
      this.onceGrants.delete(key);
      this.agentSessionGrants.delete(key);
    }
    const current = this.authRoleSessions.generationOf(projectId, agentId);
    const nextGen = (current?.generation ?? 0) + 1;
    this.authRoleSessions.bumpGeneration(projectId, agentId, role, merged, nextGen);
    const token = this.ensureSessionToken(projectId, agentId, now);
    return { generation: nextGen, role, apiIds: merged, token };
  }

  currentGrant(projectId: string, agentId: string): AgentAuthGrant | null {
    return this.agentAuthPermissions.grantOf(
      projectId,
      agentId,
      this.sessionExtrasFor(projectId, agentId),
    );
  }

  allowsEndpoint(projectId: string, agentId: string, apiId: string): boolean {
    const grant = this.currentGrant(projectId, agentId);
    return (
      grant !== null && (grant.allEndpoints === true || matchesRouteGrant(grant.apiIds, apiId))
    );
  }

  registerRole(roleId: string, contribution: RoleContribution, sourceModule?: string): void {
    this.agentAuthPermissions.registerRole(roleId, contribution, sourceModule);
  }

  defineAgentRole(def: AgentRoleDefinition, sourceModule?: string): AgentRoleDefinition {
    return this.agentAuthPermissions.defineAgentRole(def, sourceModule);
  }

  listAgentRoles(): readonly AgentRoleDefinition[] {
    return this.agentAuthPermissions.listAgentRoles();
  }

  roleTreeSnapshot(): {
    readonly agentRoles: readonly AgentRoleDefinition[];
    readonly roleTree: Readonly<Record<string, RoleNode>>;
    readonly allHttpRouteIds: readonly string[];
  } {
    return this.agentAuthPermissions.roleTreeSnapshot();
  }

  registerRoute(registration: RouteRoleRegistration, sourceModule?: string): void {
    this.agentAuthPermissions.registerRoute(registration, sourceModule);
  }

  registerRoleBinding(contribution: RoleHttpBindingContribution, sourceModule?: string): void {
    this.agentAuthPermissions.registerRoleBinding(contribution, sourceModule);
  }

  describeRouteAuthFailure(routeId: string, role: string, groupId?: string): RouteAuthDebugInfo {
    return this.agentAuthPermissions.describeRouteAuthFailure(routeId, role, groupId);
  }

  generationOf(projectId: string, agentId: string) {
    return this.authRoleSessions.generationOf(projectId, agentId);
  }

  requestUpgrade(opts: {
    projectId: string;
    agentId: string;
    grants: readonly string[];
    reason?: string;
    routeId?: string;
    now?: Date;
    tokenHash?: string;
  }): AgentPermissionUpgradeRequest {
    const cleanGrants = opts.grants.map((g) => g.trim()).filter(Boolean);
    if (cleanGrants.length === 0) {
      throw new Error("Permission upgrade request requires at least one role or route grant.");
    }
    for (const g of cleanGrants) assertNoWildcard(g, "requestUpgrade(grants)");
    const now = opts.now ?? new Date();
    const current = this.generationOf(opts.projectId, opts.agentId);
    const boundHash =
      opts.tokenHash ??
      this.ensureLiveActiveTokenHash(opts.projectId, opts.agentId, now) ??
      undefined;
    const req: AgentPermissionUpgradeRequest = {
      requestId: `req_${now.getTime()}_${++this.requestSeq}`,
      projectId: opts.projectId,
      agentId: opts.agentId,
      currentRole: current?.role ?? DEFAULT_AGENT_AUTH_ROLE,
      grants: cleanGrants,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.routeId !== undefined ? { routeId: opts.routeId } : {}),
      ...(boundHash !== undefined ? { tokenHash: boundHash } : {}),
      status: "pending",
      createdAt: now.toISOString(),
    };
    const key = this.agentKey(opts.projectId, opts.agentId);
    const list = this.upgradeRequests.get(key) ?? [];
    list.push(req);
    this.upgradeRequests.set(key, list);
    return req;
  }

  applyUpgradeDecision(
    projectId: string,
    agentId: string,
    grants: readonly string[],
    decision: Exclude<PermissionUpgradeDecision, "deny">,
    now = new Date(),
    tokenHash?: string,
  ): void {
    const clean = grants.map((g) => parseRefinedGrant(g).target).filter(Boolean);
    if (clean.length === 0) return;
    if (tokenHash !== undefined && !this.isActiveSessionToken(projectId, agentId, tokenHash, now)) {
      return;
    }
    const key = this.agentKey(projectId, agentId);

    if (decision === "allowed_once" || decision === "allowed_for_agent") {
      const boundHash =
        tokenHash ?? this.ensureLiveActiveTokenHash(projectId, agentId, now) ?? undefined;
      if (decision === "allowed_once") {
        const list = this.onceGrants.get(key) ?? [];
        list.push({
          grants: clean,
          remainingUses: 1,
          createdAt: now.toISOString(),
          ...(boundHash !== undefined ? { tokenHash: boundHash } : {}),
        });
        this.onceGrants.set(key, list);
        return;
      }

      let state = this.agentSessionGrants.get(key);
      if (!state || state.tokenHash !== boundHash) {
        state = {
          ...(boundHash !== undefined ? { tokenHash: boundHash } : {}),
          grants: new Set(),
        };
        this.agentSessionGrants.set(key, state);
      }
      for (const g of clean) state.grants.add(g);
      return;
    }

    // "always_allowed" -> write role / persistent grant to DB
    const current = this.generationOf(projectId, agentId);
    let nextRole = current?.role ?? DEFAULT_AGENT_AUTH_ROLE;
    const existing = [...(current?.apiIds ?? [])];
    const knownAgentRoles = new Set(this.listAgentRoles().map((r) => r.id));
    for (const g of clean) {
      if (clean.length === 1 && knownAgentRoles.has(g)) {
        nextRole = g;
      } else {
        const filtered = existing.filter((e) => parseRefinedGrant(e).target !== g);
        existing.length = 0;
        existing.push(...filtered, g);
      }
    }
    this.updateGrant(projectId, agentId, nextRole, existing, now, {
      clearTemporaryGrants: false,
    });
  }

  decideUpgradeRequest(opts: {
    projectId: string;
    agentId: string;
    requestId: string;
    decision: WithAskDecisionInput | string;
    now?: Date;
  }): { request: AgentPermissionUpgradeRequest; grant: AgentAuthGrant | null } {
    const normalized = parseUpgradeDecision(opts.decision);
    if (normalized === null) {
      throw new UpgradeRequestDecisionError(
        400,
        "invalid_upgrade_decision",
        `Invalid permission upgrade decision "${String(opts.decision)}".`,
      );
    }
    const key = this.agentKey(opts.projectId, opts.agentId);
    const list = this.upgradeRequests.get(key) ?? [];
    const idx = list.findIndex((r) => r.requestId === opts.requestId);
    if (idx < 0) {
      throw new UpgradeRequestDecisionError(
        404,
        "upgrade_request_not_found",
        `Permission upgrade request "${opts.requestId}" not found.`,
      );
    }
    const existing = list[idx]!;
    if (existing.status !== "pending") {
      if (existing.decision === normalized && normalized !== "allowed_once") {
        return { request: existing, grant: this.currentGrant(opts.projectId, opts.agentId) };
      }
      throw new UpgradeRequestDecisionError(
        409,
        "upgrade_request_already_decided",
        `Permission upgrade request "${opts.requestId}" has already been decided (${existing.decision ?? existing.status}).`,
      );
    }
    const now = opts.now ?? new Date();
    if (
      normalized !== "deny" &&
      existing.tokenHash !== undefined &&
      !this.isActiveSessionToken(opts.projectId, opts.agentId, existing.tokenHash, now)
    ) {
      throw new UpgradeRequestDecisionError(
        409,
        "upgrade_request_session_inactive",
        `The agent session for permission upgrade request "${opts.requestId}" is no longer active.`,
      );
    }
    if (normalized !== "deny") {
      this.applyUpgradeDecision(
        opts.projectId,
        opts.agentId,
        existing.grants,
        normalized,
        now,
        existing.tokenHash,
      );
    }
    const updated: AgentPermissionUpgradeRequest = {
      ...existing,
      status: normalized === "deny" ? "denied" : "approved",
      decision: normalized,
      decidedAt: now.toISOString(),
    };
    list[idx] = updated;
    return { request: updated, grant: this.currentGrant(opts.projectId, opts.agentId) };
  }

  listUpgradeRequests(
    projectId: string,
    agentId: string,
  ): readonly AgentPermissionUpgradeRequest[] {
    return [...(this.upgradeRequests.get(this.agentKey(projectId, agentId)) ?? [])];
  }

  temporaryGrantsOf(projectId: string, agentId: string): AgentTemporaryGrantsSummary {
    const key = this.agentKey(projectId, agentId);
    const liveHash = this.ensureLiveActiveTokenHash(projectId, agentId);
    const once = (this.onceGrants.get(key) ?? []).filter(
      (e) =>
        e.remainingUses > 0 &&
        (e.tokenHash === undefined || (liveHash !== null && e.tokenHash === liveHash)),
    );
    const state = this.agentSessionGrants.get(key);
    const session =
      state &&
      (state.tokenHash === undefined || (liveHash !== null && state.tokenHash === liveHash))
        ? [...state.grants]
        : [];
    return { onceGrants: once, agentSessionGrants: session };
  }

  consumeOnceGrant(
    projectId: string,
    agentId: string,
    routeId: string,
    groupId?: string,
    tokenHash?: string,
    now = new Date(),
  ): boolean {
    if (tokenHash !== undefined && !this.isActiveSessionToken(projectId, agentId, tokenHash, now)) {
      return false;
    }
    const key = this.agentKey(projectId, agentId);
    const liveHash = this.ensureLiveActiveTokenHash(projectId, agentId, now);
    const list = this.onceGrants.get(key);
    if (!list || list.length === 0) return false;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!;
      if (entry.remainingUses <= 0) continue;
      if (entry.tokenHash !== undefined) {
        if (liveHash === null || entry.tokenHash !== liveHash) continue;
        if (tokenHash !== undefined && entry.tokenHash !== tokenHash) continue;
      } else if (tokenHash !== undefined && liveHash !== null && liveHash !== tokenHash) {
        continue;
      }
      if (this.agentAuthPermissions.matchesTemporaryGrant(entry.grants, routeId, groupId)) {
        entry.remainingUses--;
        if (entry.remainingUses <= 0) list.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  authenticate(bearer: string, now: Date): AgentAuthContext | null {
    const tokenHash = authRoleSessionTokenHash(bearer);
    const row: AuthRoleSessionRow | null = this.authRoleSessions.findByTokenHash(tokenHash);
    if (row === null) return null;
    const key = this.agentKey(row.projectId, row.agentId);
    if (row.expiresAt <= now.toISOString()) {
      if (!this.activeTokenHashes.has(key) || this.activeTokenHashes.get(key) === tokenHash) {
        this.clearSessionTemporaryGrants(key);
        this.activeTokens.delete(key);
        this.activeTokenHashes.delete(key);
      }
      return null;
    }
    const isActiveSession = this.isActiveSessionToken(row.projectId, row.agentId, tokenHash, now);
    const grant = isActiveSession
      ? this.agentAuthPermissions.grantOf(
          row.projectId,
          row.agentId,
          this.sessionExtrasFor(row.projectId, row.agentId, tokenHash, now),
        )
      : this.agentAuthPermissions.grantOf(row.projectId, row.agentId, []);
    if (grant === null) return null;
    this.authRoleSessions.touch(row.tokenHash, now.toISOString());
    return {
      projectId: row.projectId,
      agentId: row.agentId,
      grant,
      agentApi: grant.agentApi ?? roleHasAgentApi(grant.role),
      tokenHash: row.tokenHash,
    };
  }

  revokeAll(projectId: string, agentId: string): void {
    const key = this.agentKey(projectId, agentId);
    this.activeTokens.delete(key);
    this.activeTokenHashes.delete(key);
    this.clearSessionTemporaryGrants(key);
    this.upgradeRequests.delete(key);
    this.authRoleSessions.deleteByAgent(projectId, agentId);
  }
}

interface CachedAgentGrant {
  readonly generation: number;
  readonly registryVersion: number;
  readonly role: AgentAuthRole;
  readonly sessionExtraKey: string;
  readonly grant: AgentAuthGrant;
}

@Component({
  contributes: {
    "AgentAuthPermissionProvider.roles": [
      { id: "role.none" },
      { id: "role.readonly" },
      { id: "role.general", children: ["readonly"] },
      {
        id: "role.general-with-ask",
        children: [
          "general",
          "agent.maintain@withAsk",
          "memory.maintain@withAsk",
          "schedule.maintain@withAsk",
          "workbench.maintain@withAsk",
          "skill.maintain@withAsk",
          "plugin.maintain@withAsk",
          "model.maintain@withAsk",
          "vault.maintain@withAsk",
          "machine.maintain@withAsk",
          "messaging.maintain@withAsk",
          "agents.messaging.maintain@withAsk",
        ],
      },
      {
        id: "role.system-maintainer",
        children: ["general"],
        flags: { allEndpoints: false, agentApi: true },
      },
      {
        id: "role.admin",
        children: ["system-maintainer"],
        flags: { allEndpoints: true, agentApi: false },
      },
      {
        id: "role.full-permissions",
        children: ["admin"],
        flags: { allEndpoints: true, agentApi: true },
      },
    ],
  },
})
export class AgentAuthPermissionProvider implements AgentAuthPermissions {
  @Use() private readonly authRoleSessions!: AuthRoleSessions;
  private readonly roleRegistry = new RoleRegistry();
  private readonly grantCache = new Map<string, CachedAgentGrant>();

  setup({ contributions }: ClassCtx): void {
    const roles = contributions.roles as
      | ReadonlyArray<{
          readonly id: string;
          readonly from?: string;
          readonly data: RoleContribution;
        }>
      | undefined;
    if (roles) for (const r of roles) this.roleRegistry.registerRole(r.id, r.data ?? r, r.from);

    const bindings = contributions.roleBindings as
      | ReadonlyArray<{
          readonly id: string;
          readonly from?: string;
          readonly data: RoleHttpBindingContribution;
        }>
      | undefined;
    if (bindings)
      for (const rb of bindings) this.roleRegistry.registerRoleBinding(rb.data ?? rb, rb.from);
  }

  registerRole(roleId: string, contribution: RoleContribution, sourceModule?: string): void {
    this.roleRegistry.registerRole(roleId, contribution, sourceModule);
  }

  defineAgentRole(def: AgentRoleDefinition, sourceModule?: string): AgentRoleDefinition {
    return this.roleRegistry.defineAgentRole(def, sourceModule);
  }

  listAgentRoles(): readonly AgentRoleDefinition[] {
    return this.roleRegistry.listAgentRoles();
  }

  roleTreeSnapshot(): {
    readonly agentRoles: readonly AgentRoleDefinition[];
    readonly roleTree: Readonly<Record<string, RoleNode>>;
    readonly allHttpRouteIds: readonly string[];
  } {
    return {
      agentRoles: this.roleRegistry.listAgentRoles(),
      roleTree: this.roleRegistry.roleTree,
      allHttpRouteIds: this.roleRegistry.allHttpRouteIds,
    };
  }

  registerRoute(registration: RouteRoleRegistration, sourceModule?: string): void {
    this.roleRegistry.registerRoute(registration, sourceModule);
  }

  registerRoleBinding(contribution: RoleHttpBindingContribution, sourceModule?: string): void {
    this.roleRegistry.registerRoleBinding(contribution, sourceModule);
  }

  describeRouteAuthFailure(routeId: string, role: string, groupId?: string): RouteAuthDebugInfo {
    return this.roleRegistry.describeRouteAuthFailure(routeId, role, groupId);
  }

  matchesTemporaryGrant(grants: readonly string[], routeId: string, groupId?: string): boolean {
    const expanded = this.roleRegistry.expandRoleGrant("none", grants);
    return (
      expanded.allEndpoints ||
      matchesRouteGrant(expanded.apiIds, routeId, groupId, this.roleRegistry)
    );
  }

  grantOf(
    projectId: string,
    agentId: string,
    sessionExtraGrants: readonly string[] = [],
  ): AgentAuthGrant | null {
    const cacheKey = `${projectId}\0${agentId}`;
    const current = this.authRoleSessions.generationOf(projectId, agentId);
    const generation = current?.generation ?? 0;
    const role = current?.role ?? DEFAULT_AGENT_AUTH_ROLE;
    const configuredApiIds = current?.apiIds ?? [];
    const sessionExtraKey = sessionExtraGrants.join(",");
    const registryVersion = this.roleRegistry.version;
    const cached = this.grantCache.get(cacheKey);
    if (
      cached !== undefined &&
      cached.generation === generation &&
      cached.registryVersion === registryVersion &&
      cached.role === role &&
      cached.sessionExtraKey === sessionExtraKey
    ) {
      return cached.grant;
    }
    const combinedApiIds =
      sessionExtraGrants.length > 0
        ? [...new Set([...configuredApiIds, ...sessionExtraGrants])]
        : configuredApiIds;
    const expanded = this.roleRegistry.expandRoleGrant(role, combinedApiIds, {
      fallbackOnUnknownPrimary: true,
    });
    const grant: AgentAuthGrant = {
      role: expanded.mismatches.fallbackRole ?? role,
      generation,
      allEndpoints: expanded.allEndpoints,
      agentApi: expanded.agentApi,
      apiIds: expanded.apiIds,
      configuredApiIds,
      inheritedRoles: expanded.inheritedRoles,
      unconditionalRoutes: expanded.unconditionalRoutes,
      routeRefiners: expanded.routeRefiners,
      mismatches: expanded.mismatches,
    };
    this.grantCache.set(cacheKey, {
      generation,
      registryVersion,
      role,
      sessionExtraKey,
      grant,
    });
    return grant;
  }
}
