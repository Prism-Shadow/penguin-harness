/**
 * The sessions mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { SessionSource } from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import type { ApprovalMode } from "../api/types.js";
import type { ThinkingLevelName } from "@prismshadow/penguin-core";
import type { ScheduleStateRow } from "../db/repos/schedules.js";
import type { ScheduleFileCache } from "../runtime/schedule-store.js";
import type { ScheduleEntryView } from "../runtime/scheduler.js";

/** SessionIndex: the mechanism SessionsRepo implements. */
export abstract class SessionIndex extends Interface<{
  insert(row: SessionRow): void;
  insertOrIgnore(row: SessionRow): void;
  insertFork(sourceSessionId: string, row: SessionRow): SessionRow;
  markHasTrace(sessionId: string): void;
  markDriven(sessionId: string, at: string): void;
  touchLastActive(sessionId: string, at: string): void;
  findById(sessionId: string): SessionRow | null;
  listByAgent(projectId: string, agentId: string): SessionRow[];
  listByProject(projectId: string): SessionRow[];
  updateApprovalMode(sessionId: string, mode: ApprovalMode): void;
  updateThinkingLevel(sessionId: string, level: ThinkingLevelName): void;
  updateTitle(sessionId: string, title: string): void;
  updateTitleIfNull(sessionId: string, title: string): void;
  setArchived(sessionId: string, archivedAt: string | null): void;
  replaceId(oldSessionId: string, newSessionId: string): void;
  deleteByAgent(projectId: string, agentId: string): void;
  deleteByProject(projectId: string): void;
  deleteById(sessionId: string): void;
}>() {}

/** SessionOrigins: the mechanism SessionSources implements. */
export abstract class SessionOrigins extends Interface<{
  set(sessionId: string, source: SessionSource | null): void;
  get(sessionId: string): SessionSource | null | undefined;
  delete(sessionId: string): void;
}>() {}

/** Schedules: the mechanism SchedulesRepo implements. */
export abstract class Schedules extends Interface<{
  find(projectId: string, agentId: string, name: string): ScheduleStateRow | null;
  listByAgent(projectId: string, agentId: string): ScheduleStateRow[];
  registerOrSync(args: {
    projectId: string;
    agentId: string;
    name: string;
    startAtMs: number;
    defHash: string;
    creatorUserId: string | null;
  }): { row: ScheduleStateRow; fresh: boolean };
  markSlot(projectId: string, agentId: string, name: string, slotMs: number): void;
  markFired(
    projectId: string,
    agentId: string,
    name: string,
    firedAt: string,
    oneShot: boolean,
  ): void;
  markMissed(projectId: string, agentId: string, name: string): void;
  markInvalid(projectId: string, agentId: string, name: string, reason: string): void;
  delete(projectId: string, agentId: string, name: string): void;
  deleteMissing(projectId: string, agentId: string, presentNames: string[]): string[];
  deleteByAgent(projectId: string, agentId: string): void;
  deleteByProject(projectId: string): void;
}>() {}

/** Scheduling: the mechanism Scheduler implements. */
export abstract class Scheduling extends Interface<{
  readonly files: Opaque<"ScheduleFileCache", ScheduleFileCache>;
  start(): Promise<void>;
  stop(): void;
  tickOnce(): Promise<void>;
  reconcileAgent(projectId: string, agentId: string): Promise<void>;
  listAgent(
    projectId: string,
    agentId: string,
  ): Promise<{ entries: ScheduleEntryView[]; invalid: Array<{ name: string; error: string }> }>;
  dropEntry(projectId: string, agentId: string, name: string): void;
}>() {}
