/**
 * The overview page's shaping (features/company/overview-summary.ts): the employee counts,
 * the board as a segmented bar, today's timeline with its marks, the spend against the
 * budget, the inbox rows with their order and filters, the first-steps decision and the
 * mission fold's guess.
 */
import { describe, expect, it } from "vitest";
import type { OrgChannelMessage, OrgInbox, OrgTicketItem } from "@prismshadow/penguin-server/api";
import {
  BOARD_SEGMENT_TONE,
  FIRST_STEPS,
  INBOX_ROWS,
  TIMELINE_TONE,
  boardSummary,
  employeeCounts,
  firstSteps,
  inboxCounts,
  inboxMatches,
  inboxRows,
  missionClampedGuess,
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

const ME = "user:alice";

const message = (
  id: string,
  time: string,
  extra: Partial<OrgChannelMessage> = {},
): OrgChannelMessage => ({
  id,
  time,
  sender: "agent:bob",
  hop: 0,
  text: id,
  mentions: [ME],
  ...extra,
});

/** The page's own naming is not what these tests are about: principals stand for themselves. */
const inbox = (source: Partial<OrgInbox> = {}) =>
  inboxRows({
    inbox: { mentions: [], blockedTickets: [], doneTickets: [], ...source },
    names: (principal) => principal,
  });

/** One row of each category, plus a done ticket whose id carries no date and that never got stamped closed. */
const mixed = () =>
  inbox({
    mentions: [
      message("m1", "2026-09-01T08:00:00Z", { text: "standup done" }),
      message("m2", "2026-09-07T09:00:00Z", { text: "  \n@alice ping\nsecond line" }),
    ],
    blockedTickets: [
      ticket("2026-09-06-blocked", {
        status: "in_progress",
        blocked: "waiting on legal",
        blockedBy: "agent:carol",
      }),
    ],
    doneTickets: [
      { ...ticket("2026-09-05-done", { status: "done", owner: "agent:carol" }) },
      { ...ticket("nodate", { status: "done" }) },
    ],
  });

describe("inboxRows", () => {
  it("orders by time descending and leaves an undated row last", () => {
    expect(mixed().map((r) => r.key)).toEqual([
      "mention/m2",
      "blocked/2026-09-06-blocked",
      "done/2026-09-05-done",
      "mention/m1",
      "done/nodate",
    ]);
  });

  it("ranks rows of the same instant by category: what names you, then what is stuck, then what landed", () => {
    const at = "2026-09-06T00:00:00.000Z";
    const rows = inbox({
      mentions: [message("m", at)],
      blockedTickets: [ticket("2026-09-06-b", { blocked: "waiting" })],
      doneTickets: [{ ...ticket("2026-09-06-d", { status: "done" }), closedAt: at }],
    });
    expect(rows.map((r) => r.category)).toEqual(["mention", "blocked", "done"]);
  });

  it("produces the three categories, each pointing at what it is about", () => {
    const rows = mixed();
    // A mention leads with its first line that carries anything, and names its sender.
    expect(rows.find((r) => r.key === "mention/m2")).toMatchObject({
      category: "mention",
      title: "@alice ping",
      detail: "agent:bob",
      tone: "attention",
      target: { kind: "channel", channelId: "default_channel" },
    });
    // A blocked ticket says why it is stuck, then who it waits on.
    expect(rows.find((r) => r.key === "blocked/2026-09-06-blocked")).toMatchObject({
      category: "blocked",
      title: "2026-09-06-blocked",
      detail: "waiting on legal · agent:carol",
      tone: "attention",
      target: { kind: "ticket", ticketId: "2026-09-06-blocked" },
    });
    // A done ticket asks nothing of the reader: its owner as the aside, and a muted mark.
    expect(rows.find((r) => r.key === "done/2026-09-05-done")).toMatchObject({
      category: "done",
      detail: "agent:carol",
      tone: "muted",
      target: { kind: "ticket", ticketId: "2026-09-05-done" },
    });
  });

  it("carries whichever half of a blocked ticket's aside was recorded, and none of neither", () => {
    const rows = inbox({
      blockedTickets: [
        ticket("2026-09-01-reason", { blocked: "waiting on legal" }),
        ticket("2026-09-02-who", { blocked: "  ", blockedBy: "agent:carol" }),
        ticket("2026-09-03-nothing"),
      ],
    });
    expect(rows.find((r) => r.key === "blocked/2026-09-01-reason")?.detail).toBe(
      "waiting on legal",
    );
    expect(rows.find((r) => r.key === "blocked/2026-09-02-who")?.detail).toBe("agent:carol");
    expect(rows.find((r) => r.key === "blocked/2026-09-03-nothing")?.detail).toBeUndefined();
  });

  it("dates a ticket by when it was closed, falling back to its id's day and then to nothing", () => {
    const rows = mixed();
    expect(rows.find((r) => r.key === "blocked/2026-09-06-blocked")?.time).toBe(
      "2026-09-06T00:00:00.000Z",
    );
    expect(rows.find((r) => r.key === "done/2026-09-05-done")?.time).toBe(
      "2026-09-05T00:00:00.000Z",
    );
    expect(rows.find((r) => r.key === "done/nodate")?.time).toBeNull();
    const closed = inbox({
      doneTickets: [
        { ...ticket("2026-09-05-done", { status: "done" }), closedAt: "2026-09-08T10:00:00Z" },
      ],
    });
    expect(closed[0]?.time).toBe("2026-09-08T10:00:00Z");
  });

  it("is empty for an inbox a server older than the field did not send", () => {
    expect(inboxRows({ inbox: undefined, names: (p) => p })).toEqual([]);
    expect(inbox()).toEqual([]);
  });

  it("keeps the newest rows when there are more than the cap", () => {
    const many = Array.from({ length: INBOX_ROWS + 20 }, (_, i) =>
      message(`m${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    const rows = inbox({ mentions: many });
    expect(rows).toHaveLength(INBOX_ROWS);
    expect(rows[0]?.key).toBe(`mention/m${INBOX_ROWS + 19}`);
  });
});

describe("inbox filters", () => {
  it("counts the rows each chip would show", () => {
    expect(inboxCounts(mixed())).toEqual({ all: 5, mention: 2, blocked: 1, done: 2 });
  });

  it("admits everything under all, and one category under each of the rest", () => {
    const rows = mixed();
    expect(rows.every((r) => inboxMatches(r, "all"))).toBe(true);
    expect(rows.filter((r) => inboxMatches(r, "done")).map((r) => r.key)).toEqual([
      "done/2026-09-05-done",
      "done/nodate",
    ]);
    expect(rows.filter((r) => inboxMatches(r, "blocked"))).toHaveLength(1);
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

describe("missionClampedGuess", () => {
  it("offers the fold for a mission with a line break or one longer than a line", () => {
    expect(missionClampedGuess("Ship the marketplace.")).toBe(false);
    expect(missionClampedGuess("Ship it.\nThen tell everyone.")).toBe(true);
    expect(missionClampedGuess("x".repeat(200))).toBe(true);
  });
});
