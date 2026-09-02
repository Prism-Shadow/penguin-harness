/**
 * ticket-board.ts unit tests: the five columns in lifecycle order, card sorting (priority,
 * then due, then id), the blocked-only filter, the counts the overview shows, which moves
 * need a reason, and the "blocked on me" selection.
 */
import { describe, expect, it } from "vitest";
import type { OrgTicketItem, OrgTicketsResponse } from "@prismshadow/penguin-server/api";
import {
  TICKET_COLUMNS,
  allTickets,
  blockedOnUser,
  boardColumns,
  boardCounts,
  canMove,
  isBlocked,
  isTicketStatus,
  moveNeedsReason,
  sortTickets,
} from "../src/features/company/ticket-board";

function ticket(over: Partial<OrgTicketItem> & { ticketId: string }): OrgTicketItem {
  return {
    title: over.ticketId,
    status: "proposed",
    initiator: "user:alice",
    notify: [],
    priority: "P1",
    sessions: [],
    running: false,
    cost: 0,
    ...over,
  };
}

function board(over: Partial<OrgTicketsResponse["columns"]> = {}): OrgTicketsResponse {
  return {
    columns: { proposed: [], in_progress: [], review: [], done: [], rejected: [], ...over },
    invalidFiles: [],
  };
}

describe("columns", () => {
  it("are the five statuses in lifecycle order", () => {
    expect([...TICKET_COLUMNS]).toEqual(["proposed", "in_progress", "review", "done", "rejected"]);
    expect(isTicketStatus("review")).toBe(true);
    expect(isTicketStatus("blocked")).toBe(false);
    expect(isTicketStatus(null)).toBe(false);
  });

  it("sort cards by priority, then earlier due date, then id", () => {
    const sorted = sortTickets([
      ticket({ ticketId: "t3", priority: "P1", due: "2026-09-10" }),
      ticket({ ticketId: "t1", priority: "P2" }),
      ticket({ ticketId: "t4", priority: "P1", due: "2026-09-01" }),
      ticket({ ticketId: "t2", priority: "P0" }),
      ticket({ ticketId: "t0", priority: "P1" }),
    ]);
    expect(sorted.map((t) => t.ticketId)).toEqual(["t2", "t4", "t3", "t0", "t1"]);
  });

  it("boardColumns renders every column, filtered to blocked cards on request", () => {
    const res = board({
      proposed: [
        ticket({ ticketId: "a" }),
        ticket({ ticketId: "b", blocked: "waiting", blockedBy: "user:alice" }),
      ],
      review: [ticket({ ticketId: "c", status: "review" })],
    });
    expect(boardColumns(res).map((c) => c.tickets.map((t) => t.ticketId))).toEqual([
      ["a", "b"],
      [],
      ["c"],
      [],
      [],
    ]);
    expect(
      boardColumns(res, { blockedOnly: true }).map((c) => c.tickets.map((t) => t.ticketId)),
    ).toEqual([["b"], [], [], [], []]);
    expect(allTickets(res).map((t) => t.ticketId)).toEqual(["a", "b", "c"]);
  });

  it("counts per column and the blocked total", () => {
    const res = board({
      in_progress: [ticket({ ticketId: "x", blocked: "r" }), ticket({ ticketId: "y" })],
      done: [ticket({ ticketId: "z", status: "done" })],
    });
    expect(boardCounts(res)).toEqual({
      byStatus: { proposed: 0, in_progress: 2, review: 0, done: 1, rejected: 0 },
      blocked: 1,
    });
  });
});

describe("moves and blocks", () => {
  it("only a move into rejected needs a reason, and a same-column drop is no move", () => {
    expect(moveNeedsReason("rejected")).toBe(true);
    expect(moveNeedsReason("done")).toBe(false);
    expect(canMove("proposed", "proposed")).toBe(false);
    expect(canMove("proposed", "in_progress")).toBe(true);
  });

  it("an empty blocked string is not blocked, and blocked-on-me matches the user principal only", () => {
    expect(isBlocked(ticket({ ticketId: "a", blocked: "" }))).toBe(false);
    const list = [
      ticket({ ticketId: "a", blocked: "r", blockedBy: "user:alice" }),
      ticket({ ticketId: "b", blocked: "r", blockedBy: "agent:alice" }),
      ticket({ ticketId: "c", blockedBy: "user:alice" }),
    ];
    expect(blockedOnUser(list, "alice").map((t) => t.ticketId)).toEqual(["a"]);
  });
});
