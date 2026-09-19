/**
 * The coding-agents runtime service: bridges the ACP kernel (packages/coding-agents) into
 * the server's world. Owns three seams:
 * - definitions: persisted as one JSON setting (`coding_agent_servers`), handed to the
 *   kernel manager, which stays storage-free;
 * - child environments: the kernel spawns whatever a definition names, so the env it gets
 *   is an allow-list of this process's environment plus the definition's own vars — never
 *   a wholesale `process.env`;
 * - events: every session gets a Channel (`coding-agent:<id>`); kernel events publish
 *   there as `coding_agent` SSE events, so replay/resync come for free from the hub.
 *
 * Coding-agent sessions are deliberately NOT core Sessions: they have no Trace, no model
 * config and no usage accounting, and they live in memory for the App's lifetime (the
 * agent process dies with it). Making them first-class — a session `source`, Trace
 * adoption, resume — is the registered follow-up.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { VERSION } from "@prismshadow/penguin-core";
import {
  CodingAgentManager,
  parseDefinition,
  sandboxedAgentEnv,
  type AgentPermissionOutcome,
  type AgentServerDefinition,
  type AgentSessionEvent,
} from "@prismshadow/penguin-coding-agents";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CodingAgentServerInfo,
  CodingAgentSessionDetailResponse,
  CodingAgentSessionInfo,
} from "../api/types.js";
import { Channels, Config, type ChannelApi } from "../hmr/capabilities.js";
import { Settings } from "../mechanisms/settings.js";
import { CodingAgents } from "../mechanisms/coding-agents.js";
import { AcpAgentError } from "@prismshadow/penguin-coding-agents";

/** The settings key holding the custom definitions as a JSON array. */
const DEFINITIONS_KEY = "coding_agent_servers";

/** Agent credential/state homes live under the data root, keyed by definition id. */
function agentHome(root: string, agentId: string): string {
  return path.join(root, "coding-agents", agentId);
}

@Component()
export class CodingAgentService implements CodingAgents {
  @Use() private readonly channels!: Channels;
  @Use() private readonly config!: Config;
  @Use() private readonly settings!: Settings;

  private manager: CodingAgentManager | null = null;
  private readonly unbridges = new Map<string, () => void>();

  private getManager(): CodingAgentManager {
    if (this.manager === null) {
      this.manager = new CodingAgentManager({
        clientInfo: { name: "penguin", version: VERSION },
        envFor: (definition) => this.envFor(definition),
      });
      this.manager.setDefinitions(this.loadDefinitions());
    }
    return this.manager;
  }

  listAgents(): CodingAgentServerInfo[] {
    return this.getManager()
      .listDefinitions()
      .map((d) => ({
        id: d.id,
        command: d.command,
        args: d.args ?? [],
        ...(d.title !== undefined ? { title: d.title } : {}),
      }));
  }

  saveAgent(input: unknown): CodingAgentServerInfo {
    const definition: AgentServerDefinition = parseDefinition(input);
    const definitions = this.loadDefinitions().filter((d) => d.id !== definition.id);
    definitions.push(definition);
    this.settings.set(DEFINITIONS_KEY, JSON.stringify(definitions));
    this.getManager().setDefinitions([...definitions]);
    return {
      id: definition.id,
      command: definition.command,
      args: definition.args ?? [],
      ...(definition.title !== undefined ? { title: definition.title } : {}),
    };
  }

  removeAgent(agentId: string): boolean {
    const definitions = this.loadDefinitions();
    const remaining = definitions.filter((d) => d.id !== agentId);
    if (remaining.length === definitions.length) return false;
    this.settings.set(DEFINITIONS_KEY, JSON.stringify(remaining));
    this.getManager().setDefinitions([...remaining]);
    return true;
  }

  listSessions(): CodingAgentSessionInfo[] {
    return this.getManager()
      .listSessions()
      .map((s) => this.toInfo(s));
  }

  async createSession(agentId: string, workspaceDir: string): Promise<CodingAgentSessionInfo> {
    const manager = this.getManager();
    const definition = manager.listDefinitions().find((d) => d.id === agentId);
    if (definition === undefined) {
      throw new AcpAgentError(`unknown agent: ${agentId}`);
    }
    await fs.mkdir(agentHome(this.config.root, agentId), { recursive: true, mode: 0o700 });
    const view = await manager.createSession(agentId, workspaceDir);
    const channel = this.channels.get(`coding-agent:${view.sessionId}`);
    // Bridge kernel events into the channel hub: replay/resync then belong to the hub.
    const unbridge = manager.subscribe(view.sessionId, (event: AgentSessionEvent) => {
      channel.publish(event, "coding_agent");
    });
    this.unbridges.set(view.sessionId, unbridge);
    return this.toInfo(view);
  }

  sessionDetail(sessionId: string): CodingAgentSessionDetailResponse | undefined {
    const view = this.getManager().sessionView(sessionId);
    if (view === undefined) return undefined;
    return { ...this.toInfo(view), events: view.events };
  }

  channelFor(sessionId: string): ChannelApi | undefined {
    if (this.getManager().sessionView(sessionId) === undefined) return undefined;
    return this.channels.get(`coding-agent:${sessionId}`);
  }

  prompt(sessionId: string, text: string): void {
    // Fire-and-forget by design: the turn streams over the session channel; the POST
    // answers 202 immediately (the session-tasks pattern). Turn failures land in the
    // log as turn_end failed.
    void this.getManager()
      .prompt(sessionId, text)
      .catch(() => undefined);
  }

  async cancel(sessionId: string): Promise<void> {
    await this.getManager().cancel(sessionId);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.getManager().setMode(sessionId, modeId);
  }

  respondPermission(requestId: string, outcome: AgentPermissionOutcome): boolean {
    return this.getManager().respondPermission(requestId, outcome);
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.unbridges.get(sessionId)?.();
    this.unbridges.delete(sessionId);
    await this.getManager().disposeSession(sessionId);
  }

  // --- internals ---------------------------------------------------------------------------

  private loadDefinitions(): AgentServerDefinition[] {
    const raw = this.settings.get(DEFINITIONS_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // One bad entry must not take the whole registry down; parseDefinition throws on it.
      const definitions: AgentServerDefinition[] = [];
      for (const entry of parsed) {
        try {
          definitions.push(parseDefinition(entry));
        } catch {
          // Skip the malformed entry.
        }
      }
      return definitions;
    } catch {
      return [];
    }
  }

  private envFor(definition: AgentServerDefinition): Record<string, string> {
    const extra: Record<string, string> = {
      ...definition.env,
      PENGUIN_CODING_AGENT_HOME: agentHome(this.config.root, definition.id),
      // Login flows open on the host, not in a browser the agent can spawn.
      NO_BROWSER: "1",
    };
    const url = this.settings.getProxyUrl();
    if (url !== null && url !== "" && this.settings.getProxyForAgent()) {
      extra.HTTPS_PROXY = url;
      extra.HTTP_PROXY = url;
    }
    return sandboxedAgentEnv(extra);
  }

  private toInfo(view: {
    sessionId: string;
    definitionId: string;
    workspaceDir: string;
    busy: boolean;
    createdAt: number;
  }): CodingAgentSessionInfo {
    return {
      sessionId: view.sessionId,
      agentId: view.definitionId,
      workspaceDir: view.workspaceDir,
      busy: view.busy,
      createdAt: view.createdAt,
    };
  }
}
