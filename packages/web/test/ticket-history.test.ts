/**
 * A ticket's history and folded sections in the ticket drawer (features/company/
 * ticket-history.ts).
 *
 * - History rows list newest first, each with a key of its own.
 * - A row keeps who acted and when, and never the note the action wrote.
 * - An entry older than the history's timestamps is kept; no history lists nothing.
 * - The folded sections count the children and the ticket's sessions, and report each list's
 *   emptiness on its own.
 */
import { describe, expect, it } from "vitest";
import type { OrgTicketDetail, OrgTicketHistoryEntry } from "@prismshadow/penguin-server/api";
import { ticketHistoryRows, ticketSummaryCounts } from "../src/features/company/ticket-history";

const entry = (over: Partial<OrgTicketHistoryEntry> = {}): OrgTicketHistoryEntry => ({
  at: "2026-09-08T10:00:00.000Z",
  by: "user:alice",
  action: "created",
  ...over,
});

describe("ticketHistoryRows", () => {
  it("lists the newest first and keys every row apart", () => {
    const rows = ticketHistoryRows([
      entry({ at: "2026-09-08T10:00:00.000Z", action: "created" }),
      entry({ at: "2026-09-08T11:00:00.000Z", action: "moved", note: "in_progress" }),
      entry({ at: "2026-09-08T11:00:00.000Z", action: "moved", note: "review" }),
    ]);
    expect(rows.map((r) => r.action)).toEqual(["moved", "moved", "created"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("keeps who acted and when, and drops what the action wrote", () => {
    const rows = ticketHistoryRows([
      entry({ by: "agent:mk_dev", action: "progress", note: "drafted the schema" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      at: "2026-09-08T10:00:00.000Z",
      by: "agent:mk_dev",
      action: "progress",
    });
    expect(JSON.stringify(rows[0])).not.toContain("drafted the schema");
  });

  it("keeps an entry that predates the history's timestamps", () => {
    expect(ticketHistoryRows([entry({ at: "" })])[0]!.at).toBe("");
  });

  it("is empty for a ticket with no history", () => {
    expect(ticketHistoryRows([])).toEqual([]);
  });
});

describe("ticketSummaryCounts", () => {
  const detail = (
    children: string[],
    sessions: number,
  ): Pick<OrgTicketDetail, "children" | "sessionItems"> => ({
    children,
    sessionItems: Array.from({ length: sessions }, (_, i) => ({
      sessionId: `s${i}`,
      agentId: "mk_dev",
      status: "idle" as const,
    })),
  });

  it("counts the children and the ticket's sessions", () => {
    expect(ticketSummaryCounts(detail(["a", "b"], 3))).toEqual({
      children: 2,
      sessions: 3,
      childrenEmpty: false,
      sessionsEmpty: false,
    });
  });

  it("reports each list's emptiness on its own, so one fold's count never speaks for the other", () => {
    expect(ticketSummaryCounts(detail([], 0))).toEqual({
      children: 0,
      sessions: 0,
      childrenEmpty: true,
      sessionsEmpty: true,
    });
    expect(ticketSummaryCounts(detail([], 1))).toMatchObject({
      childrenEmpty: true,
      sessionsEmpty: false,
    });
    expect(ticketSummaryCounts(detail(["a"], 0))).toMatchObject({
      childrenEmpty: false,
      sessionsEmpty: true,
    });
  });
});
