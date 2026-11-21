/**
 * The Agent auth service: issuing Agent sessions, authenticating a presented token, and the
 * per-route grant a request runs under. One service over the repo — the issuing point the
 * Agent-creation path calls, the authenticator the HTTP gate reads, and the re-derivation
 * point that keeps a live session's grant CURRENT with the Agent's generation instead of
 * frozen at its issue time.
 *
 * Authorization is per HTTP route id (`"HttpModule.routes"` entry `id`): one check governs
 * HTTP and CLI alike, since CLI commands reach the server over HTTP.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  AgentAuth,
  AgentAuthGrant,
  AgentAuthPermissions,
  AgentAuthSessions,
} from "../mechanisms/agent-auth.js";
import type { AgentAuthSessionRow } from "../db/repos/agent-auth-sessions.js";
import { agentSessionTokenHash } from "../db/repos/agent-auth-sessions.js";
import {
  DEFAULT_AGENT_AUTH_ROLE,
  RoleRegistry,
  matchesRouteGrant,
  roleHasAgentApi,
  type AgentAuthRole,
  type RoleContribution,
  type RouteRoleRegistration,
} from "./agent-roles.js";

/** How long an Agent session lives; the Agent re-derives nothing about this — it is a lease. */
export const AGENT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/** The authenticated caller the HTTP gate receives. */
export interface AgentAuthContext {
  projectId: string;
  agentId: string;
  grant: AgentAuthGrant;
  /** Whether the grant also reaches the Agent's own API settings and keys. */
  agentApi: boolean;
  /** Optional interactive approval hook used by `@withAsk` refiners. */
  askApproval?: (
    action: {
      readonly routeId: string;
      readonly groupId?: string;
      readonly method: string;
      readonly path: string;
      readonly params: Readonly<Record<string, string>>;
    },
    request?: Request,
  ) => Promise<boolean>;
}

@Component()
export class AgentAuthService implements AgentAuth {
  @Use() private readonly agentAuthSessions!: AgentAuthSessions;
  /** The Agent's per-route grant, derived at its CURRENT generation and role. */
  @Use() private readonly agentAuthPermissions!: AgentAuthPermissions;
  private readonly activeTokens = new Map<string, string>();

  /**
   * Issues the Agent's session. Called when the Agent is created (and by the re-issue path);
   * the raw token goes back once — the caller stores it where the Agent can reach and nothing
   * else does. The session stamps the Agent's CURRENT generation, whatever the caller asked.
   */
  issueSession(
    projectId: string,
    agentId: string,
    now: Date,
  ): { token: string; expiresAt: string; generation: number; role: AgentAuthRole } {
    const out = this.agentAuthSessions.issue({
      projectId,
      agentId,
      role: DEFAULT_AGENT_AUTH_ROLE,
      apiIds: [],
      generation: 0,
      now,
      ttlMs: AGENT_SESSION_TTL_MS,
    });
    this.activeTokens.set(`${projectId}\0${agentId}`, out.token);
    const current = this.agentAuthSessions.generationOf(projectId, agentId);
    return { ...out, role: current?.role ?? DEFAULT_AGENT_AUTH_ROLE };
  }

  /** Returns a live session token for the Agent, issuing a new one when none is cached or valid. */
  ensureSessionToken(projectId: string, agentId: string, now: Date): string {
    const key = `${projectId}\0${agentId}`;
    const cached = this.activeTokens.get(key);
    if (cached !== undefined && this.authenticate(cached, now) !== null) {
      return cached;
    }
    return this.issueSession(projectId, agentId, now).token;
  }

  /** Updates the Agent's role and explicit route grants (bumping its generation) and returns the new state. */
  updateGrant(
    projectId: string,
    agentId: string,
    role: AgentAuthRole,
    apiIds: readonly string[],
    now: Date,
  ): { generation: number; role: AgentAuthRole; apiIds: readonly string[]; token: string } {
    const current = this.agentAuthSessions.generationOf(projectId, agentId);
    const nextGen = (current?.generation ?? 0) + 1;
    this.agentAuthSessions.bumpGeneration(projectId, agentId, role, apiIds, nextGen);
    const token = this.ensureSessionToken(projectId, agentId, now);
    return { generation: nextGen, role, apiIds: [...apiIds], token };
  }

  /** The Agent's CURRENT grant, from its CURRENT generation and role. */
  currentGrant(projectId: string, agentId: string): AgentAuthGrant | null {
    return this.agentAuthPermissions.grantOf(projectId, agentId);
  }

  /** Whether the CURRENT grant reaches the HTTP route `apiId`. */
  allowsEndpoint(projectId: string, agentId: string, apiId: string): boolean {
    const grant = this.agentAuthPermissions.grantOf(projectId, agentId);
    if (grant === null) return false;
    return grant.allEndpoints === true || matchesRouteGrant(grant.apiIds, apiId);
  }

  /** Registers or extends a role node in the permission provider's role registry. */
  registerRole(roleId: string, contribution: RoleContribution): void {
    this.agentAuthPermissions.registerRole(roleId, contribution);
  }

  /** Registers a route's sub-endpoint mappings and direct role bindings. */
  registerRoute(registration: RouteRoleRegistration): void {
    this.agentAuthPermissions.registerRoute(registration);
  }

  /** The Agent's CURRENT generation row; null before its first session. */
  generationOf(projectId: string, agentId: string) {
    return this.agentAuthSessions.generationOf(projectId, agentId);
  }

  /**
   * Authenticates a presented Bearer: the session must exist and be unexpired; the context
   * it answers with carries the Agent's CURRENT grant — a session issued at an older
   * generation reads the new one here.
   */
  authenticate(bearer: string, now: Date): AgentAuthContext | null {
    const row: AgentAuthSessionRow | null = this.agentAuthSessions.findByTokenHash(
      agentSessionTokenHash(bearer),
    );
    if (row === null) return null;
    if (row.expiresAt <= now.toISOString()) return null;
    const grant = this.agentAuthPermissions.grantOf(row.projectId, row.agentId);
    if (grant === null) return null;
    this.agentAuthSessions.touch(row.tokenHash, now.toISOString());
    return {
      projectId: row.projectId,
      agentId: row.agentId,
      grant,
      agentApi: grant.agentApi ?? roleHasAgentApi(grant.role),
    };
  }

  /** Drops the Agent's sessions AND its generation row (the Agent is archived). */
  revokeAll(projectId: string, agentId: string): void {
    this.activeTokens.delete(`${projectId}\0${agentId}`);
    this.agentAuthSessions.deleteByAgent(projectId, agentId);
  }
}

/** Derives the grant from the Agent's CURRENT generation row — the one reader of the pair. */
@Component()
export class AgentAuthPermissionProvider implements AgentAuthPermissions {
  @Use() private readonly agentAuthSessions!: AgentAuthSessions;
  private readonly roleRegistry = new RoleRegistry();

  setup({ contributions }: ClassCtx): void {
    const roles = contributions.roles as
      | ReadonlyArray<{ readonly id: string; readonly data: RoleContribution }>
      | undefined;
    if (roles !== undefined) {
      this.roleRegistry.registerRoles(roles);
    }
  }

  registerRole(roleId: string, contribution: RoleContribution): void {
    this.roleRegistry.registerRole(roleId, contribution);
  }

  registerRoute(registration: RouteRoleRegistration): void {
    this.roleRegistry.registerRoute(registration);
  }

  grantOf(projectId: string, agentId: string): AgentAuthGrant | null {
    const current = this.agentAuthSessions.generationOf(projectId, agentId);
    if (current === null) return null;
    const expanded = this.roleRegistry.expandRoleGrant(current.role, current.apiIds);
    return {
      role: current.role,
      generation: current.generation,
      allEndpoints: expanded.allEndpoints,
      agentApi: expanded.agentApi,
      crossAgent: expanded.crossAgent,
      apiIds: expanded.apiIds,
      routeRefiners: expanded.routeRefiners,
    };
  }
}
