/**
 * Repo for schedule runtime state: intent and state are separate — the file is
 * declarative intent, this table only records runtime state such as
 * "fired before / last fired / missed / disabled" plus the creator.
 *
 * Identity rule: a change to `start_at` is treated as a new task instance
 * (registerOrSync resets the trigger state); a change to the file content fingerprint
 * only clears the disabled flag (the file becomes effective again after reconciliation).
 */
import type { DatabaseSync } from "node:sqlite";

export interface ScheduleStateRow {
  projectId: string;
  agentId: string;
  name: string;
  creatorUserId: string | null;
  startAtMs: number;
  defHash: string;
  lastSlotMs: number | null;
  lastFiredAt: string | null;
  firedOnce: boolean;
  missed: boolean;
  invalidReason: string | null;
}

function mapRow(r: Record<string, unknown>): ScheduleStateRow {
  return {
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    name: r.name as string,
    creatorUserId: (r.creator_user_id as string | null) ?? null,
    startAtMs: Number(r.start_at_ms),
    defHash: r.def_hash as string,
    lastSlotMs: r.last_slot_ms === null ? null : Number(r.last_slot_ms),
    lastFiredAt: (r.last_fired_at as string | null) ?? null,
    firedOnce: Number(r.fired_once) === 1,
    missed: Number(r.missed) === 1,
    invalidReason: (r.invalid_reason as string | null) ?? null,
  };
}

export class SchedulesRepo {
  constructor(private readonly db: DatabaseSync) {}

  find(projectId: string, agentId: string, name: string): ScheduleStateRow | null {
    const r = this.db
      .prepare("SELECT * FROM schedule_state WHERE project_id = ? AND agent_id = ? AND name = ?")
      .get(projectId, agentId, name);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  listByAgent(projectId: string, agentId: string): ScheduleStateRow[] {
    const rows = this.db
      .prepare("SELECT * FROM schedule_state WHERE project_id = ? AND agent_id = ? ORDER BY name")
      .all(projectId, agentId);
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  /**
   * Register or sync a task's runtime state, returning the synced row plus a `fresh`
   * flag:
   * - Insert if it doesn't exist (creator is only persisted at this point; a hand-edited
   *   file gets registered via reconciliation, with creator falling back to the Project
   *   owner);
   * - A change to `start_at` resets the trigger state (a new task instance);
   * - Otherwise, a change to the file fingerprint only clears the disabled flag.
   * `fresh` = this call was an insert or reset — the scheduler only establishes its
   * "missed, don't backfill" baseline at this moment; afterward, last_slot being NULL
   * only means "no scheduled time has been consumed yet", and it must fire normally once
   * reached.
   */
  registerOrSync(args: {
    projectId: string;
    agentId: string;
    name: string;
    startAtMs: number;
    defHash: string;
    creatorUserId: string | null;
  }): { row: ScheduleStateRow; fresh: boolean } {
    const existing = this.find(args.projectId, args.agentId, args.name);
    let fresh = false;
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO schedule_state
             (project_id, agent_id, name, creator_user_id, start_at_ms, def_hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          args.projectId,
          args.agentId,
          args.name,
          args.creatorUserId,
          args.startAtMs,
          args.defHash,
        );
      fresh = true;
    } else if (existing.startAtMs !== args.startAtMs) {
      this.db
        .prepare(
          `UPDATE schedule_state
             SET start_at_ms = ?, def_hash = ?, last_slot_ms = NULL, last_fired_at = NULL,
                 fired_once = 0, missed = 0, invalid_reason = NULL
           WHERE project_id = ? AND agent_id = ? AND name = ?`,
        )
        .run(args.startAtMs, args.defHash, args.projectId, args.agentId, args.name);
      fresh = true;
    } else if (existing.defHash !== args.defHash) {
      this.db
        .prepare(
          `UPDATE schedule_state SET def_hash = ?, invalid_reason = NULL
           WHERE project_id = ? AND agent_id = ? AND name = ?`,
        )
        .run(args.defHash, args.projectId, args.agentId, args.name);
    }
    const row = this.find(args.projectId, args.agentId, args.name);
    if (!row) throw new Error("Failed to read back schedule_state after registration");
    return { row, fresh };
  }

  /** Advance the consumed scheduled time (advances whether triggered or skipped; restarts don't re-trigger). */
  markSlot(projectId: string, agentId: string, name: string, slotMs: number): void {
    this.db
      .prepare(
        `UPDATE schedule_state SET last_slot_ms = ?
         WHERE project_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(slotMs, projectId, agentId, name);
  }

  /** Record an actual send (also sets fired_once for a one-shot task). */
  markFired(
    projectId: string,
    agentId: string,
    name: string,
    firedAt: string,
    oneShot: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE schedule_state SET last_fired_at = ?, fired_once = CASE WHEN ? THEN 1 ELSE fired_once END
         WHERE project_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(firedAt, oneShot ? 1 : 0, projectId, agentId, name);
  }

  /** Missed marker for a one-shot task (the scheduled time had already passed at startup/registration reconciliation; missed means not backfilled). */
  markMissed(projectId: string, agentId: string, name: string): void {
    this.db
      .prepare(
        `UPDATE schedule_state SET missed = 1
         WHERE project_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(projectId, agentId, name);
  }

  /** Mark as disabled (e.g. the bound Session was deleted); cleared via registerOrSync after the file is modified. */
  markInvalid(projectId: string, agentId: string, name: string, reason: string): void {
    this.db
      .prepare(
        `UPDATE schedule_state SET invalid_reason = ?
         WHERE project_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(reason, projectId, agentId, name);
  }

  /** Deleting the file removes the task: clears its runtime state. */
  delete(projectId: string, agentId: string, name: string): void {
    this.db
      .prepare("DELETE FROM schedule_state WHERE project_id = ? AND agent_id = ? AND name = ?")
      .run(projectId, agentId, name);
  }

  /** Reconciliation cleanup: deletes state rows under this Agent that aren't in the current file list, returning the removed names. */
  deleteMissing(projectId: string, agentId: string, presentNames: string[]): string[] {
    const rows = this.listByAgent(projectId, agentId);
    const present = new Set(presentNames);
    const removed: string[] = [];
    for (const row of rows) {
      if (!present.has(row.name)) {
        this.delete(projectId, agentId, row.name);
        removed.push(row.name);
      }
    }
    return removed;
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM schedule_state WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM schedule_state WHERE project_id = ?").run(projectId);
  }
}
