/**
 * The overview page's shaping (features/company/overview-summary.ts): the employee counts,
 * the board as a segmented bar, today's timeline with its marks, the spend against the
 * budget, the "for me" rows, the first-steps decision and the chat tail.
 */
import { describe, expect, it } from "vitest";
import type { OrgTicketItem } from "@prismshadow/penguin-server/api";
import {
  BOARD_SEGMENT_TONE,
  FIRST_STEPS,
  TIMELINE_TONE,
  boardSummary,
  chatTail,
  employeeCounts,
  firstSteps,
  pendingRows,
  spendSummary,
  todaySummary,
} from "../src/features/company/overview-summary";
import { TICKET_COLUMNS } from "../src/features/company/ticket-board";

const ticket = (ticketId: string, extra: Partial<OrgTicketItem> = {}): OrgTicketItem => ({
  ticketId,
  title: ticketId,
  status: "review",
  initiator: "user:alice",
  notify: [],
  priority: "P1",
  sessions: [],
  running: false,
  cost: 0,
  ...extra,
});

describe("employeeCounts", () => {
  it("counts desks, running and budget-paused employees", () => {
    expect(
      employeeCounts([
        { state: "running", desk: { sessionId: "s1", workspace: "/w", openedAt: "t" } },
        { state: "idle", desk: { sessionId: "s2", workspace: "/w", openedAt: "t" } },
        { state: "paused" },
        { state: "idle" },
      ]),
    ).toEqual({ total: 4, onDesk: 2, running: 1, paused: 1 });
  });

  it("is all zeros for no employees", () => {
    expect(employeeCounts([])).toEqual({ total: 0, onDesk: 0, running: 0, paused: 0 });
  });
});

describe("boardSummary", () => {
  it("lists every column in lifecycle order with its share of the whole board", () => {
    const b = boardSummary({ proposed: 1, in_progress: 2, review: 1, done: 4, rejected: 0 });
    expect(b.total).toBe(8);
    expect(b.open).toBe(4);
    expect(b.segments.map((s) => s.status)).toEqual([...TICKET_COLUMNS]);
    expect(b.segments.map((s) => s.count)).toEqual([1, 2, 1, 4, 0]);
    expect(b.segments.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1);
    expect(b.segments[4]?.share).toBe(0);
  });

  it("treats a missing column as zero and an empty board as no shares", () => {
    const b = boardSummary({});
    expect(b.total).toBe(0);
    expect(b.open).toBe(0);
    expect(b.segments.every((s) => s.count === 0 && s.share === 0)).toBe(true);
  });

  it("gives every column a fill tone", () => {
    for (const status of TICKET_COLUMNS) expect(BOARD_SEGMENT_TONE[status]).toBeTruthy();
  });
});

describe("todaySummary", () => {
  it("orders instances by time, marks unevaluated ones upcoming, and buckets the outcomes", () => {
    const t = todaySummary([
      { agentId: "a", name: "later", nextFireAt: "2026-09-02T15:00:00Z" },
      {
        agentId: "b",
        name: "fired",
        title: "Board review",
        lastFiredAt: "2026-09-02T08:00:00Z",
        nextFireAt: "2026-09-03T08:00:00Z",
        lastOutcome: "fired",
      },
      { agentId: "c", name: "missed", lastFiredAt: "2026-09-02T09:00:00Z", lastOutcome: "missed" },
      { agentId: "d", name: "errored", lastFiredAt: "2026-09-02T10:00:00Z", lastOutcome: "error" },
      { agentId: "e", name: "queued", lastFiredAt: "2026-09-02T11:00:00Z", lastOutcome: "queued" },
      { agentId: "f", name: "paused", lastFiredAt: "2026-09-02T12:00:00Z", lastOutcome: "paused" },
      { agentId: "g", name: "untimed" },
    ]);
    expect(t.total).toBe(7);
    expect(t.entries.map((e) => e.key)).toEqual([
      "b/fired",
      "c/missed",
      "d/errored",
      "e/queued",
      "f/paused",
      "a/later",
      "g/untimed",
    ]);
    expect(t.entries[0]).toMatchObject({ title: "Board review", mark: "fired" });
    expect(t.entries[5]).toMatchObject({ title: "later", mark: "upcoming" });
    expect(t.entries[6]).toMatchObject({ at: null, mark: "upcoming" });
    expect({
      fired: t.fired,
      queued: t.queued,
      failed: t.failed,
      paused: t.paused,
      upcoming: t.upcoming,
    }).toEqual({ fired: 1, queued: 1, failed: 2, paused: 1, upcoming: 2 });
  });

  it("prefers the last firing's time over the next one", () => {
    const t = todaySummary([
      {
        agentId: "a",
        name: "x",
        lastFiredAt: "2026-09-02T08:00:00Z",
        nextFireAt: "2026-09-03T08:00:00Z",
        lastOutcome: "fired",
      },
    ]);
    expect(t.entries[0]?.at).toBe(Date.parse("2026-09-02T08:00:00Z"));
  });

  it("gives every mark a tone, failures in danger", () => {
    expect(TIMELINE_TONE.missed).toBe("danger");
    expect(TIMELINE_TONE.error).toBe("danger");
    expect(TIMELINE_TONE.fired).toBe("success");
    expect(TIMELINE_TONE.upcoming).toBe("attention");
  });
});

describe("spendSummary", () => {
  it("derives the ratio and the remainder from a budget", () => {
    expect(spendSummary({ cost: 25, budget: 100 })).toEqual({
      cost: 25,
      budget: 100,
      ratio: 0.25,
      remaining: 75,
    });
  });

  it("keeps the server's ratio when it sends one and reports overspend as a negative remainder", () => {
    expect(spendSummary({ cost: 120, budget: 100, ratio: 1.2 })).toEqual({
      cost: 120,
      budget: 100,
      ratio: 1.2,
      remaining: -20,
    });
  });

  it("has no ratio or remainder without a budget", () => {
    expect(spendSummary({ cost: 3 })).toEqual({
      cost: 3,
      budget: null,
      ratio: null,
      remaining: null,
    });
    expect(spendSummary({ cost: 3, budget: 0 })).toEqual({
      cost: 3,
      budget: null,
      ratio: null,
      remaining: null,
    });
  });
});

describe("pendingRows", () => {
  it("lists mentions first, then review tickets, then tickets blocked on the user", () => {
    const rows = pendingRows({
      mentions: 2,
      reviewTickets: [ticket("r1")],
      blockedByMe: [
        ticket("b1", { status: "in_progress", blocked: "waiting", blockedBy: "user:alice" }),
      ],
    });
    expect(rows.map((r) => r.kind)).toEqual(["mentions", "review", "blocked"]);
    expect(rows[0]).toEqual({ kind: "mentions", count: 2 });
  });

  it("omits the mentions row when there are none", () => {
    expect(pendingRows({ mentions: 0, reviewTickets: [], blockedByMe: [] })).toEqual([]);
  });
});

describe("firstSteps", () => {
  it("is fresh while nobody but the CEO is employed and the board is empty", () => {
    const s = firstSteps({
      employeeCount: 1,
      boardTotal: 0,
      ceoDeskOpened: true,
      calendarCount: 0,
    });
    expect(s.fresh).toBe(true);
    expect(s.done).toEqual({ ceo: true, hire: false, schedule: false });
    expect(s.next).toBe("hire");
  });

  it("points at the CEO first when the desk was never opened", () => {
    const s = firstSteps({
      employeeCount: 1,
      boardTotal: 0,
      ceoDeskOpened: false,
      calendarCount: 0,
    });
    expect(s.next).toBe("ceo");
  });

  it("stops being fresh once someone is hired or a ticket is filed", () => {
    expect(
      firstSteps({ employeeCount: 2, boardTotal: 0, ceoDeskOpened: true, calendarCount: 0 }).fresh,
    ).toBe(false);
    expect(
      firstSteps({ employeeCount: 1, boardTotal: 1, ceoDeskOpened: true, calendarCount: 0 }).fresh,
    ).toBe(false);
  });

  it("has no next step once all three are done", () => {
    const s = firstSteps({
      employeeCount: 3,
      boardTotal: 0,
      ceoDeskOpened: true,
      calendarCount: 2,
    });
    expect(s.done).toEqual({ ceo: true, hire: true, schedule: true });
    expect(s.next).toBeNull();
    expect(FIRST_STEPS).toEqual(["ceo", "hire", "schedule"]);
  });
});

describe("chatTail", () => {
  it("returns the last n messages oldest first", () => {
    expect(chatTail([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(chatTail([1, 2], 5)).toEqual([1, 2]);
    expect(chatTail([1, 2], 0)).toEqual([]);
  });
});
