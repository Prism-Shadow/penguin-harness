/**
 * advanceCostStat / applyUsageFetch unit tests: the chat toolbar's cost chip must never
 * disappear (or visibly dip and recover) for a session once shown — across Task boundaries
 * (goal rounds zero the live buckets while the server stays `running`), across refetches
 * that return no row (the idle blip between queued follow-ups), and across transient
 * pricing/model gaps — while a mid-run fetch reconciles the base without double-counting
 * the running Task (live-at-fetch snapshot). Semantics documented in
 * src/features/chat/header-stats.ts; the chat page feeds one observation per render.
 */
import { describe, expect, it } from "vitest";
import {
  advanceCostStat,
  applyUsageFetch,
  createCostStatHold,
} from "../src/features/chat/header-stats";
import type { CostStatObservation } from "../src/features/chat/header-stats";

const obs = (over: Partial<CostStatObservation> = {}): CostStatObservation => ({
  sessionId: "s1",
  taskCount: 1,
  taskOpen: false,
  loading: false,
  liveUsd: null,
  currency: "USD",
  ...over,
});

describe("advanceCostStat (chat header cost chip)", () => {
  it("keeps the running total across a goal-round boundary (buckets zeroed, no session cost yet)", () => {
    const hold = createCostStatHold();
    // Round 1 accrues live cost on a fresh session (nothing fetched — the goal keeps it running).
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.3 })).costText).toBe("$0.3000");
    // Round boundary: the [goal round] user text starts a new Task in the same batch — the
    // client sees taskCount+1 with the live buckets already reset to zero.
    expect(advanceCostStat(hold, obs({ taskCount: 2, taskOpen: true, liveUsd: 0 })).costText).toBe(
      "$0.3000",
    );
    // The next round's usage adds on top of the settled rounds instead of restarting from zero.
    expect(
      advanceCostStat(hold, obs({ taskCount: 2, taskOpen: true, liveUsd: 0.05 })).costText,
    ).toBe("$0.3500");
    // A plain close (taskOpen true→false, buckets zeroed by endTask) keeps it too.
    expect(advanceCostStat(hold, obs({ taskCount: 2 })).costText).toBe("$0.3500");
    // And the Task after that starts from the settled total, not from its own zero.
    expect(advanceCostStat(hold, obs({ taskCount: 3, taskOpen: true, liveUsd: 0 })).costText).toBe(
      "$0.3500",
    );
  });

  it("a refetch returning no row (or a null cost) never clobbers a known figure", () => {
    const hold = createCostStatHold();
    advanceCostStat(hold, obs());
    applyUsageFetch(hold, "s1", { cost: 0.5, hasUncosted: false });
    expect(advanceCostStat(hold, obs()).costText).toBe("$0.5000");
    // Idle blip between queued follow-ups: the refetch resolves with no row for the session.
    applyUsageFetch(hold, "s1", null);
    expect(advanceCostStat(hold, obs()).costText).toBe("$0.5000");
    // An all-uncosted row (cost null) keeps the figure as well; only the * flag updates.
    applyUsageFetch(hold, "s1", { cost: null, hasUncosted: true });
    const shown = advanceCostStat(hold, obs());
    expect(shown.costText).toBe("$0.5000");
    expect(shown.costUncosted).toBe(true);
  });

  it("preserves the * uncosted marker across boundaries and sticky fallbacks", () => {
    const hold = createCostStatHold();
    advanceCostStat(hold, obs());
    applyUsageFetch(hold, "s1", { cost: 0.5, hasUncosted: true });
    expect(advanceCostStat(hold, obs())).toEqual({ costText: "$0.5000", costUncosted: true });
    // A new Task with pricing missing (liveUsd null): the figure persists with its flag.
    expect(advanceCostStat(hold, obs({ taskCount: 2, taskOpen: true }))).toEqual({
      costText: "$0.5000",
      costUncosted: true,
    });
  });

  it("a recorded zero-cost session still shows $0; a fresh zero estimate still shows nothing", () => {
    const hold = createCostStatHold();
    // Brand-new session, Task just started, no usage yet: no flashed $0.00 (unchanged behavior).
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0 })).costText).toBeNull();
    applyUsageFetch(hold, "s1", { cost: 0, hasUncosted: false });
    expect(advanceCostStat(hold, obs()).costText).toBe("$0");
  });

  it("losing pricing mid-run falls back to the last shown value instead of hiding", () => {
    const hold = createCostStatHold();
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.3 })).costText).toBe("$0.3000");
    // The models response is transiently gone (bucketCostUsd returns null without pricing).
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: null })).costText).toBe("$0.3000");
    // Pricing returns: the live estimate resumes from the real buckets.
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.4 })).costText).toBe("$0.4000");
  });

  it("a mid-run fetch absorbs the Task's live-so-far: reconciled base plus increments only", () => {
    const hold = createCostStatHold();
    // Reload during an active run: history replays 0.4 of live cost, then the initial fetch
    // resolves with the server total (which already includes those rows).
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.4 })).costText).toBe("$0.4000");
    applyUsageFetch(hold, "s1", { cost: 1.0, hasUncosted: false });
    // Not $1.40 — the snapshot subtracts the absorbed live-so-far.
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.4 })).costText).toBe("$1.00");
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.5 })).costText).toBe("$1.10");
    // At the boundary only the un-absorbed remainder folds into the settled base.
    expect(advanceCostStat(hold, obs({ taskCount: 2, taskOpen: true, liveUsd: 0 })).costText).toBe(
      "$1.10",
    );
  });

  it("never dips while running, even when a fetch reconciles below the live estimate", () => {
    const hold = createCostStatHold();
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.4 })).costText).toBe("$0.4000");
    // Server-priced total is lower than the client estimate (subagents on cheaper models).
    applyUsageFetch(hold, "s1", { cost: 0.3, hasUncosted: false });
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.4 })).costText).toBe("$0.4000");
    // Once idle, the authoritative figure applies verbatim (may adjust downward, as the idle
    // refetch always has) and stays.
    expect(advanceCostStat(hold, obs()).costText).toBe("$0.3000");
  });

  it("freezes on the shown value during a history (re)load and resumes cleanly after", () => {
    const hold = createCostStatHold();
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.4 })).costText).toBe("$0.4000");
    // Mid-run reconnect rebuild: the loading model reports an empty, closed placeholder.
    expect(advanceCostStat(hold, obs({ taskCount: 0, loading: true })).costText).toBe("$0.4000");
    // The rebuilt model replays the same open Task; no fold happened, so nothing double-counts.
    expect(advanceCostStat(hold, obs({ taskOpen: true, liveUsd: 0.45 })).costText).toBe("$0.4500");
  });

  it("resets only on session switch", () => {
    const hold = createCostStatHold();
    advanceCostStat(hold, obs());
    applyUsageFetch(hold, "s1", { cost: 0.5, hasUncosted: false });
    expect(advanceCostStat(hold, obs()).costText).toBe("$0.5000");
    expect(advanceCostStat(hold, obs({ sessionId: "s2" })).costText).toBeNull();
    // A stale resolve for the previous session is ignored after the switch.
    applyUsageFetch(hold, "s1", { cost: 9, hasUncosted: false });
    expect(advanceCostStat(hold, obs({ sessionId: "s2" })).costText).toBeNull();
  });
});
