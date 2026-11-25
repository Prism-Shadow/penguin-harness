/**
 * The Agent API mechanism: what a node may require of the per-Agent API settings and keys,
 * declared apart from what implements it (db/repos/agent-api.ts).
 *
 * This server's own state, kept in web.db: never in the Agent State (the Agent must not be able
 * to expose itself or loosen the approvals its API conversations run with) and never in the
 * Project file (synchronized across machines in company mode, while exposure is one server's).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { ThinkingLevelName } from "@prismshadow/penguin-core/interfaces";
import type { ApprovalMode } from "@prismshadow/penguin-library-session";

/** The default for API admission, preserved for Agents configured before this setting existed. */
export const DEFAULT_API_CONCURRENT_RUNS = 4;

/** One Agent's API settings row. */
export interface AgentApiRow extends Omit<AgentApiSettings, "keys"> {
  projectId: string;
  agentId: string;
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
export type AgentApiPatch = AgentApiUpdateRequest;

/** AgentApi: the mechanism AgentApiRepo implements. */
/**
 * From packages/server (api/types.ts): a provider+model pair. The definition lives with the
 * session contract (SessionInfo names it, services+http+cli restack S14); re-exported here
 * unchanged.
 */
export { type ModelRefDto } from "@prismshadow/penguin-library-session";
import type { ModelRefDto } from "@prismshadow/penguin-library-session";

/** From packages/server (api/types.ts): the agent API tab's settings and the patch the
 * admin PATCH takes. The contract names them, so the types live with the contract. */

/** One API key of an Agent, as listed: the secret itself is shown once, at creation, and never again. */
export interface AgentApiKeyInfo {
  keyId: string;
  /** 1-64 characters, given by whoever created it. */
  name: string;
  /** The key's first 16 characters (`penguin_` + 8), enough to tell keys apart. */
  prefix: string;
  /** user_id of the Project owner who created it. */
  createdBy: string;
  createdAt: string;
  /** Last run request that authenticated with it; null = never used. */
  lastUsedAt: string | null;
}

/**
 * One Agent's public API settings — this server's, kept in web.db, never in the Agent State or
 * the Project file, so the Agent cannot expose itself or loosen its own approvals. An Agent
 * never configured reads as disabled, keyed, allow-all, with no keys.
 */
export interface AgentApiSettings {
  /** The API tab's switch; off = every AMSP request for this Agent is 404 `agent_not_found`. */
  enabled: boolean;
  /** Keyless access: a request without `Authorization` is accepted; off = 401 `unauthorized`. */
  open: boolean;
  /**
   * The approval mode an API Session is created with. It is copied onto each API Session when
   * that Session is created, and the Session's own mode is what every decision reads, so a
   * change here applies to API Sessions created afterwards.
   */
  approvalMode: ApprovalMode;
  /** Null follows the Project's default model. Applied only to new API Sessions. */
  model: ModelRefDto | null;
  /** Null follows the Agent/Project thinking configuration. */
  thinkingLevel: ThinkingLevelName | null;
  /** Null creates a temporary Workspace for each new API Session. */
  workspace: string | null;
  /** Positive integer. Checked for each API run; defaults to four concurrent Agent sessions. */
  maxConcurrentRuns: number;
  keys: AgentApiKeyInfo[];
}

export interface AgentApiUpdateRequest {
  enabled?: boolean;
  open?: boolean;
  approvalMode?: ApprovalMode;
  model?: ModelRefDto | null;
  thinkingLevel?: ThinkingLevelName | null;
  workspace?: string | null;
  maxConcurrentRuns?: number;
}

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
