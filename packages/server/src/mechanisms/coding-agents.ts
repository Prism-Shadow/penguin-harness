/**
 * The coding-agents mechanism: what the route group may require, declared apart from what
 * implements it (the service in coding-agents/service.ts over the
 * @prismshadow/penguin-coding-agents kernel).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AgentPermissionOutcome, AgentSessionEvent } from "@prismshadow/penguin-coding-agents";
import type { ChannelApi } from "../hmr/capabilities.js";
import type {
  CodingAgentDiscoveryCandidate,
  CodingAgentServerInfo,
  CodingAgentSessionDetailResponse,
  CodingAgentSessionInfo,
} from "../api/types.js";

export abstract class CodingAgents extends Interface<{
  listAgents(): CodingAgentServerInfo[];
  /** Probe the server machine for known agents (admin: host reconnaissance). */
  discoverAgents(): Promise<CodingAgentDiscoveryCandidate[]>;
  /** Validate and persist a custom agent definition (admin-managed, server-global). */
  saveAgent(input: unknown): CodingAgentServerInfo;
  removeAgent(agentId: string): boolean;
  listSessions(): CodingAgentSessionInfo[];
  createSession(agentId: string, workspaceDir: string): Promise<CodingAgentSessionInfo>;
  sessionDetail(sessionId: string): CodingAgentSessionDetailResponse | undefined;
  /** The SSE channel a session's events are published to (created with the session). */
  channelFor(sessionId: string): ChannelApi | undefined;
  prompt(sessionId: string, text: string): void;
  cancel(sessionId: string): Promise<void>;
  setMode(sessionId: string, modeId: string): Promise<void>;
  setConfigOption(sessionId: string, configId: string, value: boolean | string): Promise<void>;
  respondPermission(requestId: string, outcome: AgentPermissionOutcome): boolean;
  disposeSession(sessionId: string): Promise<void>;
}>() {}
