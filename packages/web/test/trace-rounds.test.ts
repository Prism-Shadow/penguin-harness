/**
 * Which rounds the Trace panel draws and reads (features/traces/trace-rounds.ts). A long
 * Session's file is thousands of rounds and tens of megabytes; the panel stays fast only while
 * what it draws and what it reads are bounded by what the reader opened.
 *
 * - A 1200-round file draws its newest 50 round cards, oldest first; one "earlier" step draws
 *   the newest 100; a file shorter than a page draws all of it.
 * - Reading a round asks for its own index range only, in ceil(span / 1000) requests, and gets
 *   back exactly that range in file order; an empty round asks for nothing.
 * - A page answered short is followed from where it ended; a range that runs past the file's end
 *   or meets a page with no events stops instead of asking again; a cancelled read asks no more.
 * - Opening a file reads its newest round and nothing in any collapsed round.
 * - A refresh re-reads only the open rounds that grew; a collapsed round that grew is left
 *   alone until it is opened.
 * - A file opens on its newest round only; a refresh keeps the reader's choices, and a new round
 *   opens only when the reader was following the newest one.
 */
import { describe, expect, it } from "vitest";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { TraceEventsResponse } from "@prismshadow/penguin-server/api";
import {
  TRACE_EVENT_PAGE_SIZE,
  TRACE_ROUNDS_PAGE,
  expandedAfterAnalysis,
  loadRoundEvents,
  roundsToRead,
  staleRounds,
  visibleRounds,
} from "../src/features/traces/trace-rounds";
import type { RoundRange } from "../src/features/traces/trace-rounds";

/** One synthetic event, identified by its index in the file so a read's slice can be checked exactly. */
const event = (i: number): OmniMessage => ({
  timestamp: "2026-10-02T00:00:00.000Z",
  type: "model_msg",
  payload: { type: "text", role: "assistant", text: `m${i}` },
});

const textsOf = (events: readonly OmniMessage[]): string[] =>
  events.map((m) => (m.payload as { text: string }).text);

const indexes = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `m${from + i}`);

/** `n` consecutive rounds of `perRound` events each, round k covering [k·perRound, (k+1)·perRound − 1]. */
function roundsOf(n: number, perRound: number): RoundRange[] {
  return Array.from({ length: n }, (_, k) => ({
    taskIndex: k,
    messageFrom: k * perRound,
    messageTo: (k + 1) * perRound - 1,
  }));
}

/**
 * A fake events endpoint over a file of `size` events, recording every request. `serverLimit`
 * caps how many events a page comes back with; `total` is what pages report as the file's length.
 */
function fakeFile(size: number, opts: { serverLimit?: number; total?: number } = {}) {
  const calls: { offset: number; limit: number }[] = [];
  const fetchPage = (offset: number, limit: number): Promise<TraceEventsResponse> => {
    calls.push({ offset, limit });
    const capped = Math.min(limit, opts.serverLimit ?? limit);
    const events: OmniMessage[] = [];
    for (let i = offset; i < Math.min(offset + capped, size); i++) events.push(event(i));
    return Promise.resolve({ events, offset, limit: capped, total: opts.total ?? size });
  };
  return { calls, fetchPage };
}

describe("visibleRounds", () => {
  const file = roundsOf(1200, 11);

  it("a 1200-round file draws its newest 50 rounds, oldest first", () => {
    const drawn = visibleRounds(file, TRACE_ROUNDS_PAGE);
    expect(drawn).toHaveLength(50);
    expect(drawn.map((r) => r.taskIndex)).toEqual(Array.from({ length: 50 }, (_, i) => 1150 + i));
  });

  it("one earlier step draws the newest 100", () => {
    const drawn = visibleRounds(file, 2 * TRACE_ROUNDS_PAGE);
    expect(drawn).toHaveLength(100);
    expect(drawn[0]!.taskIndex).toBe(1100);
    expect(drawn[99]!.taskIndex).toBe(1199);
  });

  it("a file shorter than a page draws all of it, in round order whatever order it came in", () => {
    const shuffled = [...roundsOf(3, 4)].reverse();
    expect(visibleRounds(shuffled, TRACE_ROUNDS_PAGE).map((r) => r.taskIndex)).toEqual([0, 1, 2]);
  });
});

describe("loadRoundEvents", () => {
  it.each([1, 999, 1000, 1001, 2500])(
    "a round of %i events is read in ceil(span / 1000) requests, all inside its range",
    async (span) => {
      const range = { taskIndex: 7, messageFrom: 1300, messageTo: 1300 + span - 1 };
      const f = fakeFile(10_000);
      const events = await loadRoundEvents(f.fetchPage, range);

      expect(f.calls).toHaveLength(Math.ceil(span / TRACE_EVENT_PAGE_SIZE));
      for (const c of f.calls) {
        expect(c.limit).toBeLessThanOrEqual(TRACE_EVENT_PAGE_SIZE);
        expect(c.offset).toBeGreaterThanOrEqual(range.messageFrom);
        expect(c.offset + c.limit - 1).toBeLessThanOrEqual(range.messageTo);
      }
      // Exactly the round, in file order: nothing from the rounds on either side of it.
      expect(textsOf(events)).toEqual(indexes(range.messageFrom, range.messageTo));
    },
  );

  it("an empty round asks for nothing", async () => {
    const f = fakeFile(100);
    await expect(
      loadRoundEvents(f.fetchPage, { taskIndex: 0, messageFrom: -1, messageTo: -1 }),
    ).resolves.toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("a page answered short is followed from where it ended, leaving no hole", async () => {
    const f = fakeFile(1000, { serverLimit: 200 });
    const events = await loadRoundEvents(f.fetchPage, {
      taskIndex: 0,
      messageFrom: 100,
      messageTo: 549,
    });

    expect(f.calls.map((c) => c.offset)).toEqual([100, 300, 500]);
    expect(textsOf(events)).toEqual(indexes(100, 549));
  });

  it("a range running past the file's end stops at the end instead of asking again", async () => {
    // The analysis counted a record the events endpoint does not serve yet (mid-append).
    const f = fakeFile(1000);
    const events = await loadRoundEvents(f.fetchPage, {
      taskIndex: 0,
      messageFrom: 990,
      messageTo: 1004,
    });

    expect(f.calls).toHaveLength(1);
    expect(textsOf(events)).toEqual(indexes(990, 999));
  });

  it("a page with no events ends the read, however long the file claims to be", async () => {
    // Truncated under the reader: the total still says 3000, nothing comes back past 1000.
    const f = fakeFile(1000, { total: 3000 });
    const events = await loadRoundEvents(f.fetchPage, {
      taskIndex: 0,
      messageFrom: 1500,
      messageTo: 2600,
    });

    expect(f.calls).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("a read cancelled while a page is out asks for nothing more", async () => {
    const signal = { cancelled: false };
    const f = fakeFile(10_000);
    const read = loadRoundEvents(
      (offset, limit) => {
        // The view moved to another file while this page was in flight.
        signal.cancelled = true;
        return f.fetchPage(offset, limit);
      },
      { taskIndex: 0, messageFrom: 0, messageTo: 2999 },
      { signal },
    );

    await read;
    expect(f.calls).toHaveLength(1);
  });
});

describe("roundsToRead", () => {
  it("opening a 1200-round file reads its newest round and nothing in any collapsed round", async () => {
    const file = roundsOf(1200, 11);
    const expanded = expandedAfterAnalysis(null, file, new Set());
    const toRead = roundsToRead(file, TRACE_ROUNDS_PAGE, expanded, new Map());
    expect(toRead.map((r) => r.taskIndex)).toEqual([1199]);

    const f = fakeFile(1200 * 11);
    for (const round of toRead) await loadRoundEvents(f.fetchPage, round);
    // One request, inside the newest round: no collapsed round's events were asked for.
    expect(f.calls).toEqual([{ offset: 1199 * 11, limit: 11 }]);
  });

  it("an open round already read is not read again, and an open round not drawn is not read", () => {
    const file = roundsOf(200, 5);
    const cached = new Map<number, RoundRange>([[199, file[199]!]]);
    // Round 3 was opened, then 50 newer rounds pushed it out of the drawn window.
    const expanded = new Set([3, 199]);
    expect(roundsToRead(file, TRACE_ROUNDS_PAGE, expanded, cached)).toEqual([]);
    // Revealing it is what reads it.
    expect(roundsToRead(file, 200, expanded, cached).map((r) => r.taskIndex)).toEqual([3]);
  });
});

describe("staleRounds", () => {
  it("a refresh re-reads only the open rounds that grew", () => {
    const range = (taskIndex: number, messageFrom: number, messageTo: number): RoundRange => ({
      taskIndex,
      messageFrom,
      messageTo,
    });
    const cached = new Map<number, RoundRange>([
      [0, range(0, 0, 9)],
      [1, range(1, 10, 19)],
      [2, range(2, 20, 29)],
    ]);
    const fresh = [
      range(0, 0, 9),
      range(1, 10, 19),
      // The round that was running: it grew.
      range(2, 20, 41),
      // New since, never read: a first read, not a stale one.
      range(3, 42, 50),
    ];
    // Open and unchanged, open and grown, open and new: only the grown one is re-read.
    expect(staleRounds(cached, fresh, new Set([0, 2, 3]))).toEqual([2]);
    // The same growth on a collapsed round is left alone until the round is opened.
    expect(staleRounds(cached, fresh, new Set([0, 1, 3]))).toEqual([]);
  });
});

describe("expandedAfterAnalysis", () => {
  it("a file opens on its newest round only", () => {
    expect([...expandedAfterAnalysis(null, roundsOf(1200, 3), new Set())]).toEqual([1199]);
    // A file with no round yet opens nothing, and its first round opens when it appears.
    expect([...expandedAfterAnalysis(null, [], new Set())]).toEqual([]);
    expect([...expandedAfterAnalysis([], roundsOf(1, 3), new Set())]).toEqual([0]);
  });

  it("a refresh keeps what the reader opened and closed", () => {
    const before = roundsOf(5, 3);
    // The newest round (4) was closed by the reader and two older ones opened.
    expect([...expandedAfterAnalysis(before, roundsOf(5, 3), new Set([1, 2]))]).toEqual([1, 2]);
  });

  it("a new round opens when the reader was following the newest one, and stays closed otherwise", () => {
    const before = roundsOf(5, 3);
    const after = roundsOf(6, 3);
    expect([...expandedAfterAnalysis(before, after, new Set([4]))].sort()).toEqual([4, 5]);
    expect([...expandedAfterAnalysis(before, after, new Set([2]))]).toEqual([2]);
  });
});
