/**
 * auth_role_sessions / auth_generations table repos: storage for role-bound authorization
 * sessions and permission generations (serving both Agents and human users).
 */
import { createHash, randomBytes } from "node:crypto";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import {
  DEFAULT_AGENT_AUTH_ROLE,
  parseRefinedGrant,
  type AgentAuthRole,
} from "../../auth/agent-roles.js";
import type {
  AuthGenerationRow,
  AuthRoleSessionRow,
  AuthRoleSessions,
} from "../../mechanisms/agent-auth.js";

export type { AuthGenerationRow, AuthRoleSessionRow };

/** sha256 hex of a raw session token — the only form the database ever holds. */
export function authRoleSessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AuthSubjectKind = "agent" | "user";

export function resolveAuthSubject(opts: {
  subjectId?: string;
  userId?: string | null;
  projectId?: string | null;
  agentId?: string | null;
}): {
  subjectId: string;
  subjectKind: AuthSubjectKind;
  userId: string | null;
  projectId: string | null;
  agentId: string | null;
} {
  const userId = opts.userId ?? null;
  const projectId = opts.projectId ?? null;
  const agentId = opts.agentId ?? null;
  if (userId !== null && agentId === null) {
    const subjectId =
      opts.subjectId ?? (projectId !== null ? `user:${projectId}/${userId}` : `user:${userId}`);
    return { subjectId, subjectKind: "user", userId, projectId, agentId: null };
  }
  const resolvedProjectId = projectId ?? "";
  const resolvedAgentId = agentId ?? "";
  const subjectId = opts.subjectId ?? `agent:${resolvedProjectId}/${resolvedAgentId}`;
  return {
    subjectId,
    subjectKind: "agent",
    userId,
    projectId: resolvedProjectId,
    agentId: resolvedAgentId,
  };
}

function rowSubjectFields(r: Record<string, unknown>) {
  const subjectKind = (r.subject_kind as AuthSubjectKind | undefined) ?? "agent";
  const userId = (r.user_id as string | null) ?? null;
  const projectId = (r.project_id as string | null) ?? "";
  const agentId = (r.agent_id as string | null) ?? "";
  const subjectId =
    (r.subject_id as string | undefined) ??
    (subjectKind === "user" && userId !== null
      ? projectId !== ""
        ? `user:${projectId}/${userId}`
        : `user:${userId}`
      : `agent:${projectId}/${agentId}`);
  return { subjectId, subjectKind, userId, projectId, agentId };
}

@Component()
export class AuthRoleSessionsRepo implements AuthRoleSessions {
  @Use() private readonly db!: Db;

  issue(opts: {
    projectId?: string | null;
    agentId?: string | null;
    userId?: string | null;
    subjectId?: string;
    role: AgentAuthRole;
    apiIds: readonly string[];
    generation: number;
    now: Date;
    ttlMs: number;
  }): { token: string; expiresAt: string; generation: number } {
    const token = randomBytes(32).toString("base64url");
    const createdAt = opts.now.toISOString();
    const expiresAt = new Date(opts.now.getTime() + opts.ttlMs).toISOString();
    const subj = resolveAuthSubject(opts);
    const current = this.generationBySubject(subj.subjectId);
    const generation = current === null ? 0 : current.generation;
    const role = current === null ? opts.role : current.role;
    const apiIds = current === null ? opts.apiIds : current.apiIds;
    this.db
      .prepare(
        "INSERT INTO auth_role_sessions (token_hash, subject_id, subject_kind, user_id, project_id, agent_id, role, generation, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        authRoleSessionTokenHash(token),
        subj.subjectId,
        subj.subjectKind,
        subj.userId,
        subj.projectId,
        subj.agentId,
        role,
        generation,
        createdAt,
        expiresAt,
      );
    if (current === null) {
      this.db
        .prepare(
          "INSERT INTO auth_generations (subject_id, subject_kind, user_id, project_id, agent_id, generation, role, allowed_apis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          subj.subjectId,
          subj.subjectKind,
          subj.userId,
          subj.projectId,
          subj.agentId,
          generation,
          role,
          JSON.stringify(apiIds),
        );
    }
    this.deleteExpired(createdAt);
    return { token, expiresAt, generation };
  }

  findByTokenHash(tokenHash: string): AuthRoleSessionRow | null {
    const r = this.db
      .prepare("SELECT * FROM auth_role_sessions WHERE token_hash = ?")
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      ...rowSubjectFields(r),
      tokenHash: r.token_hash as string,
      role: r.role as AgentAuthRole,
      generation: r.generation as number,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
    };
  }

  generationBySubject(subjectId: string): AuthGenerationRow | null {
    const r = this.db
      .prepare("SELECT * FROM auth_generations WHERE subject_id = ?")
      .get(subjectId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      ...rowSubjectFields(r),
      generation: r.generation as number,
      role: this.coerceRole(r.role as string),
      apiIds: this.coerceApiIds(r.allowed_apis as string | null),
    };
  }

  generationOf(projectId: string, agentId: string): AuthGenerationRow | null {
    return this.generationBySubject(resolveAuthSubject({ projectId, agentId }).subjectId);
  }

  private coerceApiIds(raw: string | null): readonly string[] {
    try {
      const v = JSON.parse(raw ?? "[]") as unknown;
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
    } catch {
      return [];
    }
  }

  bumpSubjectGeneration(opts: {
    subjectId?: string;
    userId?: string | null;
    projectId?: string | null;
    agentId?: string | null;
    role: string;
    apiIds: readonly string[];
    generation: number;
  }): void {
    const subj = resolveAuthSubject(opts);
    this.db
      .prepare(
        "INSERT INTO auth_generations (subject_id, subject_kind, user_id, project_id, agent_id, generation, role, allowed_apis) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(subject_id) DO UPDATE SET generation = excluded.generation, role = excluded.role, allowed_apis = excluded.allowed_apis",
      )
      .run(
        subj.subjectId,
        subj.subjectKind,
        subj.userId,
        subj.projectId,
        subj.agentId,
        opts.generation,
        opts.role,
        JSON.stringify(opts.apiIds),
      );
  }

  bumpGeneration(
    projectId: string,
    agentId: string,
    role: string,
    apiIds: readonly string[],
    generation: number,
  ): void {
    this.bumpSubjectGeneration({ projectId, agentId, role, apiIds, generation });
  }

  touch(tokenHash: string, at: string): void {
    this.db
      .prepare("UPDATE auth_role_sessions SET last_used_at = ? WHERE token_hash = ?")
      .run(at, tokenHash);
  }

  deleteSessionsOf(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM auth_role_sessions WHERE subject_id = ?")
      .run(resolveAuthSubject({ projectId, agentId }).subjectId);
  }

  deleteBySubject(subjectId: string): void {
    this.db.prepare("DELETE FROM auth_role_sessions WHERE subject_id = ?").run(subjectId);
    this.db.prepare("DELETE FROM auth_generations WHERE subject_id = ?").run(subjectId);
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.deleteBySubject(resolveAuthSubject({ projectId, agentId }).subjectId);
  }

  deleteExpired(at: string): void {
    this.db.prepare("DELETE FROM auth_role_sessions WHERE expires_at <= ?").run(at);
  }

  private coerceRole(role: string): AgentAuthRole {
    const parsed = parseRefinedGrant(role);
    if (parsed.target !== "") {
      return parsed.refinerId !== null ? `${parsed.target}@${parsed.refinerId}` : parsed.target;
    }
    return DEFAULT_AGENT_AUTH_ROLE;
  }
}
