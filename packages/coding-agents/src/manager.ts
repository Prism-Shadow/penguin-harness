/**
 * The coding-agents runtime: a registry of agent definitions, one pooled ACP connection per
 * definition, and per-session state (busy flag, pending permission waiters, bounded event
 * log). Storage is the host's job — the host hands the current definition list in and reads
 * sessions back out as views; nothing here touches disk or HTTP.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import {
  AcpConnection,
  type AcpClientInfo,
  type AcpConnectionHandlers,
  type SpawnProcess,
} from "./connection.js";
import { resolveCommandPath } from "./resolve.js";
import {
  AcpAgentError,
  type AgentPermissionOutcome,
  type AgentPermissionRequest,
  type AgentServerDefinition,
  type AgentSessionEvent,
  type AgentModes,
  type AgentStopReason,
  type AgentToolCall,
} from "./types.js";

const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_LOGGED_EVENTS = 4_000;
/** After `session/cancel`, how long an agent gets to report the turn's end itself. */
const CANCEL_GRACE_MS = 15_000;

export interface CodingAgentManagerOptions {
  clientInfo: AcpClientInfo;
  /** Full child environment for a definition's process (sandboxed base + its extras). */
  envFor: (definition: AgentServerDefinition) => Record<string, string>;
  spawnProcess?: SpawnProcess;
  /**
   * Connection override for tests: in-process fake agents instead of spawned ones.
   * The default spawns `command args` and initializes the ACP handshake.
   */
  createConnection?: (
    definition: AgentServerDefinition,
    handlers: AcpConnectionHandlers,
  ) => Promise<AcpConnection>;
  permissionTimeoutMs?: number;
  maxLoggedEvents?: number;
}

export interface AgentSessionView {
  sessionId: string;
  definitionId: string;
  workspaceDir: string;
  busy: boolean;
  createdAt: number;
  /** The bounded event log, oldest first — enough to rebuild the transcript. */
  events: AgentSessionEvent[];
}

interface SessionRecord {
  sessionId: string;
  definitionId: string;
  workspaceDir: string;
  busy: boolean;
  createdAt: number;
  /** Increments per turn; stale turn endings (a cancelled turn's grace timer) drop out. */
  turnSeq: number;
  modes: AgentModes | null;
  permissions: Map<
    string,
    { resolve: (outcome: AgentPermissionOutcome) => void; timer: NodeJS.Timeout }
  >;
  log: AgentSessionEvent[];
}

export class CodingAgentManager {
  private readonly definitions = new Map<string, AgentServerDefinition>();
  private readonly connections = new Map<string, AcpConnection>();
  private readonly pendingConnections = new Map<string, Promise<AcpConnection>>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly liveListeners = new Map<string, Set<(event: AgentSessionEvent) => void>>();
  private permissionSeq = 0;

  private readonly clientInfo: AcpClientInfo;
  private readonly envFor: (definition: AgentServerDefinition) => Record<string, string>;
  private readonly spawnProcess: SpawnProcess | undefined;
  private readonly createConnection: (
    definition: AgentServerDefinition,
    handlers: AcpConnectionHandlers,
  ) => Promise<AcpConnection>;
  private readonly permissionTimeoutMs: number;
  private readonly maxLoggedEvents: number;

  constructor(options: CodingAgentManagerOptions) {
    this.clientInfo = options.clientInfo;
    this.envFor = options.envFor;
    this.spawnProcess = options.spawnProcess;
    this.createConnection =
      options.createConnection ??
      ((definition, handlers) => this.spawnConnection(definition, handlers));
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
    this.maxLoggedEvents = options.maxLoggedEvents ?? DEFAULT_MAX_LOGGED_EVENTS;
  }

  /** Replace the definition registry with the host's current list (storage lives host-side). */
  setDefinitions(definitions: AgentServerDefinition[]): void {
    this.definitions.clear();
    for (const definition of definitions) this.definitions.set(definition.id, definition);
  }

  listDefinitions(): AgentServerDefinition[] {
    return [...this.definitions.values()].map((d) => ({
      ...d,
      args: [...(d.args ?? [])],
      env: { ...(d.env ?? {}) },
    }));
  }

  listSessions(): AgentSessionView[] {
    return [...this.sessions.values()].map((r) => this.viewOf(r));
  }

  sessionView(sessionId: string): AgentSessionView | undefined {
    const record = this.sessions.get(sessionId);
    return record === undefined ? undefined : this.viewOf(record);
  }

  /** Subscribe to a session's live events; returns the unsubscribe. */
  subscribe(sessionId: string, listener: (event: AgentSessionEvent) => void): () => void {
    this.requireSession(sessionId);
    const set = this.liveListeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.liveListeners.set(sessionId, set);
    return () => {
      const current = this.liveListeners.get(sessionId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.liveListeners.delete(sessionId);
    };
  }

  async createSession(definitionId: string, workspaceDir: string): Promise<AgentSessionView> {
    const definition = this.definitions.get(definitionId);
    if (definition === undefined) {
      throw new AcpAgentError(`unknown agent: ${definitionId}`);
    }
    if (!path.isAbsolute(workspaceDir)) {
      throw new AcpAgentError("workspaceDir must be an absolute path.");
    }
    const stat = await fs.stat(workspaceDir).catch(() => undefined);
    if (stat === undefined || !stat.isDirectory()) {
      throw new AcpAgentError(`workspaceDir does not exist or is not a directory: ${workspaceDir}`);
    }
    // Spawn and handshake failures arrive as generic stream errors; the kernel's own
    // vocabulary keeps them from surfacing as bare 500s, naming the command instead.
    let connection: AcpConnection;
    try {
      connection = await this.connectionFor(definition);
    } catch (error) {
      throw error instanceof AcpAgentError
        ? error
        : new AcpAgentError(`the agent command could not be started: ${definition.command}`, {
            cause: error,
          });
    }
    let response: NewSessionResponse;
    try {
      response = await connection.newSession(workspaceDir);
    } catch (error) {
      throw error instanceof AcpAgentError
        ? error
        : new AcpAgentError("the agent refused to open a session", { cause: error });
    }
    const record: SessionRecord = {
      sessionId: response.sessionId,
      definitionId,
      workspaceDir,
      busy: false,
      createdAt: Date.now(),
      turnSeq: 0,
      modes:
        response.modes !== undefined && response.modes !== null
          ? {
              currentModeId: response.modes.currentModeId,
              modes: response.modes.availableModes.map((m) => ({ id: m.id, name: m.name })),
            }
          : null,
      permissions: new Map(),
      log: [],
    };
    this.sessions.set(record.sessionId, record);
    if (record.modes !== null) {
      this.append(record, { type: "modes", sessionId: record.sessionId, modes: record.modes });
    }
    return this.viewOf(record);
  }

  /** One turn; resolves after the turn's `turn_end` has been logged. */
  async prompt(sessionId: string, text: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.busy) throw new AcpAgentError("session busy");
    const connection = this.connections.get(record.definitionId);
    if (connection === undefined) throw new AcpAgentError("agent connection is closed");
    record.busy = true;
    const seq = ++record.turnSeq;
    try {
      const stopReason = await connection.prompt(sessionId, text);
      this.finishTurn(record, seq, stopReason);
    } catch (error) {
      this.finishTurn(record, seq, "failed");
      throw error instanceof AcpAgentError
        ? error
        : // The message stays generic — a third-party agent's error payload is not trusted
          // to be secret-free — but the cause is preserved for diagnostics and tests.
          new AcpAgentError("the agent connection failed during the turn", { cause: error });
    } finally {
      record.busy = false;
    }
  }

  /** Ask the agent to stop the turn; its own reply (or the grace timeout) ends it. */
  async cancel(sessionId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (!record.busy) return;
    const connection = this.connections.get(record.definitionId);
    const seq = record.turnSeq;
    await connection?.cancel(sessionId).catch(() => undefined);
    const timer = setTimeout(() => {
      if (record.busy && record.turnSeq === seq) {
        record.busy = false;
        record.turnSeq += 1;
        this.append(record, {
          type: "turn_end",
          sessionId: record.sessionId,
          stopReason: "cancelled",
        });
      }
    }, CANCEL_GRACE_MS);
    timer.unref();
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    const connection = this.connections.get(record.definitionId);
    if (connection === undefined) throw new AcpAgentError("agent connection is closed");
    await connection.setMode(sessionId, modeId);
    if (record.modes !== null) {
      const merged: AgentModes = { ...record.modes, currentModeId: modeId };
      record.modes = merged;
      this.append(record, { type: "modes", sessionId: record.sessionId, modes: merged });
    }
  }

  /** Resolve a pending permission ask; false when it is unknown or already answered. */
  respondPermission(requestId: string, outcome: AgentPermissionOutcome): boolean {
    for (const record of this.sessions.values()) {
      const waiter = record.permissions.get(requestId);
      if (waiter === undefined) continue;
      clearTimeout(waiter.timer);
      record.permissions.delete(requestId);
      this.append(record, {
        type: "permission_resolved",
        sessionId: record.sessionId,
        requestId,
        outcome,
      });
      waiter.resolve(outcome);
      return true;
    }
    return false;
  }

  /** Drop a session; tears the definition's process down with its last session. */
  async disposeSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record === undefined) return;
    this.sessions.delete(sessionId);
    this.liveListeners.delete(sessionId);
    for (const [requestId, waiter] of record.permissions) {
      clearTimeout(waiter.timer);
      waiter.resolve({ outcome: "cancelled" });
      record.permissions.delete(requestId);
    }
    const connection = this.connections.get(record.definitionId);
    if (connection === undefined) return;
    await connection.closeSession(sessionId);
    const remaining = [...this.sessions.values()].some(
      (r) => r.definitionId === record.definitionId,
    );
    if (!remaining) {
      this.connections.delete(record.definitionId);
      connection.dispose();
    }
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
    this.pendingConnections.clear();
    this.sessions.clear();
    this.liveListeners.clear();
  }

  // --- internals ---------------------------------------------------------------------------

  /**
   * Resolve bare names before spawning: spawn's own Windows search never finds .cmd/.bat
   * shims (they need cmd.exe), and PATH may miss the version-manager homes discovery
   * knows about. Unresolved names pass through unchanged, so the spawn error stays the
   * honest signal for a command that does not exist.
   */
  private spawnConnection(
    definition: AgentServerDefinition,
    handlers: AcpConnectionHandlers,
  ): Promise<AcpConnection> {
    return resolveCommandPath(definition.command).then((command) =>
      AcpConnection.spawn(
        command,
        definition.args ?? [],
        this.envFor(definition),
        this.clientInfo,
        handlers,
        this.spawnProcess,
      ),
    );
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (record === undefined) throw new AcpAgentError(`unknown session: ${sessionId}`);
    return record;
  }

  private viewOf(record: SessionRecord): AgentSessionView {
    return {
      sessionId: record.sessionId,
      definitionId: record.definitionId,
      workspaceDir: record.workspaceDir,
      busy: record.busy,
      createdAt: record.createdAt,
      events: [...record.log],
    };
  }

  private finishTurn(record: SessionRecord, seq: number, stopReason: AgentStopReason): void {
    if (record.turnSeq !== seq) return; // a stale grace timer or an already-reported turn
    this.append(record, { type: "turn_end", sessionId: record.sessionId, stopReason });
  }

  private append(record: SessionRecord, event: AgentSessionEvent): void {
    record.log.push(event);
    if (record.log.length > this.maxLoggedEvents) record.log.shift();
    const listeners = this.liveListeners.get(record.sessionId);
    if (listeners !== undefined) {
      for (const listener of listeners) listener(event);
    }
  }

  private async connectionFor(definition: AgentServerDefinition): Promise<AcpConnection> {
    const existing = this.connections.get(definition.id);
    if (existing !== undefined) return existing;
    const pending = this.pendingConnections.get(definition.id);
    if (pending !== undefined) return pending;
    const creating = this.createConnection(definition, {
      onEvent: (event) => this.onConnectionEvent(definition.id, event),
      onPermissionRequest: (params) => this.bridgePermission(params),
    })
      .then(async (connection) => {
        await connection.initialize();
        this.connections.set(definition.id, connection);
        return connection;
      })
      .finally(() => {
        this.pendingConnections.delete(definition.id);
      });
    this.pendingConnections.set(definition.id, creating);
    return creating;
  }

  /**
   * Connection-scoped events carry only the definition id, not the session; permission
   * asks are correlated to a session through the request's own sessionId.
   */
  private onConnectionEvent(definitionId: string, event: AgentSessionEvent): void {
    if (event.type === "state" && event.state === "closed") {
      this.connections.delete(definitionId);
      for (const record of this.sessions.values()) {
        if (record.definitionId !== definitionId) continue;
        for (const [requestId, waiter] of record.permissions) {
          clearTimeout(waiter.timer);
          waiter.resolve({ outcome: "cancelled" });
          record.permissions.delete(requestId);
        }
        if (record.busy) {
          record.busy = false;
          record.turnSeq += 1; // invalidate the cancel grace timer's stale finish
          this.append(record, {
            type: "turn_end",
            sessionId: record.sessionId,
            stopReason: "failed",
          });
        }
        this.append(record, { type: "state", state: "closed" });
      }
      return;
    }
    if (event.type === "notice") {
      // Elicitation relay. A session-scoped notice goes to that session; a
      // connection-scoped one (sessionId null) goes to every session on the connection.
      if (event.sessionId !== null) {
        const target = this.sessions.get(event.sessionId);
        if (target !== undefined) this.append(target, event);
        return;
      }
      for (const candidate of this.sessions.values()) {
        if (candidate.definitionId === definitionId) this.append(candidate, event);
      }
      return;
    }
    if (event.type === "state") return; // "connecting"/"ready" carry no session and never occur
    const record = this.sessions.get(event.sessionId);
    if (record === undefined) return;
    if (event.type === "modes" && event.modes.modes.length === 0 && record.modes !== null) {
      // current_mode_update carries only the id; keep the advertised mode list.
      const merged: AgentModes = { ...record.modes, currentModeId: event.modes.currentModeId };
      record.modes = merged;
      this.append(record, { type: "modes", sessionId: record.sessionId, modes: merged });
      return;
    }
    this.append(record, event);
  }

  private bridgePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const record = this.sessions.get(params.sessionId);
    if (record === undefined) {
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.permissionSeq += 1;
    const requestId = `perm-${this.permissionSeq}`;
    const toolCall: AgentToolCall = {
      toolCallId: params.toolCall.toolCallId,
      // Updates may omit the title; the id is the honest fallback for a single ask.
      title: params.toolCall.title ?? params.toolCall.toolCallId,
      ...(params.toolCall.kind !== undefined && params.toolCall.kind !== null
        ? { kind: params.toolCall.kind }
        : {}),
      status: params.toolCall.status ?? "pending",
      locations: [],
    };
    const outcome = new Promise<AgentPermissionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        record.permissions.delete(requestId);
        this.append(record, {
          type: "permission_resolved",
          sessionId: record.sessionId,
          requestId,
          outcome: { outcome: "cancelled" },
        });
        resolve({ outcome: "cancelled" });
      }, this.permissionTimeoutMs);
      timer.unref();
      record.permissions.set(requestId, { resolve, timer });
    });
    const request: AgentPermissionRequest = {
      requestId,
      sessionId: params.sessionId,
      toolCall,
      options: params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
    };
    this.append(record, {
      type: "permission_request",
      sessionId: params.sessionId,
      request,
    });
    return outcome.then((resolved) => ({ outcome: resolved }));
  }
}
