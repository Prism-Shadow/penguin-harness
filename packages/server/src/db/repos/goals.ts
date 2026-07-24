/**
 * Repo for goal-mode runtime state: one row per goal run, keyed by autoincrement id (a
 * Session may run goals repeatedly; the latest row is what the UI shows). The on-disk
 * GOAL.yaml is the model-facing protocol; this table is the server-side record the banner
 * restores from and the terminal outcome lands in (including the server-only `aborted`,
 * which never appears in the file — the on-disk status stays `active` for resuming).
 */
import type { DatabaseSync } from "node:sqlite";

export type GoalRowStatus = "active" | "complete" | "blocked" | "budget_limited" | "aborted";

export interface GoalStateRow {
  id: number;
  sessionId: string;
  projectId: string;
  agentId: string;
  objective: string;
  status: GoalRowStatus;
  budget: number;
  used: number;
  rounds: number;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): GoalStateRow {
  return {
    id: Number(r.id),
    sessionId: r.session_id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    objective: r.objective as string,
    status: r.status as GoalRowStatus,
    budget: Number(r.budget),
    used: Number(r.used),
    rounds: Number(r.rounds),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class GoalsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Register a new goal run (status active, counters at zero); returns the new row id. */
  create(args: {
    sessionId: string;
    projectId: string;
    agentId: string;
    objective: string;
    budget: number;
  }): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO goal_state
           (session_id, project_id, agent_id, objective, status, budget, used, rounds, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, 0, 0, ?, ?)`,
      )
      .run(args.sessionId, args.projectId, args.agentId, args.objective, args.budget, now, now);
    return Number(result.lastInsertRowid);
  }

  /** Per-round progress refresh (round just started; `used` mirrors the runner's accounting so far). */
  progress(id: number, rounds: number, used: number): void {
    this.db
      .prepare("UPDATE goal_state SET rounds = ?, used = ?, updated_at = ? WHERE id = ?")
      .run(rounds, used, new Date().toISOString(), id);
  }

  /** Record the terminal outcome. */
  finish(id: number, status: GoalRowStatus, rounds: number, used: number): void {
    this.db
      .prepare(
        "UPDATE goal_state SET status = ?, rounds = ?, used = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, rounds, used, new Date().toISOString(), id);
  }

  /** The Session's most recent goal run (what the chat page's banner restores from); null if it never ran one. */
  latestForSession(sessionId: string): GoalStateRow | null {
    const r = this.db
      .prepare("SELECT * FROM goal_state WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get(sessionId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare("DELETE FROM goal_state WHERE session_id = ?").run(sessionId);
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM goal_state WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM goal_state WHERE project_id = ?").run(projectId);
  }

  /**
   * Startup reconciliation: a goal runs only in SessionManager memory, so a hard crash
   * (SIGKILL, power loss) leaves its row stuck `active` with no runner behind it — the banner
   * would then restore a forever-"running" goal. Called once at boot, before the server accepts
   * connections (nothing can be running yet), so every remaining `active` row is an orphan:
   * mark them `aborted`. The on-disk GOAL.yaml is left `active` as the documented resume point.
   * Returns the number of rows reconciled.
   */
  abortOrphanedActive(): number {
    const result = this.db
      .prepare("UPDATE goal_state SET status = 'aborted', updated_at = ? WHERE status = 'active'")
      .run(new Date().toISOString());
    return Number(result.changes);
  }
}
