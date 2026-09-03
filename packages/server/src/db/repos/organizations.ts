/**
 * Company-mode caches. Every table here is a projection of an organization's files (which
 * desk session an employee has, which sessions contribute to a ticket, how far a calendar
 * event or a channel scan has got, what a ticket looked like when it was last notified) or a
 * user's own read cursor. The service rebuilds the projections every reconcile pass, so a
 * dropped table costs one pass of silence, never a wrong answer.
 */
import type { DatabaseSync } from "node:sqlite";
import type { OrgCalendarOutcome } from "../../api/types.js";

export interface OrgSessionRow {
  sessionId: string;
  projectId: string;
  orgId: string;
  agentId: string;
  /** The employee's current desk (renewed desks stay for cost attribution). */
  current: boolean;
  /** Hop of the last mention-chain trigger delivered to this session. */
  triggerHop: number;
}

export interface OrgTicketSessionRow {
  projectId: string;
  orgId: string;
  ticketId: string;
  sessionId: string;
  agentId: string;
  triggerHop: number;
}

export interface OrgCalendarStateRow {
  projectId: string;
  orgId: string;
  agentId: string;
  name: string;
  startAtMs: number;
  defHash: string;
  lastSlotMs: number | null;
  lastFiredAt: string | null;
  firedOnce: boolean;
  missed: boolean;
  invalidReason: string | null;
  lastOutcome: OrgCalendarOutcome | null;
}

export interface OrgTicketStateRow {
  projectId: string;
  orgId: string;
  ticketId: string;
  status: string;
  owner: string;
  blocked: string;
  blockedBy: string;
}

export interface OrgBudgetStateRow {
  projectId: string;
  orgId: string;
  agentId: string;
  period: string;
  warnedAt: string | null;
  pausedAt: string | null;
}

/** Where a session belongs, when it belongs to an organization at all. */
export interface OrgSessionOwner {
  projectId: string;
  orgId: string;
  agentId: string;
  kind: "desk" | "ticket";
  triggerHop: number;
}

const calendarRow = (r: Record<string, unknown>): OrgCalendarStateRow => ({
  projectId: r.project_id as string,
  orgId: r.org_id as string,
  agentId: r.agent_id as string,
  name: r.name as string,
  startAtMs: Number(r.start_at_ms),
  defHash: r.def_hash as string,
  lastSlotMs: r.last_slot_ms === null ? null : Number(r.last_slot_ms),
  lastFiredAt: (r.last_fired_at as string | null) ?? null,
  firedOnce: Number(r.fired_once) === 1,
  missed: Number(r.missed) === 1,
  invalidReason: (r.invalid_reason as string | null) ?? null,
  lastOutcome: (r.last_outcome as OrgCalendarOutcome | null) ?? null,
});

export class OrgCacheRepo {
  constructor(private readonly db: DatabaseSync) {}

  // ---- desk sessions ----

  deskSessions(projectId: string, orgId: string): OrgSessionRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM org_sessions WHERE project_id = ? AND org_id = ? ORDER BY agent_id, current DESC",
      )
      .all(projectId, orgId) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      projectId: r.project_id as string,
      orgId: r.org_id as string,
      agentId: r.agent_id as string,
      current: Number(r.current) === 1,
      triggerHop: Number(r.trigger_hop),
    }));
  }

  /** Makes the table match the ledger: unknown rows are added, rows for sessions no longer in it removed, hops kept. */
  syncDeskSessions(
    projectId: string,
    orgId: string,
    rows: Array<{ sessionId: string; agentId: string; current: boolean }>,
  ): void {
    const keep = new Set(rows.map((r) => r.sessionId));
    for (const existing of this.deskSessions(projectId, orgId)) {
      if (!keep.has(existing.sessionId)) {
        this.db.prepare("DELETE FROM org_sessions WHERE session_id = ?").run(existing.sessionId);
      }
    }
    const upsert = this.db.prepare(
      `INSERT INTO org_sessions (session_id, project_id, org_id, agent_id, current)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET project_id = excluded.project_id, org_id = excluded.org_id,
         agent_id = excluded.agent_id, current = excluded.current`,
    );
    for (const r of rows) upsert.run(r.sessionId, projectId, orgId, r.agentId, r.current ? 1 : 0);
  }

  // ---- ticket sessions ----

  ticketSessions(projectId: string, orgId: string): OrgTicketSessionRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM org_ticket_sessions WHERE project_id = ? AND org_id = ? ORDER BY ticket_id, session_id",
      )
      .all(projectId, orgId) as Record<string, unknown>[];
    return rows.map((r) => ({
      projectId: r.project_id as string,
      orgId: r.org_id as string,
      ticketId: r.ticket_id as string,
      sessionId: r.session_id as string,
      agentId: r.agent_id as string,
      triggerHop: Number(r.trigger_hop),
    }));
  }

  syncTicketSessions(
    projectId: string,
    orgId: string,
    rows: Array<{ ticketId: string; sessionId: string; agentId: string }>,
  ): void {
    const keep = new Set(rows.map((r) => `${r.ticketId}\0${r.sessionId}`));
    for (const existing of this.ticketSessions(projectId, orgId)) {
      if (!keep.has(`${existing.ticketId}\0${existing.sessionId}`)) {
        this.db
          .prepare(
            "DELETE FROM org_ticket_sessions WHERE project_id = ? AND org_id = ? AND ticket_id = ? AND session_id = ?",
          )
          .run(projectId, orgId, existing.ticketId, existing.sessionId);
      }
    }
    const upsert = this.db.prepare(
      `INSERT INTO org_ticket_sessions (project_id, org_id, ticket_id, session_id, agent_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, org_id, ticket_id, session_id) DO UPDATE SET agent_id = excluded.agent_id`,
    );
    for (const r of rows) upsert.run(projectId, orgId, r.ticketId, r.sessionId, r.agentId);
  }

  addTicketSession(
    projectId: string,
    orgId: string,
    ticketId: string,
    sessionId: string,
    agentId: string,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO org_ticket_sessions (project_id, org_id, ticket_id, session_id, agent_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(projectId, orgId, ticketId, sessionId, agentId);
  }

  /** Which organization a session belongs to (desk first, then ticket), or null. */
  ownerOfSession(sessionId: string): OrgSessionOwner | null {
    const desk = this.db
      .prepare("SELECT * FROM org_sessions WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (desk) {
      return {
        projectId: desk.project_id as string,
        orgId: desk.org_id as string,
        agentId: desk.agent_id as string,
        kind: "desk",
        triggerHop: Number(desk.trigger_hop),
      };
    }
    const ticket = this.db
      .prepare("SELECT * FROM org_ticket_sessions WHERE session_id = ? ORDER BY ticket_id LIMIT 1")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!ticket) return null;
    return {
      projectId: ticket.project_id as string,
      orgId: ticket.org_id as string,
      agentId: ticket.agent_id as string,
      kind: "ticket",
      triggerHop: Number(ticket.trigger_hop),
    };
  }

  /** Records the hop of the trigger just delivered to a session (both tables, whichever holds it). */
  setTriggerHop(sessionId: string, hop: number): void {
    this.db
      .prepare("UPDATE org_sessions SET trigger_hop = ? WHERE session_id = ?")
      .run(hop, sessionId);
    this.db
      .prepare("UPDATE org_ticket_sessions SET trigger_hop = ? WHERE session_id = ?")
      .run(hop, sessionId);
  }

  // ---- calendar state (mirrors schedule_state) ----

  findCalendar(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
  ): OrgCalendarStateRow | null {
    const r = this.db
      .prepare(
        "SELECT * FROM org_calendar_state WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?",
      )
      .get(projectId, orgId, agentId, name) as Record<string, unknown> | undefined;
    return r ? calendarRow(r) : null;
  }

  listCalendar(projectId: string, orgId: string): OrgCalendarStateRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM org_calendar_state WHERE project_id = ? AND org_id = ? ORDER BY agent_id, name",
      )
      .all(projectId, orgId) as Record<string, unknown>[];
    return rows.map(calendarRow);
  }

  /** Same identity rule as schedules: a `start_at` change resets the run state, a content change only clears the invalid mark. */
  registerCalendar(args: {
    projectId: string;
    orgId: string;
    agentId: string;
    name: string;
    startAtMs: number;
    defHash: string;
  }): { row: OrgCalendarStateRow; fresh: boolean } {
    const existing = this.findCalendar(args.projectId, args.orgId, args.agentId, args.name);
    let fresh = false;
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO org_calendar_state (project_id, org_id, agent_id, name, start_at_ms, def_hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(args.projectId, args.orgId, args.agentId, args.name, args.startAtMs, args.defHash);
      fresh = true;
    } else if (existing.startAtMs !== args.startAtMs) {
      this.db
        .prepare(
          `UPDATE org_calendar_state
             SET start_at_ms = ?, def_hash = ?, last_slot_ms = NULL, last_fired_at = NULL,
                 fired_once = 0, missed = 0, invalid_reason = NULL, last_outcome = NULL
           WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?`,
        )
        .run(args.startAtMs, args.defHash, args.projectId, args.orgId, args.agentId, args.name);
      fresh = true;
    } else if (existing.defHash !== args.defHash) {
      this.db
        .prepare(
          `UPDATE org_calendar_state SET def_hash = ?, invalid_reason = NULL
           WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?`,
        )
        .run(args.defHash, args.projectId, args.orgId, args.agentId, args.name);
    }
    const row = this.findCalendar(args.projectId, args.orgId, args.agentId, args.name);
    if (!row) throw new Error("Failed to read back org_calendar_state after registration");
    return { row, fresh };
  }

  markCalendarSlot(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    slotMs: number,
  ): void {
    this.db
      .prepare(
        `UPDATE org_calendar_state SET last_slot_ms = ?
         WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(slotMs, projectId, orgId, agentId, name);
  }

  markCalendarFired(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    firedAt: string,
    oneShot: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE org_calendar_state
           SET last_fired_at = ?, fired_once = CASE WHEN ? THEN 1 ELSE fired_once END
         WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(firedAt, oneShot ? 1 : 0, projectId, orgId, agentId, name);
  }

  markCalendarMissed(projectId: string, orgId: string, agentId: string, name: string): void {
    this.db
      .prepare(
        `UPDATE org_calendar_state SET missed = 1
         WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(projectId, orgId, agentId, name);
  }

  markCalendarOutcome(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    outcome: OrgCalendarOutcome,
  ): void {
    this.db
      .prepare(
        `UPDATE org_calendar_state SET last_outcome = ?
         WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?`,
      )
      .run(outcome, projectId, orgId, agentId, name);
  }

  /** Reconciliation cleanup: rows whose file is gone. */
  deleteMissingCalendar(
    projectId: string,
    orgId: string,
    present: Array<{ agentId: string; name: string }>,
  ): void {
    const keep = new Set(present.map((p) => `${p.agentId}\0${p.name}`));
    for (const row of this.listCalendar(projectId, orgId)) {
      if (!keep.has(`${row.agentId}\0${row.name}`)) {
        this.db
          .prepare(
            "DELETE FROM org_calendar_state WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?",
          )
          .run(projectId, orgId, row.agentId, row.name);
      }
    }
  }

  deleteCalendar(projectId: string, orgId: string, agentId: string, name: string): void {
    this.db
      .prepare(
        "DELETE FROM org_calendar_state WHERE project_id = ? AND org_id = ? AND agent_id = ? AND name = ?",
      )
      .run(projectId, orgId, agentId, name);
  }

  // ---- ticket state ----

  findTicketState(projectId: string, orgId: string, ticketId: string): OrgTicketStateRow | null {
    const r = this.db
      .prepare(
        "SELECT * FROM org_ticket_state WHERE project_id = ? AND org_id = ? AND ticket_id = ?",
      )
      .get(projectId, orgId, ticketId) as Record<string, unknown> | undefined;
    return r
      ? {
          projectId: r.project_id as string,
          orgId: r.org_id as string,
          ticketId: r.ticket_id as string,
          status: r.status as string,
          owner: r.owner as string,
          blocked: r.blocked as string,
          blockedBy: r.blocked_by as string,
        }
      : null;
  }

  upsertTicketState(row: OrgTicketStateRow): void {
    this.db
      .prepare(
        `INSERT INTO org_ticket_state (project_id, org_id, ticket_id, status, owner, blocked, blocked_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, org_id, ticket_id) DO UPDATE SET status = excluded.status,
           owner = excluded.owner, blocked = excluded.blocked, blocked_by = excluded.blocked_by`,
      )
      .run(
        row.projectId,
        row.orgId,
        row.ticketId,
        row.status,
        row.owner,
        row.blocked,
        row.blockedBy,
      );
  }

  deleteMissingTicketState(projectId: string, orgId: string, presentIds: string[]): void {
    const keep = new Set(presentIds);
    const rows = this.db
      .prepare("SELECT ticket_id FROM org_ticket_state WHERE project_id = ? AND org_id = ?")
      .all(projectId, orgId) as Array<{ ticket_id: string }>;
    for (const r of rows) {
      if (!keep.has(r.ticket_id)) {
        this.db
          .prepare(
            "DELETE FROM org_ticket_state WHERE project_id = ? AND org_id = ? AND ticket_id = ?",
          )
          .run(projectId, orgId, r.ticket_id);
      }
    }
  }

  // ---- channel cursors ----

  channelOffset(projectId: string, orgId: string, channelId: string, date: string): number {
    const r = this.db
      .prepare(
        "SELECT offset_bytes FROM org_channel_state WHERE project_id = ? AND org_id = ? AND channel_id = ? AND date = ?",
      )
      .get(projectId, orgId, channelId, date) as { offset_bytes: number } | undefined;
    return r ? Number(r.offset_bytes) : 0;
  }

  setChannelOffset(
    projectId: string,
    orgId: string,
    channelId: string,
    date: string,
    offset: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO org_channel_state (project_id, org_id, channel_id, date, offset_bytes) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, org_id, channel_id, date) DO UPDATE SET offset_bytes = excluded.offset_bytes`,
      )
      .run(projectId, orgId, channelId, date, offset);
  }

  readCursor(projectId: string, orgId: string, channelId: string, userId: string): string | null {
    const r = this.db
      .prepare(
        "SELECT last_read_id FROM org_channel_reads WHERE project_id = ? AND org_id = ? AND channel_id = ? AND user_id = ?",
      )
      .get(projectId, orgId, channelId, userId) as { last_read_id: string } | undefined;
    return r ? r.last_read_id : null;
  }

  setReadCursor(
    projectId: string,
    orgId: string,
    channelId: string,
    userId: string,
    lastReadId: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO org_channel_reads (project_id, org_id, channel_id, user_id, last_read_id) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, org_id, channel_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`,
      )
      .run(projectId, orgId, channelId, userId, lastReadId);
  }

  // ---- budget marks ----

  budgetState(
    projectId: string,
    orgId: string,
    agentId: string,
    period: string,
  ): OrgBudgetStateRow | null {
    const r = this.db
      .prepare(
        "SELECT * FROM org_budget_state WHERE project_id = ? AND org_id = ? AND agent_id = ? AND period = ?",
      )
      .get(projectId, orgId, agentId, period) as Record<string, unknown> | undefined;
    return r ? budgetRow(r) : null;
  }

  listBudgetStates(projectId: string, orgId: string, period: string): OrgBudgetStateRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM org_budget_state WHERE project_id = ? AND org_id = ? AND period = ? ORDER BY agent_id",
      )
      .all(projectId, orgId, period) as Record<string, unknown>[];
    return rows.map(budgetRow);
  }

  markBudget(
    projectId: string,
    orgId: string,
    agentId: string,
    period: string,
    patch: { warnedAt?: string | null; pausedAt?: string | null },
  ): void {
    this.db
      .prepare(
        `INSERT INTO org_budget_state (project_id, org_id, agent_id, period) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, org_id, agent_id, period) DO NOTHING`,
      )
      .run(projectId, orgId, agentId, period);
    if (patch.warnedAt !== undefined) {
      this.db
        .prepare(
          "UPDATE org_budget_state SET warned_at = ? WHERE project_id = ? AND org_id = ? AND agent_id = ? AND period = ?",
        )
        .run(patch.warnedAt, projectId, orgId, agentId, period);
    }
    if (patch.pausedAt !== undefined) {
      this.db
        .prepare(
          "UPDATE org_budget_state SET paused_at = ? WHERE project_id = ? AND org_id = ? AND agent_id = ? AND period = ?",
        )
        .run(patch.pausedAt, projectId, orgId, agentId, period);
    }
  }

  // ---- lifecycle ----

  deleteOrg(projectId: string, orgId: string): void {
    for (const table of [
      "org_sessions",
      "org_ticket_sessions",
      "org_calendar_state",
      "org_ticket_state",
      "org_channel_state",
      "org_channel_reads",
      "org_budget_state",
    ]) {
      this.db
        .prepare(`DELETE FROM ${table} WHERE project_id = ? AND org_id = ?`)
        .run(projectId, orgId);
    }
  }

  deleteProject(projectId: string): void {
    for (const table of [
      "org_sessions",
      "org_ticket_sessions",
      "org_calendar_state",
      "org_ticket_state",
      "org_channel_state",
      "org_channel_reads",
      "org_budget_state",
    ]) {
      this.db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
  }
}

const budgetRow = (r: Record<string, unknown>): OrgBudgetStateRow => ({
  projectId: r.project_id as string,
  orgId: r.org_id as string,
  agentId: r.agent_id as string,
  period: r.period as string,
  warnedAt: (r.warned_at as string | null) ?? null,
  pausedAt: (r.paused_at as string | null) ?? null,
});
