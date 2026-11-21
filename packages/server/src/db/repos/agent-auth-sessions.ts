/**
 * agent_auth_sessions / agent_auth_generations table repos: the Agent auth-session mechanism's
 * storage. The shape mirrors the user auth's auth-sessions repo (sha256 only; `issue()` is the
 * ONE minting point), keyed on the Agent instead of the user, plus one generations row per
 * Agent whose CURRENT generation every live session re-derives its grant from.
 */
import { createHash, randomBytes } from "node:crypto";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import {
  isAgentAuthRole,
  parseRefinedGrant,
  type AgentAuthRole,
} from "../../auth/agent-roles.js";
import type { AgentAuthSessions } from "../../mechanisms/agent-auth.js";

/** sha256 hex of a raw session token — the only form the database ever holds. */
export function agentSessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

/** The CURRENT generation and role of one Agent, as the re-derivation reads them. */
export interface AgentAuthGenerationRow {
  projectId: string;
  agentId: string;
  generation: number;
  role: AgentAuthRole;
  /** The explicitly granted HTTP route ids. */
  apiIds: readonly string[];
}

function toSessionRow(r: Record<string, unknown>): AgentAuthSessionRow {
  return {
    tokenHash: r.token_hash as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    role: r.role as AgentAuthRole,
    generation: r.generation as number,
    createdAt: r.created_at as string,
    expiresAt: r.expires_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  };
}

@Component()
export class AgentAuthSessionsRepo implements AgentAuthSessions {
  @Use() private readonly db!: Db;

  /** Mints a session and returns the raw token; the Agent stores it, the row its hash. */
  issue(opts: {
    projectId: string;
    agentId: string;
    role: AgentAuthRole;
    apiIds: readonly string[];
    generation: number;
    now: Date;
    ttlMs: number;
  }): { token: string; expiresAt: string; generation: number } {
    const token = randomBytes(32).toString("base64url");
    const createdAt = opts.now.toISOString();
    const expiresAt = new Date(opts.now.getTime() + opts.ttlMs).toISOString();
    const current = this.generationOf(opts.projectId, opts.agentId);
    const generation = current === null ? 0 : current.generation;
    const role = current === null ? opts.role : current.role;
    const apiIds = current === null ? opts.apiIds : current.apiIds;
    this.db
      .prepare(
        "INSERT INTO agent_auth_sessions (token_hash, project_id, agent_id, role, generation, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        agentSessionTokenHash(token),
        opts.projectId,
        opts.agentId,
        role,
        generation,
        createdAt,
        expiresAt,
      );
    // First session of the Agent seeds the generation row; later ones re-read it so every
    // session of one Agent carries the same CURRENT grant whatever was asked for.
    if (current === null) {
      this.db
        .prepare(
          "INSERT INTO agent_auth_generations (project_id, agent_id, generation, role, allowed_apis) VALUES (?, ?, ?, ?, ?)",
        )
        .run(opts.projectId, opts.agentId, generation, role, JSON.stringify(apiIds));
    }
    this.deleteExpired(createdAt);
    return { token, expiresAt, generation };
  }

  findByTokenHash(tokenHash: string): AgentAuthSessionRow | null {
    const r = this.db
      .prepare("SELECT * FROM agent_auth_sessions WHERE token_hash = ?")
      .get(tokenHash);
    return r ? toSessionRow(r as Record<string, unknown>) : null;
  }

  /** The Agent's CURRENT generation row; null before its first session (nothing to derive from). */
  generationOf(projectId: string, agentId: string): AgentAuthGenerationRow | null {
    const r = this.db
      .prepare(
        "SELECT * FROM agent_auth_generations WHERE project_id = ? AND agent_id = ?",
      )
      .get(projectId, agentId);
    if (!r) return null;
    return {
      projectId: r.project_id as string,
      agentId: r.agent_id as string,
      generation: r.generation as number,
      role: this.coerceRole(r.role as string),
      apiIds: this.coerceApiIds(r.allowed_apis as string | null),
    };
  }

  /** The granted route ids as the row stores them (JSON array); a bad shape reads as none. */
  private coerceApiIds(raw: string | null): readonly string[] {
    try {
      const v = JSON.parse(raw ?? "[]") as unknown;
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Bumps the Agent's generation to `generation` with the new role and granted route ids.
   * Every live session keeps its token but re-derives its grant from this row at its next
   * request — hot reload without re-issue, and no dangling grant from an older generation
   * survives a request.
   */
  bumpGeneration(
    projectId: string,
    agentId: string,
    role: string,
    apiIds: readonly string[],
    generation: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO agent_auth_generations (project_id, agent_id, generation, role, allowed_apis) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, agent_id) DO UPDATE SET generation = excluded.generation, role = excluded.role, allowed_apis = excluded.allowed_apis",
      )
      .run(projectId, agentId, generation, role, JSON.stringify(apiIds));
  }

  touch(tokenHash: string, at: string): void {
    this.db
      .prepare("UPDATE agent_auth_sessions SET last_used_at = ? WHERE token_hash = ?")
      .run(at, tokenHash);
  }

  /** Drops the Agent's sessions; the generation row stays, so a re-created id re-derives from it. */
  deleteSessionsOf(projectId: string, agentId: string): void {
    this.db
      .prepare(
        "DELETE FROM agent_auth_sessions WHERE project_id = ? AND agent_id = ?",
      )
      .run(projectId, agentId);
  }

  /** Drops everything of the Agent — sessions AND its generation row (the Agent is gone). */
  deleteByAgent(projectId: string, agentId: string): void {
    this.deleteSessionsOf(projectId, agentId);
    this.db
      .prepare("DELETE FROM agent_auth_generations WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteExpired(at: string): void {
    this.db
      .prepare("DELETE FROM agent_auth_sessions WHERE expires_at <= ?")
      .run(at);
  }

  /** A role the table names that this build knows (including `<role>@<refinerId>`); unknown ones fall back to `general`. */
  private coerceRole(role: string): AgentAuthRole {
    const parsed = parseRefinedGrant(role);
    if (isAgentAuthRole(parsed.target)) {
      return (
        parsed.refinerId !== null ? `${parsed.target}@${parsed.refinerId}` : parsed.target
      ) as AgentAuthRole;
    }
    return "general";
  }
}
