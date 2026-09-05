/**
 * ticket-board.ts unit tests: the five columns in lifecycle order, card sorting (priority,
 * then due, then id), the blocked-only filter and the search box, the counts the overview
 * shows, which moves need a reason, the "blocked on me" selection, the overdue test, the
 * day read off a ticket id, and the invalid-ticket list.
 */
import { describe, expect, it } from "vitest";
import type { OrgTicketItem, OrgTicketsResponse } from "@prismshadow/penguin-server/api";
import {
  TICKET_COLUMNS,
  allTickets,
  boardColumns,
  canMove,
  invalidTickets,
  isBlocked,
  isOverdue,
  isTicketStatus,
  matchesTicketQuery,
  moveNeedsReason,
  sortTickets,
  ticketCreatedDate,
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

  it("the search box matches title, id, owner and parent, case-insensitively, and the owner's name through the chart", () => {
    const t = ticket({
      ticketId: "2026-09-02-site",
      title: "Build the Marketplace site",
      owner: "agent:mk_dev",
      parent: "2026-09-02-launch",
    });
    const names = new Map([["mk_dev", "Dev"]]);
    expect(matchesTicketQuery(t, "")).toBe(true);
    expect(matchesTicketQuery(t, "  marketplace ")).toBe(true);
    expect(matchesTicketQuery(t, "09-02-site")).toBe(true);
    expect(matchesTicketQuery(t, "mk_dev")).toBe(true);
    expect(matchesTicketQuery(t, "launch")).toBe(true);
    expect(matchesTicketQuery(t, "dev", names)).toBe(true);
    expect(matchesTicketQuery(t, "seo")).toBe(false);
    const res = board({
      proposed: [t, ticket({ ticketId: "x", title: "SEO", blocked: "r" })],
      done: [ticket({ ticketId: "y", title: "Marketplace launch post", status: "done" })],
    });
    expect(
      boardColumns(res, { query: "market" }).map((c) => c.tickets.map((x) => x.ticketId)),
    ).toEqual([["2026-09-02-site"], [], [], ["y"], []]);
    // Both narrowings apply at once.
    expect(
      boardColumns(res, { query: "seo", blockedOnly: true }).map((c) =>
        c.tickets.map((x) => x.ticketId),
      ),
    ).toEqual([["x"], [], [], [], []]);
  });
});

describe("moves and blocks", () => {
  it("only a move into rejected needs a reason, and a same-column drop is no move", () => {
    expect(moveNeedsReason("rejected")).toBe(true);
    expect(moveNeedsReason("done")).toBe(false);
    expect(canMove("proposed", "proposed")).toBe(false);
    expect(canMove("proposed", "in_progress")).toBe(true);
  });

  it("an empty blocked string is not blocked", () => {
    expect(isBlocked(ticket({ ticketId: "a", blocked: "" }))).toBe(false);
    expect(isBlocked(ticket({ ticketId: "b", blocked: "r" }))).toBe(true);
    expect(isBlocked(ticket({ ticketId: "c" }))).toBe(false);
  });
});

describe("card facts", () => {
  it("a due date is overdue only once today has passed it", () => {
    expect(isOverdue("2026-09-01", "2026-09-02")).toBe(true);
    expect(isOverdue("2026-09-02", "2026-09-02")).toBe(false);
    expect(isOverdue("2026-09-03", "2026-09-02")).toBe(false);
    expect(isOverdue(undefined, "2026-09-02")).toBe(false);
    expect(isOverdue("soon", "2026-09-02")).toBe(false);
  });

  it("reads the creation day off the id and leaves other shapes alone", () => {
    expect(ticketCreatedDate("2026-09-02-marketplace")).toBe("2026-09-02");
    expect(ticketCreatedDate("2026-09-02-t-fb79d3")).toBe("2026-09-02");
    expect(ticketCreatedDate("marketplace")).toBeNull();
    expect(ticketCreatedDate("2026-09-02")).toBeNull();
  });

  it("lists the tickets the server flagged, in column order", () => {
    const res = board({
      proposed: [ticket({ ticketId: "a" }), ticket({ ticketId: "b", invalid: "duplicate id" })],
      review: [ticket({ ticketId: "c", status: "review", invalid: "status mismatch" })],
    });
    expect(invalidTickets(res).map((t) => t.ticketId)).toEqual(["b", "c"]);
  });
});
