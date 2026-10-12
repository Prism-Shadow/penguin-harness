/**
 * agent_api / agent_api_keys tables repo: each Agent's public API settings (the switch, keyless
 * access, the approval mode its API Sessions are created with) and its keys, stored as sha256
 * hashes — the caller alone holds a key. Neither table is rebuildable from files: dropping them
 * turns every exposed Agent off and invalidates every key.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ApprovalMode } from "../../api/types.js";
import type { Db } from "../../hmr/capabilities.js";
import type {
  AgentApi,
  AgentApiKeyRow,
  AgentApiPatch,
  AgentApiRow,
} from "../../mechanisms/agent-api.js";

type Row = Record<string, unknown>;

function settingsOf(r: Row): AgentApiRow {
  return {
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    enabled: Number(r.enabled) === 1,
    open: Number(r.open) === 1,
    approvalMode: r.approval_mode as ApprovalMode,
    updatedAt: r.updated_at as string,
  };
}

function keyOf(r: Row): AgentApiKeyRow {
  return {
    keyId: r.key_id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    prefix: r.prefix as string,
    name: r.name as string,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  };
}

@Component()
export class AgentApiRepo implements AgentApi {
  @Use() private readonly db!: Db;

  get(projectId: string, agentId: string): AgentApiRow | null {
    const r = this.db
      .prepare("SELECT * FROM agent_api WHERE project_id = ? AND agent_id = ?")
      .get(projectId, agentId);
    return r ? settingsOf(r as Row) : null;
  }

  set(projectId: string, agentId: string, patch: AgentApiPatch, at: string): AgentApiRow {
    const current = this.get(projectId, agentId);
    const next: AgentApiRow = {
      projectId,
      agentId,
      enabled: patch.enabled ?? current?.enabled ?? false,
      open: patch.open ?? current?.open ?? false,
      approvalMode: patch.approvalMode ?? current?.approvalMode ?? "allow-all",
      updatedAt: at,
    };
    this.db
      .prepare(
        `INSERT INTO agent_api (project_id, agent_id, enabled, open, approval_mode, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, agent_id) DO UPDATE SET
           enabled = excluded.enabled, open = excluded.open,
           approval_mode = excluded.approval_mode, updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        agentId,
        next.enabled ? 1 : 0,
        next.open ? 1 : 0,
        next.approvalMode,
        next.updatedAt,
      );
    return next;
  }

  enabledAgents(projectId: string): string[] {
    const rows = this.db
      .prepare("SELECT agent_id FROM agent_api WHERE project_id = ? AND enabled = 1")
      .all(projectId) as Row[];
    return rows.map((r) => r.agent_id as string);
  }

  listKeys(projectId: string, agentId: string): AgentApiKeyRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_api_keys WHERE project_id = ? AND agent_id = ?
         ORDER BY created_at, key_id`,
      )
      .all(projectId, agentId) as Row[];
    return rows.map(keyOf);
  }

  insertKey(row: AgentApiKeyRow & { tokenHash: string }): void {
    this.db
      .prepare(
        `INSERT INTO agent_api_keys
           (key_id, project_id, agent_id, token_hash, prefix, name, created_by, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.keyId,
        row.projectId,
        row.agentId,
        row.tokenHash,
        row.prefix,
        row.name,
        row.createdBy,
        row.createdAt,
        row.lastUsedAt,
      );
  }

  findKeyByHash(tokenHash: string): AgentApiKeyRow | null {
    const r = this.db.prepare("SELECT * FROM agent_api_keys WHERE token_hash = ?").get(tokenHash);
    return r ? keyOf(r as Row) : null;
  }

  touchKey(keyId: string, at: string): void {
    this.db.prepare("UPDATE agent_api_keys SET last_used_at = ? WHERE key_id = ?").run(at, keyId);
  }

  deleteKey(projectId: string, agentId: string, keyId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM agent_api_keys WHERE key_id = ? AND project_id = ? AND agent_id = ?")
      .run(keyId, projectId, agentId);
    return Number(result.changes) > 0;
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM agent_api_keys WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
    this.db
      .prepare("DELETE FROM agent_api WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM agent_api_keys WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM agent_api WHERE project_id = ?").run(projectId);
  }
}
