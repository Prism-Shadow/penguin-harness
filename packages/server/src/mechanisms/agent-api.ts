/**
 * The Agent API mechanism: what a node may require of the per-Agent API settings and keys,
 * declared apart from what implements it (db/repos/agent-api.ts).
 *
 * This server's own state, kept in web.db: never in the Agent State (the Agent must not be able
 * to expose itself or loosen the approvals its API conversations run with) and never in the
 * Project file (synchronized across machines in company mode, while exposure is one server's).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { ApprovalMode } from "../api/types.js";

/** One Agent's API settings row. */
export interface AgentApiRow {
  projectId: string;
  agentId: string;
  /** The API tab's switch: off = every /api/amsp request for the Agent is 404 `agent_not_found`. */
  enabled: boolean;
  /** Keyless access: a request without `Authorization` is accepted; off = 401 `unauthorized`. */
  open: boolean;
  /** The approval mode an API Session is created with (copied onto its row, never read per decision). */
  approvalMode: ApprovalMode;
  updatedAt: string;
}

/** One API key as stored, minus its hash: what the list shows and what authentication resolves to. */
export interface AgentApiKeyRow {
  keyId: string;
  projectId: string;
  agentId: string;
  /** The key's first 16 characters (`penguin_` + 8). */
  prefix: string;
  name: string;
  /** user_id of whoever created it. */
  createdBy: string;
  createdAt: string;
  /** Stamped once per run request that authenticated with it; null = never used. */
  lastUsedAt: string | null;
}

/** The fields a settings write may change; omitted ones keep their stored value. */
export interface AgentApiPatch {
  enabled?: boolean;
  open?: boolean;
  approvalMode?: ApprovalMode;
}

/** AgentApi: the mechanism AgentApiRepo implements. */
@Interface()
export abstract class AgentApi {
  /** The Agent's row; null = never configured, which reads as disabled, keyed, allow-all. */
  abstract get(projectId: string, agentId: string): AgentApiRow | null;
  /** Writes the patch over the stored row (or the defaults) and returns the row as stored. */
  abstract set(projectId: string, agentId: string, patch: AgentApiPatch, at: string): AgentApiRow;
  /** The Project's Agents whose switch is on, in one query (the Agent list's `apiEnabled`). */
  abstract enabledAgents(projectId: string): string[];
  /** The Agent's keys, oldest first. */
  abstract listKeys(projectId: string, agentId: string): AgentApiKeyRow[];
  abstract insertKey(row: AgentApiKeyRow & { tokenHash: string }): void;
  /** The key whose secret hashes to `tokenHash`; null when none does. */
  abstract findKeyByHash(tokenHash: string): AgentApiKeyRow | null;
  abstract touchKey(keyId: string, at: string): void;
  /** Hard delete; false when the Agent has no such key. */
  abstract deleteKey(projectId: string, agentId: string, keyId: string): boolean;
  /** Drops the Agent's settings and keys (the Agent was deleted). */
  abstract deleteByAgent(projectId: string, agentId: string): void;
  /** Drops every settings row and key of the Project (the Project was deleted). */
  abstract deleteByProject(projectId: string): void;
}
