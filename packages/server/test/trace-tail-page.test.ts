/**
 * Windowed history reads over a shard too large to read whole.
 *
 * The other windowed-read fixtures are small enough that a "bounded" tail read happens
 * to cover the whole file, so they cannot see the case this file exists for: a window
 * that genuinely stops mid-shard must still
 *   (a) hand back a `before` cursor, or the Web sets older.hasMore = false and
 *       everything above the window becomes unreachable with no error anywhere, and
 *   (b) number its units on the shard's own scale, or every tracePosition in the page
 *       names the wrong record and a fork cut at one of them rewinds to the file's
 *       start.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, sessionMeta, userText } from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core";
import { decodeCursor } from "../src/services/message-window.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-tail";
const A = "agent-tail";
const S = "session-2026-07-20-10-00-00-tail0001";

/** Comfortably past the 256KB first read window, so a bounded read cannot read it all. */
const TURNS = 900;

/** A page message carries the shard coordinate a fork would cut at. */
type Positioned = OmniMessage & { tracePosition?: { fileIndex: number; ordinal: number } };

/** The coordinates of a page, in order. */
const ordinalsOf = (msgs: readonly OmniMessage[]): number[] =>
  msgs.map((m) => (m as Positioned).tracePosition!.ordinal);

function metaPayload(): SessionMetaPayload {
  return {
    session_id: S,
    model_id: "m1",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
  };
}

describe("windowed reads over an oversized shard", () => {
  let root: string;
  let h: ReturnType<typeof makeTraceHarness>;
  let units: OmniMessage[];

  beforeEach(async () => {
    root = await makeTempRoot();
    const msgs: OmniMessage[] = [sessionMeta(metaPayload())];
    for (let i = 0; i < TURNS; i++) {
      // Padded so the shard clears the first window by a wide margin, keeping the ~800
      // bytes-a-line shape the real corpus has.
      msgs.push(userText(`u${i} ${"x".repeat(400)}`));
      msgs.push(assistantText(`a${i} ${"y".repeat(400)}`));
    }
    units = msgs;
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, units);
    h = makeTraceHarness(root);
  });

  afterEach(async () => {
    h.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("hands back a before cursor, so history older than the window stays reachable", async () => {
    const tail = await h.service.readMessagesPage(P, A, S, { kind: "tail", limit: 20 });
    expect(tail.messages.length).toBeGreaterThan(0);
    expect(tail.before).toBeDefined();

    // Paging back must move strictly older, cover the shard exactly once, and terminate
    // at the beginning. The ordinals are the contract: a page that repeated history or
    // skipped past it shows up here as an overlap or a gap, which is exactly the failure
    // a cursor-only assertion would sail past.
    let cursor: string | undefined = tail.before;
    let cursorOrdinal = ordinalsOf(tail.messages)[0]!;
    const covered = new Set<number>(ordinalsOf(tail.messages));
    let pages = 0;
    for (; cursor !== undefined && pages < 500; pages++) {
      const older = await h.service.readMessagesPage(P, A, S, {
        kind: "before",
        cursor: decodeCursor(cursor)!,
        limit: 200,
      });
      const ordinals = ordinalsOf(older.messages);
      expect(ordinals.length).toBeGreaterThan(0);
      // The page ends exactly where the cursor pointed: nothing repeated across the seam.
      expect(ordinals.at(-1)).toBe(cursorOrdinal - 1);
      for (const o of ordinals) {
        expect(covered.has(o)).toBe(false);
        covered.add(o);
      }
      cursorOrdinal = ordinals[0]!;
      cursor = older.before;
    }
    expect(cursor).toBeUndefined();
    expect(cursorOrdinal).toBe(0);
    // Every unit in the shard was served exactly once.
    expect(covered.size).toBe(units.length);
  });

  it("numbers a truncated window's units on the shard's scale, not from 0", async () => {
    const tail = await h.service.readMessagesPage(P, A, S, { kind: "tail", limit: 20 });
    const ordinals = ordinalsOf(tail.messages);
    expect(ordinals.length).toBeGreaterThan(0);
    // The newest unit of the shard is the last one; a window-local index would report
    // its ordinal as 0-based and every fork cut here would rewind to the file's start.
    expect(ordinals.at(-1)).toBe(units.length - 1);
    for (let i = 1; i < ordinals.length; i++) {
      expect(ordinals[i]!).toBeGreaterThan(ordinals[i - 1]!);
    }
  });

  it("reports the same tracePosition for a unit whether read by tail or in full", async () => {
    const full = await h.service.readMessages(P, A, S);
    const tail = await h.service.readMessagesPage(P, A, S, { kind: "tail", limit: 20 });
    const key = (m: OmniMessage): string =>
      `${m.timestamp}|${m.type}|${JSON.stringify(m.payload)}`;
    const fullLast = full.at(-1)!;
    const tailLast = tail.messages.at(-1)!;
    expect(key(tailLast)).toBe(key(fullLast));
    expect((tailLast as Positioned).tracePosition).toEqual(
      (fullLast as Positioned).tracePosition,
    );
  });
});
