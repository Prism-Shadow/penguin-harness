/**
 * The ticket board (features/company/ticket-board.ts).
 *
 * - Only the five lifecycle statuses are ticket statuses.
 * - Cards sort by priority, then the earlier due date, then id; by due date, then priority; or
 *   by how long they have been waiting (oldest first, unreadable dates last).
 * - The quick filters keep what is waiting on a person, what is blocked, what is past its due
 *   date while still open, and the reader's own tickets, and the counts report each of those
 *   over the tickets the search box and the chips left.
 * - The board renders every column, narrowed to blocked cards and by the search box (title,
 *   id, owner and parent, case-insensitively, and the owner's name through the chart), both
 *   narrowings at once.
 * - Only a move into rejected needs a reason, and a same-column drop is no move; an empty
 *   blocked string is not blocked.
 * - A new id's slug is lowercase words joined by hyphens.
 * - A due date is overdue once today has passed it; the creation day is read off the id.
 * - The tickets the server flagged invalid are listed in column order.
 */
import { describe, expect, it } from "vitest";
import type { OrgTicketItem, OrgTicketsResponse } from "@prismshadow/penguin-server/api";
import {
  allTickets,
  boardColumns,
  boardCounts,
  canMove,
  groupTickets,
  invalidTickets,
  isBlocked,
  isOverdue,
  isTicketSlug,
  isTicketStatus,
  matchesQuickFilter,
  matchesTicketQuery,
  moveNeedsReason,
  sortTickets,
  ticketAgeDays,
  ticketCreatedDate,
} from "../src/features/company/ticket-board";

function ticket(over: Partial<OrgTicketItem> & { ticketId: string }): OrgTicketItem {
  return {
    title: over.ticketId,
    status: "proposed",
    owner: "user:alice",
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
  it("knows the lifecycle statuses and nothing else", () => {
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

describe("sorts", () => {
  const dated = [
    ticket({ ticketId: "2026-09-01-c", due: "2026-10-01", priority: "P2" }),
    ticket({ ticketId: "2026-08-20-a", priority: "P0" }),
    ticket({ ticketId: "2026-09-10-d", due: "2026-09-15", priority: "P1" }),
    ticket({ ticketId: "2026-09-05-b", priority: "P1" }),
  ];

  it("due date first, undated last, priority breaking ties", () => {
    expect(sortTickets(dated, "due").map((t) => t.ticketId)).toEqual([
      "2026-09-10-d",
      "2026-09-01-c",
      "2026-08-20-a",
      "2026-09-05-b",
    ]);
  });

  it("age reads a column as a queue: the oldest id first, unreadable dates last", () => {
    expect(sortTickets(dated, "age").map((t) => t.ticketId)).toEqual([
      "2026-08-20-a",
      "2026-09-01-c",
      "2026-09-05-b",
      "2026-09-10-d",
    ]);
    expect(sortTickets([ticket({ ticketId: "google-oauth" })], "age")[0]!.ticketId).toBe(
      "google-oauth",
    );
    expect(
      sortTickets(
        [ticket({ ticketId: "google-oauth" }), ticket({ ticketId: "2026-09-01-x" })],
        "age",
      ).map((t) => t.ticketId),
    ).toEqual(["2026-09-01-x", "google-oauth"]);
  });

  it("priority stays the default, and grouping keeps the chosen order inside a group", () => {
    expect(sortTickets(dated).map((t) => t.ticketId)).toEqual([
      "2026-08-20-a",
      "2026-09-10-d",
      "2026-09-05-b",
      "2026-09-01-c",
    ]);
    const groups = groupTickets(
      [
        ticket({ ticketId: "2026-09-01-b", owner: "agent:dev", priority: "P1" }),
        ticket({ ticketId: "2026-08-01-a", owner: "agent:dev", priority: "P2" }),
      ],
      "owner",
      { sort: "age" },
    );
    expect(groups[0]!.tickets.map((t) => t.ticketId)).toEqual(["2026-08-01-a", "2026-09-01-b"]);
  });
});

describe("quick filters and their counts", () => {
  const today = "2026-09-05";
  const res = board({
    proposed: [
      ticket({ ticketId: "2026-09-01-open", owner: "user:alice" }),
      ticket({
        ticketId: "2026-08-01-blocked",
        owner: "user:bob",
        blocked: "waiting",
      }),
    ],
    in_progress: [
      ticket({
        ticketId: "2026-08-20-late",
        status: "in_progress",
        due: "2026-09-01",
        owner: "user:alice",
      }),
    ],
    review: [ticket({ ticketId: "2026-09-02-check", status: "review", owner: "user:bob" })],
    done: [
      ticket({
        ticketId: "2026-08-01-shipped",
        status: "done",
        due: "2026-08-02",
        owner: "user:bob",
      }),
    ],
  });

  it("one filter at a time: the queue, blocked, overdue (open only) and mine", () => {
    expect(
      boardColumns(res, { quick: "queue" }).flatMap((c) => c.tickets.map((t) => t.ticketId)),
    ).toEqual(["2026-08-01-blocked", "2026-09-01-open", "2026-09-02-check"]);
    expect(
      boardColumns(res, { quick: "blocked" }).flatMap((c) => c.tickets.map((t) => t.ticketId)),
    ).toEqual(["2026-08-01-blocked"]);
    // The finished ticket's date is long past; a finished ticket is never overdue.
    expect(
      boardColumns(res, { quick: "overdue", todayKey: today }).flatMap((c) =>
        c.tickets.map((t) => t.ticketId),
      ),
    ).toEqual(["2026-08-20-late"]);
    expect(
      boardColumns(res, { quick: "mine", me: "user:alice", todayKey: today }).flatMap((c) =>
        c.tickets.map((t) => t.ticketId),
      ),
    ).toEqual(["2026-09-01-open", "2026-08-20-late"]);
    // No principal, nothing is mine.
    expect(boardColumns(res, { quick: "mine" }).flatMap((c) => c.tickets)).toEqual([]);
  });

  it("the counts report every chip over the tickets the search and chips left", () => {
    expect(boardCounts(allTickets(res), { todayKey: today, me: "user:alice" })).toEqual({
      total: 5,
      queue: 3,
      blocked: 1,
      overdue: 1,
      mine: 2,
    });
    expect(boardCounts(allTickets(res).slice(0, 1), { todayKey: today })).toEqual({
      total: 1,
      queue: 1,
      blocked: 0,
      overdue: 0,
      mine: 0,
    });
  });

  it("the quick filter composes with the search box and the priority chips", () => {
    expect(
      boardColumns(res, {
        quick: "queue",
        query: "check",
        priorities: ["P1"],
      }).flatMap((c) => c.tickets.map((t) => t.ticketId)),
    ).toEqual(["2026-09-02-check"]);
  });

  it("an unknown quick filter reads as everything", () => {
    expect(matchesQuickFilter(ticket({ ticketId: "a" }), "all")).toBe(true);
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

describe("id slug", () => {
  it("accepts lowercase words joined by hyphens and nothing else", () => {
    expect(isTicketSlug("marketplace")).toBe(true);
    expect(isTicketSlug("marketplace-site")).toBe(true);
    expect(isTicketSlug("a-b-c")).toBe(true);
    // Digits are the date prefix's job, not the slug's.
    expect(isTicketSlug("site2")).toBe(false);
    expect(isTicketSlug("2026-site")).toBe(false);
    expect(isTicketSlug("Marketplace")).toBe(false);
    expect(isTicketSlug("marketplace site")).toBe(false);
    expect(isTicketSlug("marketplace_site")).toBe(false);
    expect(isTicketSlug("marketplace-")).toBe(false);
    expect(isTicketSlug("-marketplace")).toBe(false);
    expect(isTicketSlug("")).toBe(false);
    expect(isTicketSlug("站点")).toBe(false);
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

  it("boardColumns keeps only the picked priorities when chips are set", () => {
    const res = board({
      proposed: [
        ticket({ ticketId: "a", priority: "P0" }),
        ticket({ ticketId: "b", priority: "P1" }),
        ticket({ ticketId: "c", priority: "P2" }),
      ],
    });
    expect(
      boardColumns(res, { priorities: ["P0", "P2"] })[0]!.tickets.map((t) => t.ticketId),
    ).toEqual(["a", "c"]);
    expect(boardColumns(res)[0]!.tickets).toHaveLength(3);
  });

  it("groups cards by owner with display names, cards sorted inside", () => {
    const groups = groupTickets(
      [
        ticket({ ticketId: "b", owner: "agent:dev", priority: "P1" }),
        ticket({ ticketId: "a", owner: "agent:dev", priority: "P0" }),
        ticket({ ticketId: "c", owner: "user:alice", priority: "P0" }),
      ],
      "owner",
      { names: new Map([["dev", "Dev"]]) },
    );
    expect(groups.map((g) => [g.label, g.tickets.map((t) => t.ticketId)])).toEqual([
      ["Dev", ["a", "b"]],
      ["user:alice", ["c"]],
    ]);
  });

  it("groups cards by priority P0-first and by parent with the orphan bucket last", () => {
    expect(
      groupTickets(
        [
          ticket({ ticketId: "a", priority: "P2" }),
          ticket({ ticketId: "b", priority: "P0" }),
        ],
        "priority",
      ).map((g) => g.key),
    ).toEqual(["P0", "P2"]);
    const groups = groupTickets(
      [
        ticket({ ticketId: "a", parent: "p2" }),
        ticket({ ticketId: "b" }),
        ticket({ ticketId: "c", parent: "p1" }),
      ],
      "parent",
      { titles: new Map([["p1", "Epic one"]]) },
    );
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["p1", "Epic one"],
      ["p2", "p2"],
      ["", ""],
    ]);
    expect(groups[0]!.tickets.map((t) => t.ticketId)).toEqual(["c"]);
  });

  it("counts whole days since the id was minted, null for other shapes", () => {
    expect(ticketAgeDays("2026-09-02-marketplace", "2026-09-05")).toBe(3);
    expect(ticketAgeDays("2026-09-02-marketplace", "2026-09-02")).toBe(0);
    expect(ticketAgeDays("2026-09-05-marketplace", "2026-09-02")).toBe(0);
    expect(ticketAgeDays("marketplace", "2026-09-02")).toBeNull();
    expect(ticketAgeDays("2026-09-02-marketplace", "soon")).toBeNull();
  });
});
