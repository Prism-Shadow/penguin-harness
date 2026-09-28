/**
 * The coding-agents mechanism: what the route group may require, declared apart from what
 * implements it (the service in coding-agents/service.ts over the
 * @prismshadow/penguin-coding-agents kernel).
 */
import { Interface, type Opaque } from "@prismshadow/penguin-core/kernel";
import type {
  AgentPermissionOutcome,
  AgentServerDefinition,
  AgentSessionEvent,
  AgentSessionOptions,
} from "@prismshadow/penguin-coding-agents";
import type { ChannelApi } from "../hmr/capabilities.js";
import type { RuntimeSession } from "../runtime/session-manager.js";
import type {
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
  CodingAgentSessionDetailResponse,
  CodingAgentSessionInfo,
  CodingAgentTestResult,
} from "../api/types.js";

export abstract class CodingAgents extends Interface<{
  /** `withEnv` adds each agent's masked variables; the route passes it for admins only. */
  listAgents(opts?: { withEnv?: boolean }): CodingAgentServerInfo[];
  /**
   * Probe the server machine for known agents. Read-only and cached — any user, it is
   * what the card view is built from. `refresh` re-runs the live probes (versions,
   * auth, advertised models) and stays admin-only: it executes what it finds.
   */
  discoverAgents(refresh?: boolean, probeTimeoutMs?: number): Promise<CodingAgentDiscoveryResponse>;
  /** Validate and persist a custom agent definition (admin-managed, server-global). */
  saveAgent(input: unknown): CodingAgentServerInfo;
  removeAgent(agentId: string): boolean;
  /**
   * Replace an agent's environment variables (Vault rules: an entry without a value keeps the
   * stored one; a key not listed is removed). A detected agent's definition is saved first.
   * Refused for a built-in definition, whose variables its own service owns.
   */
  setAgentEnv(
    agentId: string,
    entries: { key: string; value?: string }[],
  ): Promise<CodingAgentServerInfo>;
  /** For the built-in agents service only: write its definition, bypassing the Local CLI guard. */
  saveBuiltinDefinition(definition: AgentServerDefinition): void;
  /** For the built-in agents service only: drop its definition. */
  removeBuiltinDefinition(agentId: string): boolean;
  /**
   * For the built-in agents service only: the built-in definitions with their real env, so it
   * can read its own token. Never returned from a route.
   */
  listDefinitionsForBuiltin(): AgentServerDefinition[];
  /** Remember the model a card picked for this agent; auto-applied to its new sessions. */
  setAgentModel(
    agentId: string,
    model: { configId: string; value: boolean | string; name?: string },
  ): void;
  /**
   * Remember one other session setting for this agent (a reasoning effort, say); applied to
   * its new sessions after the model. The model itself goes through `setAgentModel`.
   */
  setAgentOption(agentId: string, option: { configId: string; value: boolean | string }): void;
  /**
   * Start the agent with its remembered settings in a throwaway workspace, ask it to answer
   * "ok", and report how that went; the session and workspace are gone afterwards. Anything
   * the agent asks permission for is refused. Admin-only at the route: it runs the agent.
   */
  testAgent(agentId: string, timeoutMs?: number): Promise<CodingAgentTestResult>;
  listSessions(): CodingAgentSessionInfo[];
  /**
   * `options.protectedRoots` names folders the agent may read but not change: permission
   * asks touching them are refused before anyone sees them.
   */
  createSession(
    agentId: string,
    workspaceDir: string,
    options?: AgentSessionOptions,
  ): Promise<CodingAgentSessionInfo>;
  /**
   * Reopen a session an earlier process started, in the workspace it ran in. Refused when
   * the agent advertises no way to reopen one; a session still open is returned as is.
   */
  resumeSession(
    agentId: string,
    workspaceDir: string,
    sessionId: string,
  ): Promise<CodingAgentSessionInfo>;
  /** Set the session's display title (trimmed, max 120); empty clears it back to the default. */
  renameSession(sessionId: string, title: string): CodingAgentSessionInfo;
  sessionDetail(sessionId: string): CodingAgentSessionDetailResponse | undefined;
  /**
   * The session's transcript as a Markdown download document (undefined: unknown session).
   * Built from the same in-memory state + bounded event log the detail route serves.
   */
  sessionTranscript(sessionId: string): { markdown: string; filename: string } | undefined;
  /** The SSE channel a session's events are published to (created with the session). */
  channelFor(sessionId: string): ChannelApi | undefined;
  prompt(sessionId: string, text: string): void;
  cancel(sessionId: string): Promise<void>;
  setMode(sessionId: string, modeId: string): Promise<void>;
  setConfigOption(sessionId: string, configId: string, value: boolean | string): Promise<void>;
  respondPermission(requestId: string, outcome: AgentPermissionOutcome): boolean;
  /**
   * A new Penguin Session run by a coding agent: `modelId` names the agent, optionally with
   * one of its models (`<agent>::<configId>::<value>`). The agent's session opens in
   * `workspace`, or in a new temporary one under the owning Penguin Agent. The runtime is
   * what the session manager drives; it writes the Session's Trace.
   */
  openSessionRuntime(args: {
    projectId: string;
    agentId: string;
    modelId: string;
    workspace?: string;
    /**
     * Folders the agent may read but not change: its permission asks touching them are
     * refused. Held for this process's life; a reopened Session does not carry them, as a
     * resumed core Session does not.
     */
    protectedRoots?: { root: string; label: string }[];
  }): Promise<
    Opaque<
      "CodingAgentSessionRuntime",
      { sessionId: string; workspace: string; runtime: RuntimeSession }
    >
  >;
  /**
   * Reopen a coding-agent Session an earlier process started: the agent's own session is
   * resumed where the agent can, otherwise a fresh one continues it with a note saying so;
   * either way the Trace carries on where it stopped.
   */
  loadSessionRuntime(row: {
    sessionId: string;
    projectId: string;
    agentId: string;
    provider: string;
    modelId: string;
    workspace: string;
  }): Promise<Opaque<"RuntimeSession", RuntimeSession>>;
  disposeSession(sessionId: string): Promise<void>;
}>() {}
