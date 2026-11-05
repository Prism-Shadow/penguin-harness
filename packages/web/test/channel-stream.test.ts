/**
 * channel-stream.ts unit tests: day separators and sender runs, the unread divider at the read
 * cursor, which hop counts are worth a chip, which side of the stream a run stands on and
 * where each of its bubbles falls, day arithmetic for the separators and both paging
 * decisions — how far the opening load walks back and which day "earlier" fetches — when a
 * join made elsewhere has to be re-read, and the immutable live append.
 */
import { describe, expect, it } from "vitest";
import type { OrgChannelMessage } from "@prismshadow/penguin-server/api";
import {
  INITIAL_DAYS_MAX,
  INITIAL_MESSAGES,
  appendMessage,
  bubbleShape,
  buildStream,
  dayKind,
  earlierDay,
  hopChipShown,
  initialDaysToLoad,
  isOwnRun,
  joinedElsewhere,
  lastMessageId,
  messageCount,
  shiftDate,
} from "../src/features/company/channel-stream";

let seq = 0;
const msg = (sender: string, time: string, hop = 0): OrgChannelMessage => ({
  id: `msg-${time.slice(0, 19).replace(/[T:]/g, "-")}-${String(++seq).padStart(8, "0")}`,
  time,
  sender,
  hop,
  text: `${sender} at ${time}`,
  mentions: [],
});

describe("buildStream", () => {
  it("starts each day with a separator, folds one sender's close messages into a run, and keeps system lines apart", () => {
    const a1 = msg("user:alice", "2026-09-02T10:00:00Z");
    const a2 = msg("user:alice", "2026-09-02T10:03:00Z");
    const sys = msg("system", "2026-09-02T10:04:00Z");
    const a3 = msg("user:alice", "2026-09-02T10:05:00Z");
    const b1 = msg("agent:ceo", "2026-09-02T10:06:00Z", 1);
    const items = buildStream([
      { date: "2026-09-01", messages: [] },
      { date: "2026-09-02", messages: [a1, a2, sys, a3, b1] },
    ]);
    expect(items.map((i) => i.kind)).toEqual(["day", "day", "run", "system", "run", "run"]);
    expect(items[2]).toMatchObject({ sender: "user:alice", hop: 0, messages: [a1, a2] });
    expect(items[4]).toMatchObject({ sender: "user:alice", messages: [a3] });
    expect(items[5]).toMatchObject({ sender: "agent:ceo", hop: 1 });
  });

  it("breaks a run after the gap, and on a hop change", () => {
    const a1 = msg("user:alice", "2026-09-02T10:00:00Z");
    const a2 = msg("user:alice", "2026-09-02T10:06:00Z");
    const c1 = msg("agent:ceo", "2026-09-02T10:07:00Z", 1);
    const c2 = msg("agent:ceo", "2026-09-02T10:07:30Z", 2);
    const items = buildStream([{ date: "2026-09-02", messages: [a1, a2, c1, c2] }]);
    expect(items.map((i) => (i.kind === "run" ? i.messages.length : i.kind))).toEqual([
      "day",
      1,
      1,
      1,
      1,
    ]);
    // A wider gap joins them again.
    expect(
      buildStream([{ date: "2026-09-02", messages: [a1, a2] }], { gapMs: 10 * 60_000 }).length,
    ).toBe(2);
  });

  it("draws the unread divider before the first message after the cursor, splitting a run", () => {
    const a1 = msg("user:alice", "2026-09-02T10:00:00Z");
    const a2 = msg("user:alice", "2026-09-02T10:01:00Z");
    const a3 = msg("user:alice", "2026-09-02T10:02:00Z");
    const items = buildStream([{ date: "2026-09-02", messages: [a1, a2, a3] }], {
      unreadAfterId: a2.id,
    });
    expect(items.map((i) => i.kind)).toEqual(["day", "run", "unread", "run"]);
    expect(items[1]).toMatchObject({ messages: [a1, a2] });
    expect(items[3]).toMatchObject({ messages: [a3] });
  });

  it("draws no divider without a cursor, or when everything is read", () => {
    const a1 = msg("user:alice", "2026-09-02T10:00:00Z");
    const days = [{ date: "2026-09-02", messages: [a1] }];
    expect(buildStream(days).some((i) => i.kind === "unread")).toBe(false);
    expect(buildStream(days, { unreadAfterId: a1.id }).some((i) => i.kind === "unread")).toBe(
      false,
    );
  });
});

describe("shiftDate and dayKind", () => {
  it("moves whole days across month and year ends and names today and yesterday", () => {
    expect(shiftDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("nope", 1)).toBeNull();
    expect(dayKind("2026-09-02", "2026-09-02")).toBe("today");
    expect(dayKind("2026-09-01", "2026-09-02")).toBe("yesterday");
    expect(dayKind("2026-08-20", "2026-09-02")).toBe("other");
  });
});

describe("earlierDay", () => {
  it("picks the newest day older than the earliest loaded, from a newest-first list", () => {
    const days = ["2026-09-02", "2026-09-01", "2026-08-28"];
    expect(earlierDay(days, "2026-09-02")).toBe("2026-09-01");
    expect(earlierDay(days, "2026-09-01")).toBe("2026-08-28");
    expect(earlierDay(days, "2026-08-28")).toBeNull();
    // Today has no file yet: the list starts below it.
    expect(earlierDay(["2026-09-01"], "2026-09-02")).toBe("2026-09-01");
  });
});

describe("initialDaysToLoad", () => {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  /** A day file of `n` messages, all on that date. */
  const day = (date: string, n: number) => ({
    date,
    messages: Array.from({ length: n }, (_, i) => msg("user:alice", `${date}T10:${pad(i)}:00Z`)),
  });
  const days = ["2026-09-02", "2026-09-01", "2026-08-31", "2026-08-28"];

  it("steps back day by day while the opening load is short of messages", () => {
    expect(initialDaysToLoad(days, "2026-09-02", [day("2026-09-02", 2)], 5)).toBe("2026-09-01");
    expect(
      initialDaysToLoad(days, "2026-09-02", [day("2026-09-01", 2), day("2026-09-02", 2)], 5),
    ).toBe("2026-08-31");
  });

  it("stops as soon as the load holds what it wanted", () => {
    expect(initialDaysToLoad(days, "2026-09-02", [day("2026-09-02", 5)], 5)).toBeNull();
    expect(initialDaysToLoad(days, "2026-09-02", [day("2026-09-02", 9)], 5)).toBeNull();
  });

  it("walks past today's empty file rather than opening a quiet channel on a blank day", () => {
    // The whole point: today has no messages, so the first screen comes from earlier days.
    expect(initialDaysToLoad(days, "2026-09-02", [day("2026-09-02", 0)], 5)).toBe("2026-09-01");
  });

  it("stops at the start of history", () => {
    const loaded = [day("2026-08-28", 1), day("2026-09-02", 0)];
    expect(initialDaysToLoad(days, "2026-09-02", loaded, 30)).toBeNull();
    // A channel with no day file at all: nothing to walk back to.
    expect(initialDaysToLoad([], "2026-09-02", [day("2026-09-02", 0)], 30)).toBeNull();
  });

  it("spends at most its day budget, however little each day held", () => {
    const loaded = Array.from({ length: INITIAL_DAYS_MAX }, (_, i) =>
      day(`2026-09-${pad(i + 1)}`, 1),
    );
    const wide = [...loaded.map((d) => d.date)].reverse().concat("2026-08-28");
    expect(initialDaysToLoad(wide, "2026-09-07", loaded, INITIAL_MESSAGES)).toBeNull();
    // One day file short of the budget it still steps back.
    expect(initialDaysToLoad(wide, "2026-09-07", loaded.slice(0, -1), INITIAL_MESSAGES)).toBe(
      "2026-08-28",
    );
  });

  it("wants a full screen of messages by default", () => {
    expect(initialDaysToLoad(days, "2026-09-02", [day("2026-09-02", INITIAL_MESSAGES)])).toBeNull();
    expect(initialDaysToLoad(days, "2026-09-02", [day("2026-09-02", INITIAL_MESSAGES - 1)])).toBe(
      "2026-09-01",
    );
  });
});

describe("joinedElsewhere", () => {
  it("re-reads the detail the moment the listing says the reader joined", () => {
    expect(joinedElsewhere(false, true, false)).toBe(true);
  });

  it("stays quiet while the two sources have always disagreed", () => {
    // The server's own answer, not a join that just happened: re-reading it on every render
    // would be a refetch loop.
    expect(joinedElsewhere(true, true, false)).toBe(false);
    // Nothing is known about the previous listing yet (a channel just opened).
    expect(joinedElsewhere(null, true, false)).toBe(false);
  });

  it("stays quiet once the detail agrees, and when membership went the other way", () => {
    expect(joinedElsewhere(false, true, true)).toBe(false);
    expect(joinedElsewhere(true, false, true)).toBe(false);
    expect(joinedElsewhere(false, null, false)).toBe(false);
  });
});

describe("appendMessage, lastMessageId and messageCount", () => {
  it("appends to the day, creates a missing day at the end, and returns the same array for a repeat", () => {
    const a1 = msg("user:alice", "2026-09-02T10:00:00Z");
    const a2 = msg("user:alice", "2026-09-02T10:01:00Z");
    const days = [{ date: "2026-09-02", messages: [a1] }];
    const next = appendMessage(days, "2026-09-02", a2);
    expect(next).not.toBe(days);
    expect(next[0]?.messages).toEqual([a1, a2]);
    expect(appendMessage(next, "2026-09-02", a2)).toBe(next);
    const b1 = msg("agent:ceo", "2026-09-03T00:00:10Z");
    const rolled = appendMessage(next, "2026-09-03", b1);
    expect(rolled.map((d) => d.date)).toEqual(["2026-09-02", "2026-09-03"]);
    expect(lastMessageId(rolled)).toBe(b1.id);
    expect(messageCount(rolled)).toBe(3);
    expect(lastMessageId([{ date: "2026-09-02", messages: [] }])).toBeNull();
  });
});

describe("hopChipShown", () => {
  it("says nothing about the first hop and marks every chain from the second", () => {
    // Hop 0 is a person writing, hop 1 an employee answering a trigger: both ordinary.
    expect(hopChipShown(0)).toBe(false);
    expect(hopChipShown(1)).toBe(false);
    expect(hopChipShown(2)).toBe(true);
    expect(hopChipShown(5)).toBe(true);
  });
});

describe("isOwnRun", () => {
  it("claims the reader's own messages and nobody else's", () => {
    expect(isOwnRun("user:alice", "alice")).toBe(true);
    expect(isOwnRun("user:bob", "alice")).toBe(false);
    // An employee writes as an agent, never as the reader — even when the ids collide.
    expect(isOwnRun("agent:alice", "alice")).toBe(false);
    expect(isOwnRun("system", "alice")).toBe(false);
    expect(isOwnRun("all", "alice")).toBe(false);
  });

  it("owns nothing while the reader is unknown", () => {
    // "" is the id before the session has loaded: a malformed `user:` principal must not
    // start reading as the reader's own message.
    expect(isOwnRun("user:", "")).toBe(false);
    expect(isOwnRun("user:alice", "")).toBe(false);
  });
});

describe("bubbleShape", () => {
  const run = (sender: string, n: number) => ({
    sender,
    messages: Array.from({ length: n }, (_, i) => msg(sender, `2026-09-02T10:0${i}:00Z`)),
  });

  it("marks the first and the last bubble of a run, on the side that wrote it", () => {
    const others = run("agent:ceo", 3);
    expect(bubbleShape(others, 0, "alice")).toEqual({ own: false, first: true, last: false });
    expect(bubbleShape(others, 1, "alice")).toEqual({ own: false, first: false, last: false });
    expect(bubbleShape(others, 2, "alice")).toEqual({ own: false, first: false, last: true });
    const mine = run("user:alice", 2);
    expect(bubbleShape(mine, 0, "alice")).toEqual({ own: true, first: true, last: false });
    expect(bubbleShape(mine, 1, "alice")).toEqual({ own: true, first: false, last: true });
  });

  it("makes a run of one both its first and its last bubble", () => {
    // The lone bubble carries the name, the avatar and the squared corner all at once.
    expect(bubbleShape(run("user:bob", 1), 0, "alice")).toEqual({
      own: false,
      first: true,
      last: true,
    });
  });
});
