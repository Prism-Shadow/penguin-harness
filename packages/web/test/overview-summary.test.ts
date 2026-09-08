/**
 * The overview page's shaping (features/company/overview-summary.ts): the employee counts,
 * the board as a segmented bar, today's timeline with its marks, the spend against the
 * budget, the inbox rows with their order and filters, the first-steps decision and the
 * mission fold's guess.
 */
import { describe, expect, it } from "vitest";
import type { OrgChannelMessage, OrgTicketItem } from "@prismshadow/penguin-server/api";
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
import type { InboxInput } from "../src/features/company/overview-summary";
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
  mentions: [],
  ...extra,
});

/** The page's own naming is not what these tests are about: principals stand for themselves. */
const inbox = (input: Partial<InboxInput> = {}) =>
  inboxRows({
    pending: { mentions: 0, reviewTickets: [], blockedByMe: [] },
    recentMessages: [],
    me: ME,
    names: (principal) => principal,
    mentionsTitle: (n) => `${n} mentions`,
    ...input,
  });

/** One of each category: a mention count dated by the newest message that names the reader, a
 * ticket in review, a ticket blocked on the reader, two channel messages, and a ticket whose
 * id carries no date. */
const mixed = () =>
  inbox({
    pending: {
      mentions: 2,
      reviewTickets: [ticket("2026-09-05-review", { owner: "agent:carol" }), ticket("nodate")],
      blockedByMe: [
        ticket("2026-09-06-blocked", {
          status: "in_progress",
          blocked: "waiting on legal",
          blockedBy: ME,
        }),
      ],
    },
    recentMessages: [
      message("m1", "2026-09-01T08:00:00Z", { text: "standup done" }),
      message("m2", "2026-09-07T09:00:00Z", {
        text: "  \n@alice ping\nsecond line",
        mentions: [ME],
      }),
    ],
  });

describe("inboxRows", () => {
  it("orders by time descending, breaks a tie by category, and leaves an undated row last", () => {
    expect(mixed().map((r) => r.key)).toEqual([
      // The mention count borrows the newest message that names the reader, so it ties with
      // that message and the category order decides.
      "mention",
      "message/m2",
      "blocked/2026-09-06-blocked",
      "review/2026-09-05-review",
      "message/m1",
      "review/nodate",
    ]);
  });

  it("produces every category, each pointing at what it is about", () => {
    const rows = mixed();
    expect(new Set(rows.map((r) => r.category))).toEqual(
      new Set(["mention", "review", "blocked", "message"]),
    );
    expect(rows.find((r) => r.category === "mention")).toMatchObject({
      title: "2 mentions",
      target: { kind: "channel", channelId: "default_channel" },
    });
    expect(rows.find((r) => r.key === "review/2026-09-05-review")).toMatchObject({
      title: "2026-09-05-review",
      detail: "agent:carol",
      target: { kind: "ticket", ticketId: "2026-09-05-review" },
    });
    // `blockedBy` is the reader on every blocked row, so the reason is the aside that helps.
    expect(rows.find((r) => r.key === "blocked/2026-09-06-blocked")).toMatchObject({
      detail: "waiting on legal",
    });
    // A message leads with its first line that carries anything, and names its sender.
    expect(rows.find((r) => r.key === "message/m2")).toMatchObject({
      title: "@alice ping",
      detail: "agent:bob",
    });
  });

  it("dates a ticket by its id and leaves an id without one undated", () => {
    const rows = mixed();
    expect(rows.find((r) => r.key === "review/2026-09-05-review")?.time).toBe(
      "2026-09-05T00:00:00.000Z",
    );
    expect(rows.find((r) => r.key === "blocked/2026-09-06-blocked")?.time).toBe(
      "2026-09-06T00:00:00.000Z",
    );
    expect(rows.find((r) => r.key === "review/nodate")?.time).toBeNull();
  });

  it("marks a message that names the reader, or everyone, for attention and the rest muted", () => {
    const rows = inbox({
      recentMessages: [
        message("plain", "2026-09-01T08:00:00Z"),
        message("mine", "2026-09-01T09:00:00Z", { mentions: [ME] }),
        message("everyone", "2026-09-01T10:00:00Z", { mentions: ["all"] }),
      ],
    });
    expect(rows.map((r) => [r.key, r.tone])).toEqual([
      ["message/everyone", "attention"],
      ["message/mine", "attention"],
      ["message/plain", "muted"],
    ]);
  });

  it("omits the mentions row without mentions, and leaves it undated when nothing dates it", () => {
    expect(inbox({ recentMessages: [message("m1", "2026-09-01T08:00:00Z")] })).toHaveLength(1);
    const rows = inbox({
      pending: { mentions: 3, reviewTickets: [], blockedByMe: [] },
      recentMessages: [message("m1", "2026-09-01T08:00:00Z")],
    });
    expect(rows.find((r) => r.category === "mention")?.time).toBeNull();
  });

  it("keeps the newest rows when there are more than the cap", () => {
    const many = Array.from({ length: INBOX_ROWS + 20 }, (_, i) =>
      message(`m${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    const rows = inbox({ recentMessages: many });
    expect(rows).toHaveLength(INBOX_ROWS);
    expect(rows[0]?.key).toBe(`message/m${INBOX_ROWS + 19}`);
  });
});

describe("inbox filters", () => {
  it("counts the rows each chip would show, tickets covering both ticket categories", () => {
    expect(inboxCounts(mixed())).toEqual({ all: 6, mention: 1, ticket: 3, message: 2 });
  });

  it("admits everything under all, and the two ticket categories under tickets", () => {
    const rows = mixed();
    expect(rows.every((r) => inboxMatches(r, "all"))).toBe(true);
    expect(rows.filter((r) => inboxMatches(r, "ticket")).map((r) => r.category)).toEqual([
      "blocked",
      "review",
      "review",
    ]);
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
