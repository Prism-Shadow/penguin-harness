/**
 * Chat toolbar cost chip: a per-session tracker that keeps the figure visible and monotone
 * while the session runs. Pure, no React — the chat page holds the mutable hold in a ref,
 * advances it once per render (idempotent per observation), and applies usage fetches to it
 * from the fetch effect; unit-tested in test/header-stats.test.ts.
 *
 * Why it exists: the naive `fetched sessionCost + open Task's live estimate` display blinked
 * out whenever both halves went empty at once — every goal-round boundary zeroes the live
 * buckets while the server keeps the session `running` (so an idle-gated refetch never ran),
 * a reload mid-run started with no fetched cost at all, and a refetch resolving in the idle
 * blip between queued follow-ups could return no row and clobber a known figure with null.
 *
 * Chosen semantics — the displayed figure is
 *
 *     sessionCost   (last applied fetch: absorbs everything recorded up to its resolve)
 *   + settledUsd    (live cost of Tasks finished SINCE that fetch, folded at each Task
 *                    boundary — goal rounds keep the running total instead of restarting)
 *   + max(0, open Task's live estimate − liveAtFetchUsd)
 *
 * where liveAtFetchUsd snapshots the open Task's live estimate at the moment a fetch applies:
 * the server prices usage rows in real time, so the fetched total already covers the running
 * Task's rows recorded so far, and only increments past the snapshot add on top — a mid-run
 * fetch reconciles the base without double-counting the running Task. A small transient skew
 * bounded by estimate-vs-server variance remains (the estimate applies the main Model's
 * pricing to all buckets); the next idle refetch settles it, exactly as it always has.
 *
 * Display rules on top of the sum:
 *   - once a figure was shown for a session it never disappears: when the computation has
 *     nothing (pricing transiently missing, model mid-rebuild) the last shown value holds;
 *   - while a Task is open the figure never goes down — a fetch reconciling below the live
 *     estimate holds the shown value until the sum passes it again; when idle the computed
 *     figure applies verbatim (the authoritative reconcile may adjust either way, as the
 *     idle refetch always has);
 *   - a brand-new session with no recorded cost and a still-zero estimate shows nothing
 *     (not $0.00), and a recorded zero-cost session still shows $0 — both unchanged;
 *   - everything resets only on session switch (advanceCostStat re-keys on sessionId).
 */
import { formatMoney } from "../../lib/format";

/** The two fields the tracker reads off a getUsage session row (structural subset of UsageGroupRow). */
export interface UsageCostRow {
  cost: number | null;
  hasUncosted: boolean;
}

/** Mutable tracker state, held in a ref by the chat page. All money fields are USD. */
export interface CostStatHold {
  sessionId: string | null;
  /** Task-start count last observed (taskStartCount over the stream items); an increase IS a Task boundary. */
  taskCount: number;
  /** Cost from the last applied usage fetch; null until one applies. Never reset to null mid-session. */
  sessionCost: number | null;
  /** Server-reported "some usage had no pricing" flag riding sessionCost (the chip's `*`). */
  costUncosted: boolean;
  /** Live cost of Tasks finished since the last applied fetch (client-settled base on top of sessionCost). */
  settledUsd: number;
  /** The open Task's latest observed live estimate — the fold source at the next boundary. */
  lastLiveUsd: number;
  /** Portion of the open Task's live estimate already absorbed by the last applied fetch. */
  liveAtFetchUsd: number;
  /** A fetch applied since the last observation: snapshot liveAtFetchUsd on the next one. */
  pendingFetchSnapshot: boolean;
  /** Last displayed value — the sticky fallback and the monotone floor while running. */
  shownUsd: number | null;
  /** The `*` flag shown alongside shownUsd (kept with it on the sticky path). */
  shownUncosted: boolean;
}

export function createCostStatHold(): CostStatHold {
  return {
    sessionId: null,
    taskCount: 0,
    sessionCost: null,
    costUncosted: false,
    settledUsd: 0,
    lastLiveUsd: 0,
    liveAtFetchUsd: 0,
    pendingFetchSnapshot: false,
    shownUsd: null,
    shownUncosted: false,
  };
}

/**
 * Applies one resolved getUsage row for `sessionId` (null = the response had no row for it).
 * A missing row or a null cost never clobbers a known figure — the server simply has nothing
 * (new) priced to report; only the `*` flag updates when a row exists. A priced cost replaces
 * the base and absorbs the settled Tasks (and, via the snapshot taken on the next observation,
 * the open Task's live-so-far). Ignores a resolve that raced a session switch.
 */
export function applyUsageFetch(
  hold: CostStatHold,
  sessionId: string,
  row: UsageCostRow | null,
): void {
  if (hold.sessionId !== sessionId) return;
  if (row === null) return;
  hold.costUncosted = row.hasUncosted;
  if (row.cost == null) return;
  hold.sessionCost = row.cost;
  hold.settledUsd = 0;
  hold.pendingFetchSnapshot = true;
}

/** One per-render observation of the selected session's stream. */
export interface CostStatObservation {
  sessionId: string | null;
  /** taskStartCount over the stream items (1:1 with the model's startTask calls). */
  taskCount: number;
  taskOpen: boolean;
  /** History (re)load in progress: the model emits placeholder values — display freezes, no folds. */
  loading: boolean;
  /** bucketCostUsd of the open Task's live buckets; null with no open Task or no pricing. */
  liveUsd: number | null;
  currency: "USD" | "CNY";
}

/** What the chip renders: null costText = nothing to show yet for this session. */
export interface CostStatDisplay {
  costText: string | null;
  costUncosted: boolean;
}

/** sessionCost + settled Tasks; null while neither has anything (chip hidden on a fresh session). */
function baseUsd(hold: CostStatHold): number | null {
  return hold.sessionCost != null || hold.settledUsd > 0
    ? (hold.sessionCost ?? 0) + hold.settledUsd
    : null;
}

/** Settles the display value into the hold and formats it. */
function show(hold: CostStatHold, usd: number | null, uncosted: boolean, currency: "USD" | "CNY") {
  if (usd != null) {
    hold.shownUsd = usd;
    hold.shownUncosted = uncosted;
  }
  return {
    costText: usd != null ? formatMoney(usd, currency) : null,
    costUncosted: uncosted,
  };
}

/**
 * Advances the hold with one observation and returns what the chip shows. Idempotent for a
 * repeated observation (safe under StrictMode double renders); the hold self-resets when the
 * observed sessionId changes, which is the ONLY reset.
 */
export function advanceCostStat(hold: CostStatHold, obs: CostStatObservation): CostStatDisplay {
  if (obs.sessionId !== hold.sessionId) {
    Object.assign(hold, createCostStatHold(), { sessionId: obs.sessionId });
  }
  if (obs.loading) {
    // A (re)loading model emits placeholder observations (empty items, closed task): fold and
    // snapshot decisions wait for the rebuilt model, and the display freezes on the last shown
    // value so a mid-run reload never blanks or dips the chip. Before anything was shown, a
    // fetch that resolved faster than history may already have a base worth showing.
    const usd = hold.shownUsd ?? baseUsd(hold);
    const uncosted = hold.shownUsd != null ? hold.shownUncosted : hold.costUncosted;
    return show(hold, usd, uncosted, obs.currency);
  }
  // Rebuild re-baseline: fewer Task starts than seen before means history was rewritten under
  // the same session (compaction resync). Live tracking restarts from the rebuilt model —
  // deliberately no fold: the replayed open Task's buckets already carry what lastLiveUsd held.
  if (obs.taskCount < hold.taskCount) {
    hold.taskCount = obs.taskCount;
    hold.lastLiveUsd = 0;
    hold.liveAtFetchUsd = 0;
  }
  // A fetch applied since the last observation: its total covers everything recorded up to its
  // resolve, so the open Task's live-so-far is absorbed — snapshot it as the subtrahend and
  // only count increments past this point. With pricing transiently missing (liveUsd null while
  // open) the snapshot waits: taking 0 now would double-count the Task once pricing arrives.
  if (hold.pendingFetchSnapshot && (!obs.taskOpen || obs.liveUsd != null)) {
    hold.pendingFetchSnapshot = false;
    const live = obs.taskOpen ? (obs.liveUsd ?? 0) : 0;
    hold.liveAtFetchUsd = live;
    hold.lastLiveUsd = live;
  }
  // Task boundary — a new Task started (goal rounds included) or the open one closed: fold the
  // finished Task's un-absorbed live remainder into the settled base, so the total carries
  // across the boundary instead of restarting from the zeroed buckets.
  if (
    obs.taskCount > hold.taskCount ||
    (!obs.taskOpen && (hold.lastLiveUsd > 0 || hold.liveAtFetchUsd > 0))
  ) {
    hold.settledUsd += Math.max(0, hold.lastLiveUsd - hold.liveAtFetchUsd);
    hold.lastLiveUsd = 0;
    hold.liveAtFetchUsd = 0;
  }
  hold.taskCount = obs.taskCount;
  if (obs.taskOpen && obs.liveUsd != null) hold.lastLiveUsd = obs.liveUsd;

  const base = baseUsd(hold);
  const liveAdd =
    obs.taskOpen && obs.liveUsd != null ? Math.max(0, obs.liveUsd - hold.liveAtFetchUsd) : null;
  // Same gate as the pre-tracker formula: a brand-new session (no base) with a still-zero live
  // estimate shows nothing rather than flashing a formatted $0.00 the moment the Task starts.
  const computed = liveAdd != null && (liveAdd > 0 || base != null) ? (base ?? 0) + liveAdd : base;
  let usd: number | null;
  if (computed == null) {
    usd = hold.shownUsd; // sticky: nothing computable must not hide an already-shown figure
  } else if (obs.taskOpen && hold.shownUsd != null && computed < hold.shownUsd) {
    usd = hold.shownUsd; // monotone while running: hold until the sum passes the shown value
  } else {
    usd = computed; // idle applies verbatim — the authoritative reconcile may adjust either way
  }
  const uncosted = computed == null ? hold.shownUncosted : hold.costUncosted;
  return show(hold, usd, uncosted, obs.currency);
}
