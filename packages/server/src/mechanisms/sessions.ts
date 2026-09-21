/**
 * The sessions mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { SessionSource, SessionStatus, ApprovalMode } from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import type { ThinkingLevelName } from "@prismshadow/penguin-core";
import type { SandboxSettings } from "@prismshadow/penguin-core/plugin";
import type { ScheduleStateRow } from "../db/repos/schedules.js";
import type { ScheduleFileCache } from "../runtime/schedule-store.js";
import type { ScheduleEntryView } from "../runtime/scheduler.js";
import type { LiveTailTracker } from "../runtime/live-tail.js";
import type { RuntimeEntry } from "../runtime/session-manager.js";

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
  abstract setArchived(sessionId: string, archivedAt: string | null): void;
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

/** AgentState: the mechanism AgentStateStore implements — the Session runtime's in-memory state, data only. */
export abstract class AgentState extends Interface<{
  readonly entries: Opaque<"RuntimeEntries", Map<string, RuntimeEntry>>;
  readonly childRoots: Opaque<"ChildRoots", Map<string, string>>;
  readonly locks: Opaque<"SessionLocks", Map<string, Promise<unknown>>>;
  readonly surfaceStatuses: Opaque<"SurfaceStatuses", Map<string, SessionStatus>>;
  readonly deletingAgents: Opaque<"DeletingAgents", Set<string>>;
  readonly deletingSessions: Opaque<"DeletingSessions", Set<string>>;
  readonly agentGenerations: Opaque<"AgentGenerations", Map<string, number>>;
  readonly liveTail: Opaque<"LiveTailTracker", LiveTailTracker>;
}>() {}

/** SessionOrigins: the mechanism SessionSources implements. */
@Interface()
export abstract class SessionOrigins {
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
  abstract readonly files: Opaque<"ScheduleFileCache", ScheduleFileCache>;
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract tickOnce(): Promise<void>;
  abstract reconcileAgent(projectId: string, agentId: string): Promise<void>;
  abstract listAgent(
    projectId: string,
    agentId: string,
  ): Promise<{ entries: ScheduleEntryView[]; invalid: Array<{ name: string; error: string }> }>;
  abstract listProject(projectId: string): Promise<{
    entries: Array<ScheduleEntryView & { agentId: string }>;
    invalid: Array<{ agentId: string; name: string; error: string }>;
  }>;
  abstract dropEntry(projectId: string, agentId: string, name: string): void;
}
