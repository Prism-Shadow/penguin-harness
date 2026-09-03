/**
 * channel-stream.ts unit tests: day separators and sender runs, the unread divider at the read
 * cursor, day arithmetic for the separators and paging, and the immutable live append.
 */
import { describe, expect, it } from "vitest";
import type { OrgChannelMessage } from "@prismshadow/penguin-server/api";
import {
  appendMessage,
  buildStream,
  dayKind,
  earlierDay,
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
