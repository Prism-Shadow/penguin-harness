/**
 * Role-bound authorization session & permission mechanisms: what the server requires of the
 * role-scoped sessions it issues, declared apart from `db/repos/auth-role-sessions.ts`.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Slot } from "@prismshadow/penguin-core/kernel";
import type {
  AgentAuthRole,
  AgentRoleDefinition,
  RoleContribution,
  RoleGrantMismatches,
  RoleHttpBindingContribution,
  RoleNode,
  RouteAuthDebugInfo,
  RouteRoleRegistration,
} from "../auth/agent-roles.js";
import type { PermissionUpgradeDecision, WithAskDecisionInput } from "../auth/auth-refiners.js";
import type { AgentAuthContext } from "../auth/agent-auth-service.js";
import type { AuthSubjectKind } from "../db/repos/auth-role-sessions.js";

/** One permission upgrade request submitted by an Agent or triggered via `@withAsk`. */
export interface AgentPermissionUpgradeRequest {
  readonly requestId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly currentRole: string;
  readonly grants: readonly string[];
  readonly reason?: string;
  readonly routeId?: string;
  readonly status: "pending" | "approved" | "denied";
  readonly decision?: PermissionUpgradeDecision;
  readonly createdAt: string;
  readonly decidedAt?: string;
  readonly tokenHash?: string;
}

export interface AgentTemporaryGrantsSummary {
  readonly onceGrants: ReadonlyArray<{
    readonly grants: readonly string[];
    readonly remainingUses: number;
    readonly requestId?: string;
    readonly createdAt: string;
  }>;
  readonly agentSessionGrants: readonly string[];
}

export interface UpdateAgentGrantOptions {
  readonly inherits?: readonly string[];
  readonly withAsk?: readonly string[];
  readonly clearTemporaryGrants?: boolean;
}

/** One issued session, as surfaces show it (never the raw token). */
export interface AuthRoleSessionInfo {
  subjectId?: string;
  subjectKind?: AuthSubjectKind;
  userId?: string | null;
  projectId: string;
  agentId: string;
  role: AgentAuthRole;
  generation: number;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** One stored session with its token hash — what authentication reads. */
export interface AuthRoleSessionRow {
  tokenHash: string;
  subjectId: string;
  subjectKind: AuthSubjectKind;
  userId: string | null;
  projectId: string;
  agentId: string;
  role: AgentAuthRole;
  generation: number;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** The principal's CURRENT grant: role scope plus explicit route ids, cached per generation. */
export interface AgentAuthGrant {
  role: AgentAuthRole;
  generation: number;
  allEndpoints: boolean;
  agentApi?: boolean;
  apiIds: ReadonlySet<string>;
  configuredApiIds?: readonly string[];
  inheritedRoles?: readonly string[];
  unconditionalRoutes?: readonly string[];
  routeRefiners?: Readonly<Record<string, readonly string[]>>;
  mismatches?: RoleGrantMismatches;
}

/** The principal's CURRENT generation row: what re-derivation reads. */
export interface AuthGenerationRow {
  subjectId: string;
  subjectKind: AuthSubjectKind;
  userId: string | null;
  projectId: string;
  agentId: string;
  generation: number;
  role: AgentAuthRole;
  apiIds: readonly string[];
}

export interface AgentAuthPermissionsSlots {
  roles: Slot<RoleContribution>;
  roleBindings: Slot<RoleHttpBindingContribution>;
}

/** The per-route grant face: what AgentAuthPermissionProvider implements. */
@Interface()
export abstract class AgentAuthPermissions {
  abstract grantOf(
    projectId: string,
    agentId: string,
    sessionExtraGrants?: readonly string[],
  ): AgentAuthGrant | null;
  abstract registerRole(
    roleId: string,
    contribution: RoleContribution,
    sourceModule?: string,
  ): void;
  abstract defineAgentRole(def: AgentRoleDefinition, sourceModule?: string): AgentRoleDefinition;
  abstract listAgentRoles(): readonly AgentRoleDefinition[];
  abstract roleTreeSnapshot(): {
    readonly agentRoles: readonly AgentRoleDefinition[];
    readonly roleTree: Readonly<Record<string, RoleNode>>;
    readonly allHttpRouteIds: readonly string[];
  };
  abstract registerRoute(registration: RouteRoleRegistration, sourceModule?: string): void;
  abstract registerRoleBinding(
    contribution: RoleHttpBindingContribution,
    sourceModule?: string,
  ): void;
  abstract describeRouteAuthFailure(
    routeId: string,
    role: string,
    groupId?: string,
  ): RouteAuthDebugInfo;
  abstract matchesTemporaryGrant(
    grants: readonly string[],
    routeId: string,
    groupId?: string,
  ): boolean;
}

/** AuthRoleSessions: the mechanism AuthRoleSessionsRepo implements. */
@Interface()
export abstract class AuthRoleSessions {
  abstract issue(opts: {
    projectId?: string | null;
    agentId?: string | null;
    userId?: string | null;
    subjectId?: string;
    role: AgentAuthRole;
    apiIds: readonly string[];
    generation: number;
    now: Date;
    ttlMs: number;
  }): { token: string; expiresAt: string; generation: number };
  abstract findByTokenHash(tokenHash: string): AuthRoleSessionRow | null;
  abstract generationBySubject(subjectId: string): AuthGenerationRow | null;
  abstract generationOf(projectId: string, agentId: string): AuthGenerationRow | null;
  abstract bumpSubjectGeneration(opts: {
    subjectId?: string;
    userId?: string | null;
    projectId?: string | null;
    agentId?: string | null;
    role: string;
    apiIds: readonly string[];
    generation: number;
  }): void;
  abstract bumpGeneration(
    projectId: string,
    agentId: string,
    role: string,
    apiIds: readonly string[],
    generation: number,
  ): void;
  abstract touch(tokenHash: string, at: string): void;
  abstract deleteSessionsOf(projectId: string, agentId: string): void;
  abstract deleteBySubject(subjectId: string): void;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteExpired(at: string): void;
}

/** AgentAuth: the mechanism the auth service implements (`auth/agent-auth-service.ts`). */
@Interface()
export abstract class AgentAuth {
  abstract issueSession(
    projectId: string,
    agentId: string,
    now: Date,
  ): { token: string; expiresAt: string; generation: number; role: AgentAuthRole };
  abstract currentGrant(projectId: string, agentId: string): AgentAuthGrant | null;
  abstract allowsEndpoint(projectId: string, agentId: string, apiId: string): boolean;
  abstract generationOf(projectId: string, agentId: string): AuthGenerationRow | null;
  abstract authenticate(bearer: string, now: Date): AgentAuthContext | null;
  abstract revokeAll(projectId: string, agentId: string): void;
  abstract ensureSessionToken(projectId: string, agentId: string, now: Date): string;
  abstract updateGrant(
    projectId: string,
    agentId: string,
    role: AgentAuthRole,
    apiIds: readonly string[],
    now: Date,
    options?: UpdateAgentGrantOptions,
  ): { generation: number; role: AgentAuthRole; apiIds: readonly string[]; token: string };
  abstract registerRole(
    roleId: string,
    contribution: RoleContribution,
    sourceModule?: string,
  ): void;
  abstract defineAgentRole(def: AgentRoleDefinition, sourceModule?: string): AgentRoleDefinition;
  abstract listAgentRoles(): readonly AgentRoleDefinition[];
  abstract roleTreeSnapshot(): {
    readonly agentRoles: readonly AgentRoleDefinition[];
    readonly roleTree: Readonly<Record<string, RoleNode>>;
    readonly allHttpRouteIds: readonly string[];
  };
  abstract registerRoute(registration: RouteRoleRegistration, sourceModule?: string): void;
  abstract registerRoleBinding(
    contribution: RoleHttpBindingContribution,
    sourceModule?: string,
  ): void;
  abstract describeRouteAuthFailure(
    routeId: string,
    role: string,
    groupId?: string,
  ): RouteAuthDebugInfo;
  abstract requestUpgrade(opts: {
    projectId: string;
    agentId: string;
    grants: readonly string[];
    reason?: string;
    routeId?: string;
    now?: Date;
    tokenHash?: string;
  }): AgentPermissionUpgradeRequest;
  abstract decideUpgradeRequest(opts: {
    projectId: string;
    agentId: string;
    requestId: string;
    decision: WithAskDecisionInput | string;
    now?: Date;
  }): { request: AgentPermissionUpgradeRequest; grant: AgentAuthGrant | null };
  abstract listUpgradeRequests(
    projectId: string,
    agentId: string,
  ): readonly AgentPermissionUpgradeRequest[];
  abstract temporaryGrantsOf(projectId: string, agentId: string): AgentTemporaryGrantsSummary;
  abstract isActiveSessionToken(
    projectId: string,
    agentId: string,
    tokenHash: string | undefined,
    now?: Date,
  ): boolean;
  abstract consumeOnceGrant(
    projectId: string,
    agentId: string,
    routeId: string,
    groupId?: string,
    tokenHash?: string,
    now?: Date,
  ): boolean;
  abstract applyUpgradeDecision(
    projectId: string,
    agentId: string,
    grants: readonly string[],
    decision: Exclude<PermissionUpgradeDecision, "deny">,
    now?: Date,
    tokenHash?: string,
  ): void;
}
