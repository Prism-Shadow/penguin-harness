/**
 * The coding-agents runtime: a registry of agent definitions, one pooled ACP connection per
 * definition, and per-session state (busy flag, pending permission waiters, bounded event
 * log). Storage is the host's job — the host hands the current definition list in and reads
 * sessions back out as views; nothing here touches disk or HTTP.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  LoadSessionResponse,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import {
  AcpConnection,
  configOptionsFromAcp,
  type AcpClientInfo,
  type AcpConnectionHandlers,
  type SpawnProcess,
} from "./connection.js";
import { protectedPathIn } from "./path-guard.js";
import { resolveCommandPath } from "./resolve.js";
import {
  AcpAgentError,
  type AgentPermissionOutcome,
  type AgentPermissionRequest,
  type AgentResumeSupport,
  type AgentServerDefinition,
  type AgentSessionConfigOption,
  type AgentSessionEvent,
  type AgentModes,
  type AgentStopReason,
  type AgentToolCall,
  type AgentTurnUsage,
} from "./types.js";

const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_LOGGED_EVENTS = 4_000;
/** How much of an agent's own error message is relayed. */
const MAX_REASON = 500;
/** After `session/cancel`, how long an agent gets to report the turn's end itself. */
const CANCEL_GRACE_MS = 15_000;

/** Deep-enough copy so a view/log snapshot never aliases the live record state. */
function cloneConfigOptions(options: AgentSessionConfigOption[]): AgentSessionConfigOption[] {
  return options.map((option) => ({
    ...option,
    options: option.options.map((value) => ({ ...value })),
  }));
}

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
  /**
   * Told how every prompted turn ended, by definition: what a real turn learned (a
   * sign-in that failed, or one that plainly works) outranks any guess from files.
   */
  onTurnEnd?: (definitionId: string, outcome: AgentTurnOutcome) => void;
}

export interface AgentTurnOutcome {
  stopReason: AgentStopReason;
  signInFailed: boolean;
}

/** ACP's own "authentication required" error code. */
const AUTH_REQUIRED_CODE = -32000;

/** Whether an agent's error says it failed for want of a sign-in. */
function isSignInFailure(error: RequestError): boolean {
  const data = error.data as { errorKind?: unknown } | null | undefined;
  return error.code === AUTH_REQUIRED_CODE || data?.errorKind === "authentication_failed";
}

/**
 * A folder a session's agent may read but must not be allowed to change. Asks that name a
 * path inside it are refused before anyone sees them; see path-guard.ts for what that can
 * and cannot catch.
 */
export interface ProtectedRoot {
  root: string;
  /** How the refusal names the folder to a person ("the shared WAF checkout"). */
  label: string;
}

export interface AgentSessionOptions {
  protectedRoots?: ProtectedRoot[];
}

export interface AgentSessionView {
  sessionId: string;
  definitionId: string;
  workspaceDir: string;
  busy: boolean;
  createdAt: number;
  /** Whether a later process can reopen this session, and how; see `resumeSession`. */
  resumeSupport: AgentResumeSupport;
  /** Model choice and other session settings, as the agent advertised them. */
  configOptions: AgentSessionConfigOption[];
  /** The bounded event log, oldest first — enough to rebuild the transcript. */
  events: AgentSessionEvent[];
}

interface SessionRecord {
  sessionId: string;
  definitionId: string;
  workspaceDir: string;
  busy: boolean;
  createdAt: number;
  resumeSupport: AgentResumeSupport;
  protectedRoots: ProtectedRoot[];
  /** Increments per turn; stale turn endings (a cancelled turn's grace timer) drop out. */
  turnSeq: number;
  modes: AgentModes | null;
  configOptions: AgentSessionConfigOption[];
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
  /** The environment each live connection's process was started with, as compared JSON. */
  private readonly spawnedEnv = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly liveListeners = new Map<string, Set<(event: AgentSessionEvent) => void>>();
  private readonly configSets = new Map<string, Promise<void>>();
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
  private readonly onTurnEnd: CodingAgentManagerOptions["onTurnEnd"];

  constructor(options: CodingAgentManagerOptions) {
    this.clientInfo = options.clientInfo;
    this.envFor = options.envFor;
    this.spawnProcess = options.spawnProcess;
    this.createConnection =
      options.createConnection ??
      ((definition, handlers) => this.spawnConnection(definition, handlers));
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
    this.maxLoggedEvents = options.maxLoggedEvents ?? DEFAULT_MAX_LOGGED_EVENTS;
    this.onTurnEnd = options.onTurnEnd;
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

  /**
   * Whether the agent's running process was started with a different environment than its
   * definition now gives; false when it is not running. Its sessions keep the old values until
   * the last one ends, since the process reads its environment only at start.
   */
  startedWithOtherEnv(definitionId: string): boolean {
    const started = this.spawnedEnv.get(definitionId);
    const definition = this.definitions.get(definitionId);
    if (started === undefined || definition === undefined) return false;
    return started !== JSON.stringify(this.envFor(definition));
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

  async createSession(
    definitionId: string,
    workspaceDir: string,
    options: AgentSessionOptions = {},
  ): Promise<AgentSessionView> {
    const connection = await this.openConnection(definitionId, workspaceDir);
    let response: NewSessionResponse;
    try {
      response = await connection.newSession(workspaceDir);
    } catch (error) {
      if (error instanceof AcpAgentError) throw error;
      // Like the handshake, session/new carries no user content, so the agent's own reason
      // (an account it no longer serves, a missing sign-in) is the only part that says what
      // to do. It may still quote a value the agent was started with, so those are masked.
      const detail =
        error instanceof RequestError && error.message !== ""
          ? `: ${this.maskGiven(definitionId, error.message)}`
          : "";
      throw new AcpAgentError(`the agent refused to open a session${detail}`, { cause: error });
    }
    const record = this.newRecord(
      response.sessionId,
      definitionId,
      workspaceDir,
      connection.resumeSupport(),
    );
    record.protectedRoots = [...(options.protectedRoots ?? [])];
    this.sessions.set(record.sessionId, record);
    this.adoptSessionState(record, response);
    return this.viewOf(record);
  }

  /**
   * Reopen a session an earlier process started, by the id the agent gave it. The agent
   * decides whether it can: `session/resume` is used when advertised, `session/load`
   * otherwise, and an agent offering neither is refused rather than silently handed a
   * fresh session that has forgotten everything. A session still open here is returned
   * as it is.
   */
  async resumeSession(
    definitionId: string,
    workspaceDir: string,
    sessionId: string,
    options: AgentSessionOptions = {},
  ): Promise<AgentSessionView> {
    const open = this.sessions.get(sessionId);
    if (open !== undefined) {
      if (open.definitionId !== definitionId) {
        throw new AcpAgentError(`session ${sessionId} belongs to another agent`);
      }
      return this.viewOf(open);
    }
    const connection = await this.openConnection(definitionId, workspaceDir);
    const support = connection.resumeSupport();
    if (support === "none") {
      throw new AcpAgentError(
        "this agent cannot reopen an earlier session; start a new session instead",
      );
    }
    // Registered before the request: session/load replays the conversation as updates,
    // which are routed by session id and would otherwise be dropped as unknown.
    const record = this.newRecord(sessionId, definitionId, workspaceDir, support);
    record.protectedRoots = [...(options.protectedRoots ?? [])];
    record.busy = true;
    this.sessions.set(sessionId, record);
    let response: LoadSessionResponse;
    try {
      response =
        support === "resume"
          ? await connection.resumeSession(sessionId, workspaceDir)
          : await connection.loadSession(sessionId, workspaceDir);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error instanceof AcpAgentError
        ? error
        : new AcpAgentError("the agent could not reopen that session", { cause: error });
    } finally {
      record.busy = false;
    }
    if (support === "resume") {
      this.append(record, {
        type: "notice",
        sessionId,
        message:
          "Reopened an earlier session. Its earlier turns are not shown here, but the agent still has them.",
      });
    }
    this.adoptSessionState(record, response);
    return this.viewOf(record);
  }

  /**
   * Set one session configuration option (a model choice, a toggle); the agent's reply
   * carries the full updated set, which becomes the session's new state.
   */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: boolean | string,
  ): Promise<void> {
    const record = this.requireSession(sessionId);
    // Serialized per session: a slower earlier request must not overwrite the state a
    // later change (or a live agent push) already established.
    const previous = this.configSets.get(sessionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const connection = this.connections.get(record.definitionId);
        if (connection === undefined) throw new AcpAgentError("agent connection is closed");
        record.configOptions = await connection.setSessionConfigOption(sessionId, configId, value);
        this.append(record, {
          type: "config_options",
          sessionId,
          options: cloneConfigOptions(record.configOptions),
        });
      });
    this.configSets.set(sessionId, operation);
    try {
      await operation;
    } finally {
      if (this.configSets.get(sessionId) === operation) this.configSets.delete(sessionId);
    }
  }

  /**
   * One turn; resolves after the turn's `turn_end` has been logged. Aborting `signal`
   * cancels the turn exactly as `cancel` does — the agent is asked to stop and the turn
   * ends when it says so, or when the grace period runs out.
   */
  async prompt(
    sessionId: string,
    text: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.busy) throw new AcpAgentError("session busy");
    const connection = this.connections.get(record.definitionId);
    if (connection === undefined) throw new AcpAgentError("agent connection is closed");
    const signal = options.signal;
    if (signal?.aborted === true) {
      throw new AcpAgentError("the turn was cancelled before it started");
    }
    const onAbort = () => void this.cancel(sessionId);
    signal?.addEventListener("abort", onAbort, { once: true });
    record.busy = true;
    const seq = ++record.turnSeq;
    // The prompt is part of the transcript: logged before the turn streams so the log
    // order is the conversation order, whether or not the turn succeeds.
    this.append(record, { type: "user_message", sessionId, text });
    try {
      const { stopReason, usage } = await connection.prompt(sessionId, text);
      this.finishTurn(record, seq, stopReason, usage);
      this.reportTurn(record.definitionId, { stopReason, signInFailed: false });
    } catch (error) {
      this.finishTurn(record, seq, "failed");
      const signInFailed = error instanceof RequestError && isSignInFailure(error);
      this.reportTurn(record.definitionId, { stopReason: "failed", signInFailed });
      if (error instanceof AcpAgentError) throw error;
      // The message stays generic — a third-party agent's error payload is not trusted to
      // be secret-free — but the agent's own reason (a sign-in that expired, a spent quota)
      // is the only part that says what to do, so it rides along masked, as `reason`.
      const reason =
        error instanceof RequestError ? this.maskedReason(record.definitionId, error) : "";
      throw new AcpAgentError("the agent connection failed during the turn", {
        cause: error,
        signInFailed,
        ...(reason !== "" ? { reason } : {}),
      });
    } finally {
      record.busy = false;
      signal?.removeEventListener("abort", onAbort);
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

  /**
   * Drop a session; tears the definition's process down with its last session. The agent is
   * asked to close it too, unless `keepOnAgent` — a host that will reopen the session later
   * (after a restart, or once it is used again) must leave it on the agent to resume.
   */
  async disposeSession(sessionId: string, options: { keepOnAgent?: boolean } = {}): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record === undefined) return;
    this.sessions.delete(sessionId);
    this.liveListeners.delete(sessionId);
    this.configSets.delete(sessionId);
    for (const [requestId, waiter] of record.permissions) {
      clearTimeout(waiter.timer);
      waiter.resolve({ outcome: "cancelled" });
      record.permissions.delete(requestId);
    }
    const connection = this.connections.get(record.definitionId);
    if (connection === undefined) return;
    if (options.keepOnAgent !== true) await connection.closeSession(sessionId);
    const remaining = [...this.sessions.values()].some(
      (r) => r.definitionId === record.definitionId,
    );
    if (!remaining) {
      this.connections.delete(record.definitionId);
      this.spawnedEnv.delete(record.definitionId);
      connection.dispose();
    }
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
    this.pendingConnections.clear();
    this.sessions.clear();
    this.liveListeners.clear();
    this.configSets.clear();
    this.spawnedEnv.clear();
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

  /** Validate the definition and workspace, then reach (or start) its connection. */
  private async openConnection(definitionId: string, workspaceDir: string): Promise<AcpConnection> {
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
    try {
      return await this.connectionFor(definition);
    } catch (error) {
      if (error instanceof AcpAgentError) {
        // A handshake refusal carries the agent's own words, which may quote its keys.
        const masked = this.maskGiven(definitionId, error.message);
        throw masked === error.message ? error : new AcpAgentError(masked, { cause: error.cause });
      }
      throw new AcpAgentError(`the agent command could not be started: ${definition.command}`, {
        cause: error,
      });
    }
  }

  private newRecord(
    sessionId: string,
    definitionId: string,
    workspaceDir: string,
    resumeSupport: AgentResumeSupport,
  ): SessionRecord {
    return {
      sessionId,
      definitionId,
      workspaceDir,
      busy: false,
      createdAt: Date.now(),
      resumeSupport,
      protectedRoots: [],
      turnSeq: 0,
      modes: null,
      configOptions: [],
      permissions: new Map(),
      log: [],
    };
  }

  /** The modes and config options a session/new, load or resume answered with. */
  private adoptSessionState(record: SessionRecord, response: LoadSessionResponse): void {
    if (response.modes !== undefined && response.modes !== null) {
      record.modes = {
        currentModeId: response.modes.currentModeId,
        modes: response.modes.availableModes.map((m) => ({ id: m.id, name: m.name })),
      };
      this.append(record, { type: "modes", sessionId: record.sessionId, modes: record.modes });
    }
    record.configOptions = configOptionsFromAcp(response.configOptions);
    if (record.configOptions.length > 0) {
      this.append(record, {
        type: "config_options",
        sessionId: record.sessionId,
        options: cloneConfigOptions(record.configOptions),
      });
    }
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (record === undefined) throw new AcpAgentError(`unknown session: ${sessionId}`);
    return record;
  }

  /** Tell the host how a turn ended; a listener that throws must not break the turn. */
  private reportTurn(definitionId: string, outcome: AgentTurnOutcome): void {
    try {
      this.onTurnEnd?.(definitionId, outcome);
    } catch {
      // The outcome is advisory; the turn's own result stands.
    }
  }

  /**
   * An agent's error message, fit to relay: the JSON-RPC "Internal error: " prefix dropped,
   * every value the agent was started with that the host's own environment lacks (its API
   * keys, a proxy with credentials) masked, and the length capped. Values under 8
   * characters are left alone — masking "1" would garble the text and hide nothing.
   */
  private maskedReason(definitionId: string, error: RequestError): string {
    const text = this.maskGiven(
      definitionId,
      error.message.replace(/^Internal error:\s*/i, "").trim(),
    );
    return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON)}…` : text;
  }

  /** `text` with every value the agent was started with that the host's environment lacks masked. */
  private maskGiven(definitionId: string, text: string): string {
    const definition = this.definitions.get(definitionId);
    if (definition !== undefined) {
      const given = Object.entries(this.envFor(definition))
        .filter(([key, value]) => value.length >= 8 && process.env[key] !== value)
        .map(([, value]) => value)
        .sort((a, b) => b.length - a.length);
      for (const value of given) text = text.split(value).join("***");
    }
    return text;
  }

  private viewOf(record: SessionRecord): AgentSessionView {
    return {
      sessionId: record.sessionId,
      definitionId: record.definitionId,
      workspaceDir: record.workspaceDir,
      busy: record.busy,
      createdAt: record.createdAt,
      resumeSupport: record.resumeSupport,
      configOptions: cloneConfigOptions(record.configOptions),
      events: [...record.log],
    };
  }

  private finishTurn(
    record: SessionRecord,
    seq: number,
    stopReason: AgentStopReason,
    usage?: AgentTurnUsage,
  ): void {
    if (record.turnSeq !== seq) return; // a stale grace timer or an already-reported turn
    this.append(record, {
      type: "turn_end",
      sessionId: record.sessionId,
      stopReason,
      ...(usage !== undefined ? { usage } : {}),
    });
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
        this.spawnedEnv.set(definition.id, JSON.stringify(this.envFor(definition)));
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
      this.spawnedEnv.delete(definitionId);
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
    if (event.type === "config_options") {
      // The agent pushed a full set (a live config_option_update): it becomes the
      // session's state, and the log entry rebuilds late joiners' transcripts.
      record.configOptions = cloneConfigOptions(event.options);
      this.append(record, event);
      return;
    }
    this.append(record, event);
  }

  private bridgePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const record = this.sessions.get(params.sessionId);
    if (record === undefined) {
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }
    const touched = protectedPathIn(
      params.toolCall,
      record.protectedRoots.map((p) => p.root),
      record.workspaceDir,
    );
    if (touched !== null) {
      const label =
        record.protectedRoots.find((p) =>
          protectedPathIn({ locations: [{ path: touched }] }, [p.root], record.workspaceDir),
        )?.label ?? "a protected folder";
      const title = params.toolCall.title ?? params.toolCall.toolCallId;
      this.append(record, {
        type: "notice",
        sessionId: record.sessionId,
        message: `Refused "${title}": it would touch ${touched}, inside ${label}, which this session may not change.`,
      });
      const reject =
        params.options.find((o) => o.kind === "reject_once") ??
        params.options.find((o) => o.kind === "reject_always");
      return Promise.resolve({
        outcome:
          reject !== undefined
            ? { outcome: "selected", optionId: reject.optionId }
            : { outcome: "cancelled" },
      });
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
