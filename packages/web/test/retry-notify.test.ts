import { describe, expect, it } from "vitest";
import { collectWaitingReconnects, createRetryTracker } from "../src/features/chat/retry-notify";
import type { ObservedReconnect } from "../src/features/chat/retry-notify";
import type { ChatItem, ReconnectItem } from "../src/lib/omni/stream-model";

/** A reconnect item in the state the tracker cares about: waiting, not yet retried. */
const waiting = (itemId: number, attempt = 1, plannedDelayMs?: number): ObservedReconnect => ({
  itemId,
  attempt,
  ...(plannedDelayMs === undefined ? {} : { plannedDelayMs }),
});

describe("createRetryTracker", () => {
  it("never fires on the first observation of a Session", () => {
    const t = createRetryTracker();
    expect(t.observe("s", [waiting(1), waiting(2)], 0)).toBeNull();
    expect(t.observe("s", [waiting(1), waiting(2)], 1000)).toBeNull();
  });

  it("fires for a ladder that starts waiting after the baseline", () => {
    const t = createRetryTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [waiting(7, 1, 4_000)], 1000)).toEqual({
      sessionId: "s",
      attempt: 1,
      plannedDelayMs: 4_000,
    });
  });

  it("announces a ladder once, not once per attempt", () => {
    const t = createRetryTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [waiting(7, 1, 1_000)], 1000)).not.toBeNull();
    // The same item id comes back waiting for attempt 2 — the ladder climbing, not a new incident.
    expect(t.observe("s", [waiting(7, 2, 2_000)], 30_000)).toBeNull();
    expect(t.observe("s", [waiting(7, 3, 4_000)], 60_000)).toBeNull();
  });

  it("marks a ladder known even when no notification was shown: no replay later", () => {
    const t = createRetryTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [waiting(7)], 1000)).not.toBeNull();
    // The same ladder observed again (a re-render, a focus change) says nothing.
    expect(t.observe("s", [waiting(7)], 2000)).toBeNull();
    expect(t.observe("s", [waiting(7)], 60_000)).toBeNull();
  });

  it("reuses the cooldown to absorb a renumbered ladder", () => {
    const t = createRetryTracker(10_000);
    t.observe("s", [], 0);
    expect(t.observe("s", [waiting(7)], 1000)).not.toBeNull();
    // A resync rebuilds the view model and the same ladder comes back with a new item id.
    expect(t.observe("s", [waiting(99)], 2000)).toBeNull();
    // Past the cooldown a fresh ladder is announced again.
    expect(t.observe("s", [waiting(100)], 30_000)).toEqual({
      sessionId: "s",
      attempt: 1,
      plannedDelayMs: undefined,
    });
  });

  it("re-baselines on a Session switch instead of announcing its ladders", () => {
    const t = createRetryTracker();
    t.observe("a", [], 0);
    expect(t.observe("b", [waiting(1), waiting(2)], 1000)).toBeNull();
    expect(t.observe("b", [waiting(1), waiting(2), waiting(3)], 2000)).toEqual({
      sessionId: "b",
      attempt: 1,
      plannedDelayMs: undefined,
    });
  });

  it("forgets everything when no Session is open, so the next load baselines again", () => {
    const t = createRetryTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [waiting(7)], 1000)).not.toBeNull();
    expect(t.observe(null, [], 2000)).toBeNull();
    // Back to the same Session — a page load, not an incident.
    expect(t.observe("s", [waiting(7)], 3000)).toBeNull();
  });

  it("reset() drops the baseline (used while the transcript is loading)", () => {
    const t = createRetryTracker();
    t.observe("s", [waiting(7)], 0);
    t.reset();
    expect(t.observe("s", [waiting(7)], 1000)).toBeNull();
  });
});

describe("collectWaitingReconnects", () => {
  const reconnect = (
    id: number,
    state: { retrying?: boolean; gaveUp?: boolean } = {},
  ): ReconnectItem => ({
    kind: "reconnect",
    id,
    status: "retryable",
    attempt: 1,
    retrying: state.retrying ?? false,
    ...(state.gaveUp === undefined ? {} : { gaveUp: state.gaveUp }),
  });

  it("collects the ladders waiting for their next attempt", () => {
    expect(collectWaitingReconnects([reconnect(3), reconnect(4)])).toEqual([
      { itemId: 3, attempt: 1, plannedDelayMs: undefined },
      { itemId: 4, attempt: 1, plannedDelayMs: undefined },
    ]);
  });

  it("carries the announced wait and the attempt ordinal", () => {
    const item: ReconnectItem = { ...reconnect(3), attempt: 2, plannedDelayMs: 4_000 };
    expect(collectWaitingReconnects([item])).toEqual([
      { itemId: 3, attempt: 2, plannedDelayMs: 4_000 },
    ]);
  });

  it("skips a ladder whose next attempt has already been sent", () => {
    expect(collectWaitingReconnects([reconnect(3, { retrying: true })])).toEqual([]);
  });

  it("skips a ladder that exhausted itself (the run ends there, a completion)", () => {
    expect(collectWaitingReconnects([reconnect(3, { gaveUp: true })])).toEqual([]);
  });

  it("ignores items that are not reconnect rows", () => {
    const items = [
      { kind: "user_text", id: 1, text: "重试失败了吗？" },
      { kind: "assistant_text", id: 2, text: "第 1 次重试", streaming: false },
    ] as unknown as ChatItem[];
    expect(collectWaitingReconnects(items)).toEqual([]);
  });

  it("skips a retrying ladder so that its next wait is still announced", () => {
    // The race this guards: an item first seen after its attempt went out. Not collected means
    // not marked known, so the tracker announces the wait that follows instead of staying silent.
    const t = createRetryTracker();
    t.observe("s", collectWaitingReconnects([reconnect(3, { retrying: true })]), 0);
    expect(t.observe("s", collectWaitingReconnects([reconnect(3)]), 1000)).toEqual({
      sessionId: "s",
      attempt: 1,
      plannedDelayMs: undefined,
    });
  });
});
