/**
 * The sessions mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { SessionSource, ApprovalMode } from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import type { ThinkingLevelName } from "@prismshadow/penguin-core";
import type { ScheduleStateRow } from "../db/repos/schedules.js";
import type { ScheduleFileCache } from "../runtime/schedule-store.js";
import type { ScheduleEntryView } from "../runtime/scheduler.js";

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
  abstract updateThinkingLevel(sessionId: string, level: ThinkingLevelName): void;
  abstract updateTitle(sessionId: string, title: string): void;
  abstract updateTitleIfNull(sessionId: string, title: string): void;
  abstract setArchived(sessionId: string, archivedAt: string | null): void;
  abstract replaceId(oldSessionId: string, newSessionId: string): void;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
  abstract deleteById(sessionId: string): void;
}

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
