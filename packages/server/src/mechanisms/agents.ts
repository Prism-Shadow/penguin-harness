/**
 * The agents mechanisms: what a node may require, declared apart from what implements it.
 * The agent domain's mechanisms (AgentConfig, Memory, Snapshots) moved to the agent domain
 * library (services+http+cli restack S3 and S9d) and are re-exported here unchanged; the
 * lifecycle mechanism stays with its server-side service.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AgentDeletionInfo } from "../api/types.js";
import type { AgentCreation, AgentListItem } from "../services/agent-service.js";
export { AgentConfig, Memory } from "@prismshadow/penguin-library-agent/contract";

/** The snapshot mechanism and its package vocabulary moved to the agent domain library
 * (services+http+cli restack S9d); re-exported here so the server's import paths keep one site. */
export { Snapshots } from "@prismshadow/penguin-library-agent/contract";
export type { AgentPackage } from "@prismshadow/penguin-library-agent/contract";

/** AgentLifecycle: the mechanism AgentService implements. */
@Interface()
export abstract class AgentLifecycle {
  abstract listAgents(projectId: string): Promise<AgentListItem[]>;
  /** Every id `createAgent` refuses as taken, as names only, including a folder that does not list. */
  abstract takenAgentIds(projectId: string): Promise<string[]>;
  /**
   * Moves the Agent's folder out of the agents directory in one rename and drops its index row,
   * so it is gone from every list and route at once; its files are then removed in the
   * background, as the returned deletion reports. Refuses a built-in Agent, and a folder another
   * program holds open (409 `agent_folder_busy`, nothing deleted).
   */
  abstract deleteAgent(projectId: string, agentId: string): Promise<AgentDeletionInfo>;
  /** Where one deletion stands; null once it is unknown here (finished long ago, or never was). */
  abstract agentDeletion(projectId: string, deletionId: string): AgentDeletionInfo | null;
  /** Removes whatever deleted Agents left behind when the server last stopped mid-removal. */
  abstract resumeDeletions(): Promise<void>;
  abstract createAgent(
    projectId: string,
    agentId: string,
    creation?: AgentCreation,
  ): Promise<AgentListItem>;
  abstract pluginVersion(
    projectId: string,
    agentId: string,
    pluginName: string,
  ): Promise<{ installed: string | null; library: string | null }>;
  abstract updatePlugin(projectId: string, agentId: string, pluginName: string): Promise<void>;
}
