/**
 * The Agent auth mechanism: what the server requires of the sessions it issues to Agents,
 * declared apart from what implements it (db/repos/agent-auth-sessions.ts).
 *
 * The same shape the user auth keeps: a server-side row per session, the raw token only in
 * the Agent's vault, the row its sha256. Issued when the Agent is created (or first needs
 * one); every session of the Agent goes when the Agent is archived. Authorization is per
 * HTTP route id — the server's HTTP routes are addressed by their `"HttpModule.routes"` id,
 * and one per-route check governs HTTP and CLI alike (since CLI commands reach the server
 * over HTTP). What an Agent may reach is the GRANT bound to its CURRENT generation: a role
 * whose scope spans every endpoint, plus the explicit route ids granted to it. The grant is
 * never stored with the session — each request re-derives it from the CURRENT generation, so
 * a role or grant change hot-reloads without re-issue and no stale grant outlives one request.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AgentAuthRole } from "../auth/agent-roles.js";
import type { AgentAuthContext } from "../auth/agent-auth-service.js";

/** One issued session, as surfaces show it (never the raw token). */
export interface AgentAuthSessionInfo {
  projectId: string;
  agentId: string;
  role: AgentAuthRole;
  generation: number;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** One stored session with its token hash — what authentication reads. */
export interface AgentAuthSessionRow {
  tokenHash: string;
  projectId: string;
  agentId: string;
  role: AgentAuthRole;
  generation: number;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/**
 * The Agent's CURRENT grant: the role's scope over the server's HTTP routes plus the explicit
 * route ids granted to it. What every request is checked against.
 */
export interface AgentAuthGrant {
  role: AgentAuthRole;
  generation: number;
  /** true = the role spans every HTTP route the server registers (`admin`, `full-permissions`). */
  allEndpoints: boolean;
  /** true = the role permits mutating another Agent's config, skills, schedules, or vault in the same project. */
  crossAgent?: boolean;
  /** The effective HTTP route ids after expanding the role tree and explicit extra grants. */
  apiIds: readonly string[];
}

/** The Agent's CURRENT generation row: what re-derivation reads. */
export interface AgentAuthGenerationRow {
  projectId: string;
  agentId: string;
  generation: number;
  role: AgentAuthRole;
  apiIds: readonly string[];
}

/** The per-route grant face: what AgentAuthPermissionProvider implements. */
@Interface()
export abstract class AgentAuthPermissions {
  /** The Agent's CURRENT grant, from its CURRENT generation and role. */
  abstract grantOf(projectId: string, agentId: string): AgentAuthGrant | null;
}

/** AgentAuthSessions: the mechanism AgentAuthSessionsRepo implements. */
@Interface()
export abstract class AgentAuthSessions {
  /** Mints a session for the Agent; the raw token leaves once, into the caller's hands. */
  abstract issue(opts: {
    projectId: string;
    agentId: string;
    role: AgentAuthRole;
    apiIds: readonly string[];
    generation: number;
    now: Date;
    ttlMs: number;
  }): { token: string; expiresAt: string; generation: number };
  /** The session whose token hashes to `tokenHash`; null when none does or it is expired. */
  abstract findByTokenHash(tokenHash: string): AgentAuthSessionRow | null;
  /** The Agent's CURRENT generation row; null before its first session. */
  abstract generationOf(projectId: string, agentId: string): AgentAuthGenerationRow | null;
  /**
   * Sets the Agent's CURRENT generation, role and granted route ids. Every live session keeps
   * its token but re-derives its grant from this at its next request.
   */
  abstract bumpGeneration(
    projectId: string,
    agentId: string,
    role: AgentAuthRole,
    apiIds: readonly string[],
    generation: number,
  ): void;
  abstract touch(tokenHash: string, at: string): void;
  /** Drops the Agent's sessions (re-issue follows); the generation row stays. */
  abstract deleteSessionsOf(projectId: string, agentId: string): void;
  /** Drops everything of the Agent — sessions AND its generation row (the Agent is archived). */
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteExpired(at: string): void;
}

/**
 * AgentAuth: the mechanism the auth service implements — what the issue/authenticate paths
 * call, declared apart from the class that implements it (auth/agent-auth-service.ts).
 */
@Interface()
export abstract class AgentAuth {
  /** Issues the Agent's session; the raw token leaves once. */
  abstract issueSession(
    projectId: string,
    agentId: string,
    now: Date,
  ): { token: string; expiresAt: string; generation: number; role: AgentAuthRole };
  /** The Agent's CURRENT grant, from its CURRENT generation and role. */
  abstract currentGrant(projectId: string, agentId: string): AgentAuthGrant | null;
  /** Whether the CURRENT grant reaches the HTTP route `apiId`. */
  abstract allowsEndpoint(projectId: string, agentId: string, apiId: string): boolean;
  /** The Agent's CURRENT generation row; null before its first session. */
  abstract generationOf(projectId: string, agentId: string): AgentAuthGenerationRow | null;
  /**
   * Authenticates a presented Bearer; the context carries the Agent's CURRENT grant —
   * a session issued at an older generation reads the new one here.
   */
  abstract authenticate(bearer: string, now: Date): AgentAuthContext | null;
  /** Drops the Agent's sessions AND its generation row (the Agent is archived). */
  abstract revokeAll(projectId: string, agentId: string): void;
}
