/**
 * The sessions mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { SessionSource } from "@prismshadow/amsp";
import type { SessionRow } from "./repos/sessions.js";
import type { ThinkingLevelName } from "@prismshadow/penguin-core";
import type { SandboxSettings } from "@prismshadow/penguin-core/plugin";
import type { ScheduleStateRow } from "./repos/schedules.js";
import type { ApprovalReason as CoreApprovalReason } from "@prismshadow/penguin-core/interfaces";

/** From packages/server: ApprovalMode (was api/types.ts). The contract names it, so the type lives with the contract. */
export type ApprovalMode = "allow-all" | "deny-all" | "read-only" | "always-ask";

// ---------------------------------------------------------------------------
// Session runtime vocabulary (was api/types.ts's; the ServerEvent names them,
// so the words live with the contract)
// ---------------------------------------------------------------------------

/** The run state a Session's row flips through. */
export type SessionStatus = "idle" | "running" | "compacting";

export interface PendingSteeringInfo {
  /** Server-assigned id, stable for the entry's queued lifetime: the handle DELETE /steer/:steerId recalls it by. */
  id: string;
  /** The message text as accepted (trimmed); may be empty when images/files carry the message. */
  text: string;
  /** Number of images that rode along. */
  images: number;
  /** Number of file attachments that rode along. */
  files: number;
}

export interface PendingFollowUpInfo {
  /** Server-assigned id, stable for the entry's queued lifetime: the handle DELETE /follow-ups/:followUpId recalls it by. */
  id: string;
  /** The queued input's text parts, joined; may be empty when images/files carry the message. */
  text: string;
  /** Number of images in the queued input. */
  images: number;
  /** Number of file attachments in the queued input. */
  files: number;
  /** An interrupt waiting for the run it aborted to settle: it starts first, and no other interrupt can move it. */
  interrupt?: true;
}

export interface SubagentRuntimeInfo {
  sessionId: string;
  subagentId: string | null;
  running: boolean;
}

export type SessionSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type SessionSandboxNetwork = "open" | "local" | "none";

export interface UnavailableSandboxBackend {
  name: string;
  reason: string;
}

export interface SessionSandboxPreset {
  id: string;
  /** The name an administrator gave it, or its declared English name. */
  name: string;
  /** Its declared Chinese name, while it has not been renamed. */
  nameZh?: string;
  /** Whether the composer's menu lists it. */
  enabled: boolean;
  mode: SessionSandboxMode;
  network: SessionSandboxNetwork;
  approvalMode: ApprovalMode;
  /**
   * Response-only: its file mode or network is wider than the server's sandbox settings (the
   * ceiling for non-admins), so a non-admin's pick of it is refused with `403 sandbox_forbidden`.
   * The same comparison as that refusal; absent when it is within them.
   */
  aboveCeiling?: true;
}

export interface SessionSandbox {
  mode: SessionSandboxMode;
  /** `open` = unrestricted, `local` = only the host's localhost, `none` = no network. */
  network: SessionSandboxNetwork;
  /**
   * Response only, ignored in requests: whether a sandbox backend on this server can enforce
   * the `read-only` and `workspace-write` modes. False on a deployment with no backend
   * installed, where either mode would refuse every command: the composer shows them greyed
   * out, saying no backend is installed.
   */
  confinementSupported?: boolean;
  /** Response only, ignored in requests: the same for the `none` network level. */
  noNetworkSupported?: boolean;
  /**
   * Response only, ignored in requests: whether a sandbox backend on this server can enforce
   * the `local` level. When false the composer shows it greyed out, and picking it is refused
   * (400 `sandbox_unsupported`).
   */
  localNetworkSupported?: boolean;
  /** Response only, ignored in requests: whether a backend here can enforce `masksPaths`. */
  maskPathsSupported?: boolean;
  /**
   * Response only, ignored in requests: true when this policy hides paths (the Sandbox card's
   * masked paths, kept by every pick). Where `maskPathsSupported` is false, every level then
   * refuses every command, and the composer says so.
   */
  masksPaths?: boolean;
  /**
   * Response only, ignored in requests: the names of the sandbox backends in use here, which the
   * composer names when a level is beyond what they enforce. Absent with none in use.
   */
  backendsInUse?: string[];
  /**
   * Response only, ignored in requests: the sandbox backends that are enabled here but failed
   * to load or failed their check (a WSL distro not set up, a wrong program path), each with
   * why. A backend for another platform is not listed. With none mounted and one listed, the
   * composer marks the confining levels unavailable and gives the first one's reason.
   */
  unavailableBackends?: UnavailableSandboxBackend[];
  /**
   * Response only, ignored in requests: the server's sandbox presets (the Sandbox card's table),
   * in table order, disabled rows included. The composer lists the enabled ones and names the
   * Session's level by the first row matching its mode, network and approval mode. A server
   * that does not report it gets the composer's built-in table.
   */
  presets?: SessionSandboxPreset[];
  /**
   * Response only, ignored in requests: true when this Session's policy holds something the
   * presets do not show — masked paths, or the temp directory not writable.
   */
  advanced?: boolean;
  /**
   * Response only, chat defaults only: the approval mode a new Session starts with when its
   * request names none — the Sandbox card's default preset's, while the switch is on. Absent:
   * the server's own fallback (`allow-all`).
   */
  defaultApprovalMode?: ApprovalMode;
  /**
   * Response only, ignored in requests: the Sandbox card's switch on this server — whether new
   * Sessions start confined. Off, the composer offers the approval modes alone (a Session keeps
   * its own policy either way). A server that does not report it is read as on.
   */
  switchOn?: boolean;
}

/** The approval vocabulary a decision cites (core's type, aliased here so the contract names it). */
export type ApprovalReason = CoreApprovalReason;

/** SessionIndex: the mechanism SessionsRepo implements. */
@Interface()
export abstract class SessionIndex {
  abstract insert(row: SessionRow): void;
  abstract insertOrIgnore(row: SessionRow): void;
  abstract insertFork(sourceSessionId: string, row: SessionRow): SessionRow;
  abstract markOrgClient(sessionIds: readonly string[]): void;
  abstract markHasTrace(sessionId: string): void;
  abstract markDriven(sessionId: string, at: string): void;
  abstract touchLastActive(sessionId: string, at: string): void;
  abstract findById(sessionId: string): SessionRow | null;
  abstract listByAgent(projectId: string, agentId: string): SessionRow[];
  abstract listByProject(projectId: string): SessionRow[];
  abstract updateApprovalMode(sessionId: string, mode: ApprovalMode): void;
  abstract updateSandbox(sessionId: string, sandbox: SandboxSettings): void;
  abstract updateThinkingLevel(sessionId: string, level: ThinkingLevelName): void;
  abstract updateTitle(sessionId: string, title: string): void;
  abstract updateTitleIfNull(sessionId: string, title: string): void;
  abstract updateModel(sessionId: string, provider: string, modelId: string): void;
  abstract setListing(
    sessionIds: readonly string[],
    listing: "archived" | "kept",
    at: string,
  ): void;
  abstract replaceId(oldSessionId: string, newSessionId: string): void;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
  abstract deleteById(sessionId: string): void;
}

/**
 * SessionDrivers: the human a Session acts for — the one who last started a run in it (a prompt
 * in the app, the scheduler on its creator's behalf), else the owner of its Project. An agent's
 * calls reach the server with the admin API token; this is how they are attributed to a person
 * (whose own Chrome the agent then drives). The mechanism SessionDriverRegistry implements.
 */
@Interface()
export abstract class SessionDrivers {
  /** `userId` started a run in `sessionId`. */
  abstract note(sessionId: string, userId: string): void;
  /** The human `sessionId` acts for; null for a Session the server does not know. */
  abstract driverOf(sessionId: string): string | null;
}

/**
 * What a run that has just ended asks of the CURRENT generation: start the next queued
 * follow-up, or deliver background notices that raced the run's exit. A run outlives the
 * generation that launched it (see AgentState.current), and what it starts next is the
 * current logic's to start.
 */
export interface RunStarter {
  startQueuedFollowUp(sessionId: string): Promise<void>;
  startBackgroundNoticeTask(sessionId: string): Promise<void>;
}

/** AgentState: the mechanism AgentStateStore implements — the Session runtime's in-memory state, data only. */
export abstract class AgentState extends Interface<{
  /** The live Session runtimes, keyed by Session id. The entry shape is the server
   * runtime's own (session-manager's RuntimeEntry) — opaque here: the contract carries
   * the map's identity and size, the runtime owns its rows. */
  readonly entries: Map<string, unknown>;
  readonly childRoots: Map<string, string>;
  readonly locks: Map<string, Promise<unknown>>;
  readonly deletingAgents: Set<string>;
  readonly deletingSessions: Set<string>;
  readonly agentGenerations: Map<string, number>;
  /** The live fragment log: the server runtime's LiveTail, opaque to this contract. */
  readonly liveTail: unknown;
  /** The generation working on this state right now; every generation points it at itself when it takes the state over. */
  current: RunStarter | null;
}>() {}

/** From packages/server (runtime/schedule-file.ts): a registered task's definition, as the
 * schedule file states it. The contract carries the shape a schedule read shows; the
 * scheduler's file parser owns the rest of the file's fields. */
export interface ScheduleDefinition {
  name: string;
  /** The Prompt to send (required). */
  prompt: string;
  /** Enabled switch; disabled by default. */
  enabled: boolean;
  /** Original text of the first trigger time (for API echo, preserving the written form). */
  startAt: string;
  /** First trigger time (epoch ms). */
  startAtMs: number;
  /** Original text of the end time. */
  endAt?: string;
  /** Original text of the trigger period (e.g. `30m`, for API echo); undefined means a one-shot task. */
  period?: string;
  /** Trigger period (ms); undefined means a one-shot task. */
  periodMs?: number;
  /** End time (epoch ms); no more triggers once past it. */
  endAtMs?: number;
  /** The target Session to bind to; defaults to creating a new Session each time. */
  sessionId?: string;
  /** Workspace for new-Session mode (same semantics as manually starting a session; a temporary workspace is auto-created if unspecified). */
  workspace?: string;
  /** Model for new-Session mode (upstream id, always paired with provider; omit both for the Project's default reference). */
  modelId?: string;
}

/** From packages/server (runtime/scheduler.ts): the in-memory view of a registered task. */
export interface ScheduleEntry {
  def: ScheduleDefinition;
  state: ScheduleStateRow;
  queued: boolean;
}

/** SessionOrigins: the mechanism SessionSources implements. */
@Interface()
export abstract class SessionOrigins {
  /** `null`: the Session's Trace head records no source (written before it was required). */
  abstract set(sessionId: string, source: SessionSource | null): void;
  abstract get(sessionId: string): SessionSource | null | undefined;
  abstract delete(sessionId: string): void;
}

/** Schedules: the mechanism SchedulesRepo implements. */
@Interface()
export abstract class Schedules {
  abstract find(projectId: string, agentId: string, name: string): ScheduleStateRow | null;
  abstract listByAgent(projectId: string, agentId: string): ScheduleStateRow[];
  abstract registerOrSync(args: {
    projectId: string;
    agentId: string;
    name: string;
    startAtMs: number;
    defHash: string;
    creatorUserId: string | null;
  }): { row: ScheduleStateRow; fresh: boolean };
  abstract markSlot(projectId: string, agentId: string, name: string, slotMs: number): void;
  abstract markFired(
    projectId: string,
    agentId: string,
    name: string,
    firedAt: string,
    oneShot: boolean,
  ): void;
  abstract markMissed(projectId: string, agentId: string, name: string): void;
  abstract markInvalid(projectId: string, agentId: string, name: string, reason: string): void;
  abstract delete(projectId: string, agentId: string, name: string): void;
  abstract deleteMissing(projectId: string, agentId: string, presentNames: string[]): string[];
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
}

/** Scheduling: the mechanism Scheduler implements. */
@Interface()
export abstract class Scheduling {
  /** The runtime's schedule-file cache (schedule-store's ScheduleFileCache), opaque to this contract. */
  abstract readonly files: unknown;
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract tickOnce(): Promise<void>;
  abstract reconcileAgent(projectId: string, agentId: string): Promise<void>;
  abstract listAgent(
    projectId: string,
    agentId: string,
  ): Promise<{ entries: ScheduleEntry[]; invalid: Array<{ name: string; error: string }> }>;
  abstract listProject(projectId: string): Promise<{
    entries: Array<ScheduleEntry & { agentId: string }>;
    invalid: Array<{ agentId: string; name: string; error: string }>;
  }>;
  abstract dropEntry(projectId: string, agentId: string, name: string): void;
}
