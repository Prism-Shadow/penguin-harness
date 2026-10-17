/**
 * Usage statistics query.
 *
 * Cost is **computed in real time**: usage_records only stores Tokens (pricing may
 * be added later), so at query time each Model's cost is converted using the
 * current Project's configured pricing — the repo returns raw Token totals broken
 * down by `(provider, model_id)` paired reference, and this service looks up each
 * reference's price once and folds it into cost / hasUncosted (if a Model has no
 * pricing, its consumption is excluded from cost and hasUncosted is flagged).
 * Summary cards (today / last 7 days / cumulative), grouped aggregation (date /
 * agent / model / session, with the session dimension supporting agentId drill-down
 * filtering), and the zero-filled time series the cost center's charts draw.
 * Server-side error statistics (error_records) ride along on the same response:
 * the statistics center fetches everything in one request, and filters are
 * naturally shared; unattributed errors (login failures, process crashes, and other
 * errors with no Project context) are visible only to admins, see the ErrorsRepo
 * file header.
 */
import type {
  CostParts,
  UsageAgentSeries,
  UsageBucket,
  UsageErrors,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupBy,
  UsageGroupRow,
  UsageModelSeries,
  UsageModelTotals,
  UsageResponse,
  UsageSeriesPoint,
} from "../api/types.js";
import type { ErrorFilter } from "../db/repos/errors.js";
import {
  catalogEntryFor,
  offPeakAt,
  offPeakScheduledRefs,
} from "@prismshadow/penguin-core/model-catalog";
import type {
  UsageModelSums,
  UsageGroupModelSums,
  UsageSeriesModelSums,
  UsageAgentBucketCount,
  UsageFilter,
  PeakTier,
} from "../db/repos/usage.js";
import {
  enumerateBuckets,
  enumerateTsBuckets,
  formatLocalDate,
  localDateMinusDays,
} from "../internal/dates.js";
import { badRequest } from "../http/validate.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Clock } from "../hmr/capabilities.js";
import type { ErrorLog, UsageQueries, UsageStore } from "../mechanisms/observability.js";
import type { ProjectConfigStore } from "../mechanisms/projects.js";

/**
 * Number of most-recent rows kept in the error detail table. Also the page size the whole
 * feature runs on, but nothing needs to hard-code it: `errors.recent` is exactly this many rows
 * whenever a second page exists, so the client derives its page size from the response instead
 * of holding a constant that could drift out of step with this one.
 */
const ERROR_RECENT_N = 10;

/** The three pricing buckets (usd_per_mtok convention), returned by the pricing lookup callback. */
export interface PricingRates {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/**
 * What one Model costs, in the tiers it can be billed in.
 *
 * `offPeak` differs from `peak` only for a catalog row on a time-based schedule whose stored
 * price is still the catalog's own. Both are returned together because a query spans time: a
 * week that straddles the boundary contains Tokens of both kinds, and each half is priced at
 * the rate it actually ran at rather than at whichever tier is in force when it is read.
 */
export interface TieredRates {
  peak: PricingRates;
  offPeak: PricingRates;
}

export type PricingLookup = (
  projectId: string,
  provider: string,
  modelId: string,
) => Promise<TieredRates | undefined>;

export interface UsageQuery {
  from?: string;
  to?: string;
  groupBy: UsageGroupBy;
  /** Top-level filter: view by Agent (also used for groupBy=session drill-down). */
  agentId?: string;
  /** Top-level filter: view by Model (paired with modelId; the dropdown always sends them as a pair). */
  provider?: string;
  modelId?: string;
  /** Whether to include unattributed errors: admin only (the route passes user.isAdmin), defaults to false. */
  includeGlobalErrors?: boolean;
  /** Time-series precision for `series` / `byAgentSeries` / `byModelSeries`; defaults to day. The route validates the value; the bucket count is capped here. */
  granularity?: UsageGranularity;
  /**
   * Timestamp window bounds (ISO UTC), for the trailing "last hour" / "last 24
   * hours" ranges whose edges are instants rather than calendar dates: they
   * refine every range-scoped aggregate down to the window, and minute/hour
   * series buckets are enumerated between them. `minute` requires them.
   */
  fromTs?: string;
  toTs?: string;
  /**
   * The viewer's offset east of UTC, in minutes: the calendar day the error table folds a
   * day's repeats by (see ErrorsRepo.recent). Nothing else in the response reads it; absent,
   * the day is the server's own.
   */
  utcOffsetMinutes?: number;
  /**
   * Cap on the number of GROUPS returned, applied to the most recent ones. Only meaningful for a
   * grouping with an inherent order — `session` and `agent` do (their key is the id), `date` does
   * (its key is the day), `model` and `squad` do not. Omitted = every group, which is what the
   * export and the cost page expect.
   *
   * Why it exists: `groupBy=session` over a long-lived Project returns one row per Session that
   * ever ran — thousands here — while a list view renders the newest handful. The cost is in the
   * aggregation itself, so capping what the caller will actually read is worth far more than
   * trimming the response body afterwards.
   */
  groupLimit?: number;
}

/**
 * Orders grouped rows "most recent first" for `UsageQuery.groupLimit`, for the dimensions where
 * that is well defined:
 *
 *   - `session`: the id embeds its creation timestamp (`session-YYYY-mm-dd-HH-MM-SS-hash`), so a
 *     string comparison IS chronological order — no date column needed.
 *   - `date`: the key is the day itself, so string order is chronological.
 *   - `agent`: the id is opaque; sorted by id for a stable, reproducible page.
 *
 * `model` and `squad` are left alone — neither has an order the server could vouch for, so the
 * route refuses a limit there rather than return an arbitrary subset (see the route's check).
 */
function orderForLimit(groupBy: UsageGroupBy, rows: UsageGroupModelSums[]): UsageGroupModelSums[] {
  if (groupBy === "session" || groupBy === "date" || groupBy === "agent") {
    return [...rows].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  }
  return rows;
}

/**
 * Everything one `query()` reads out of the store, before any pricing. Split out from the
 * response so the row cache can hold exactly this: these rows are the expensive, slow-moving half
 * of the route, while the priced response is cheap to rebuild and must never be stale.
 */
interface AggregatedRows {
  todayRows: UsageModelSums[];
  last7dRows: UsageModelSums[];
  totalRows: UsageModelSums[];
  /** Grouped by the requested dimension, before `groupLimit` trims it. */
  groupRows: UsageGroupModelSums[];
  seriesRows: UsageSeriesModelSums[];
  agentBucketRows: UsageAgentBucketCount[];
  modelBucketRows: UsageSeriesModelSums[];
  /** The zero-filled bucket keys the series is drawn over (a property of the range, not of the data). */
  bucketKeys: string[];
  granularity: UsageGranularity;
  /** The error-table filter the response's `errors` is folded from. */
  errorFilter: ErrorFilter;
}

/** One page of the error detail table (see {@link UsageService.queryErrors}). */
export interface UsageErrorsQuery {
  offset: number;
  limit: number;
  from?: string;
  to?: string;
  /** The trailing window narrowing those dates (see {@link UsageQuery}); both or neither. */
  fromTs?: string;
  toTs?: string;
  agentId?: string;
  /** Narrow to one category — `unexpected` (500s / runtime exceptions) or `expected`; absent counts both. */
  kind?: string;
  /** Admin only: include errors with no Project attribution (see the ErrorsRepo file header). */
  includeGlobalErrors?: boolean;
  /** The viewer's offset east of UTC, in minutes (see {@link UsageQuery}). */
  utcOffsetMinutes?: number;
}

/**
 * What a clear removes (see {@link UsageService.clearErrors}): the panel's own range — dates,
 * and the trailing window when one is on — and Agent, read with the same admin visibility the
 * panel has. No `kind`: the panel offers no such control, so a clear has no narrowing the
 * reader could have seen.
 */
export interface UsageErrorsClearQuery {
  from?: string;
  to?: string;
  fromTs?: string;
  toTs?: string;
  agentId?: string;
  /** Admin only, the value the caller's reads carry: an admin's clear takes the unattributed rows an admin's panel shows. */
  includeGlobalErrors?: boolean;
}

/** The "model price" formula: the three buckets at the given rates (USD per million Tokens), in USD. */
export function requestCostUsd(
  counts: { cacheRead: number; cacheWrite: number; output: number },
  rates: PricingRates,
): number {
  return (
    (counts.cacheRead * rates.cacheRead +
      counts.cacheWrite * rates.cacheWrite +
      counts.output * rates.output) /
    1e6
  );
}

/** A cost split with nothing in any bucket: where a running sum of splits starts. */
export const ZERO_COST_PARTS: CostParts = { cacheRead: 0, cacheWrite: 0, output: 0 };

/**
 * {@link requestCostUsd} kept bucket by bucket: each bucket's Tokens at its own rate, in USD.
 * Given the rates a cost was priced at, the parts add up to that cost.
 */
export function requestCostParts(
  counts: { cacheRead: number; cacheWrite: number; output: number },
  rates: PricingRates,
): CostParts {
  return {
    cacheRead: (counts.cacheRead * rates.cacheRead) / 1e6,
    cacheWrite: (counts.cacheWrite * rates.cacheWrite) / 1e6,
    output: (counts.output * rates.output) / 1e6,
  };
}

/** Two cost splits added bucket by bucket. */
export function sumCostParts(a: CostParts, b: CostParts): CostParts {
  return {
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/**
 * The rates one usage record is billed at, decided from the record's own timestamp: the
 * off-peak tier when the reference carries a catalog schedule and `at` falls outside its peak
 * windows, the peak tier otherwise. For a reference with no schedule, or whose stored price is
 * no longer the catalog's, the two tiers are the same figure (see project-config-service's
 * `tieredRates`), so the decision changes nothing there. `peakExpr` in the usage repo is this
 * rule written in SQL for the aggregations; the two must agree record for record, which is why
 * an unreadable timestamp — which the repo never stores — takes the peak tier rather than
 * inventing a discount.
 */
export function ratesAt(
  tiered: TieredRates,
  provider: string,
  modelId: string,
  at: Date,
): PricingRates {
  const schedule = catalogEntryFor(provider, modelId)?.offPeakDiscount;
  if (schedule === undefined || Number.isNaN(at.getTime())) return tiered.peak;
  return offPeakAt(schedule, at) ? tiered.offPeak : tiered.peak;
}

/** Cost formula: sum of the three buckets at the tier these Tokens ran in, USD per million. */
function costOf(sums: UsageModelSums, tiered: TieredRates): number {
  return requestCostUsd(sums, sums.peak ? tiered.peak : tiered.offPeak);
}

/** {@link costOf} split by bucket, at the same tier. */
function costPartsOf(sums: UsageModelSums, tiered: TieredRates): CostParts {
  return requestCostParts(sums, sums.peak ? tiered.peak : tiered.offPeak);
}

/** In-process Map key for a paired reference (\0-separated, the same style as session-manager's agentKey; never persisted). */
function refKey(provider: string, modelId: string): string {
  return `${provider}\0${modelId}`;
}

@Component()
export class UsageService implements UsageQueries {
  @Use() private readonly usage!: UsageStore;
  @Use() private readonly errors!: ErrorLog;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly clock!: Clock;
  private lookupPricing: PricingLookup = (projectId, provider, modelId) =>
    this.projectConfig.getPricing(projectId, provider, modelId);

  /**
   * Short-lived cache of the AGGREGATION ROWS, keyed by the Project + every parameter that
   * selects rows.
   *
   * Why rows and not the finished response: the rows are the expensive half — ~1s of SQL against
   * the observed 161k-row table — while pricing and folding them is cheap. Caching the rows
   * therefore keeps the whole win and removes the staleness question entirely: a price is looked
   * up fresh on every read, so an edit (or a promotion landing, or a preset sync) shows up on the
   * very next query instead of waiting out a TTL. Only the token sums can be briefly behind, and
   * that is exactly what {@link invalidate} on record exists to end.
   *
   * The rows change only when a token_usage lands, and the cost center, the sidebar and the chat
   * header all ask for the same window — the observed traffic was ~50 calls in three minutes,
   * nearly all with identical parameters.
   */
  private readonly cache = new Map<string, { projectId: string; at: number; rows: AggregatedRows }>();
  /** How long a set of aggregated rows is reused. Short enough that a figure is never meaningfully stale. */
  private static readonly CACHE_TTL_MS = 15_000;
  /** Upper bound on cached row-sets — the parameter space is small, but a long-lived process should not grow this without limit. */
  private static readonly CACHE_MAX = 64;

  /**
   * The catalog's time-based schedules, as the aggregations want them.
   *
   * Split by the SCHEDULE, not by whether this Project is on the catalog's price: a Project
   * that edited the price gets one rate for both halves from {@link lookupPricing}, so the extra
   * dimension costs a row and changes no number. Doing it the other way round would need the
   * config read before the query that discovers which references occur.
   */
  private tiers(): PeakTier[] {
    return offPeakScheduledRefs().map(({ schedule, refs }) => ({
      refs,
      utcOffsetMinutes: schedule.utcOffsetMinutes,
      peakDays: schedule.peakDays,
      peakHours: schedule.peakHours,
    }));
  }

  /**
   * Period cost per session, for company mode's attribution by the sessions an organization
   * owns: sums by paired reference priced at the current rates (each half at the tier its own
   * records ran in). `unpriced` says some usage ran on a model without pricing, so the numbers
   * are a lower bound.
   */
  async costBySession(
    projectId: string,
    sessionIds: readonly string[],
    fromTs: string,
    toTs: string,
  ): Promise<{ bySession: Map<string, number>; unpriced: boolean }> {
    const bySession = new Map<string, number>();
    if (sessionIds.length === 0) return { bySession, unpriced: false };
    const rows = this.usage.groupsByModel(
      projectId,
      "session",
      { sessionIds, fromTs, toTs },
      this.tiers(),
    );
    const rates = new Map<string, TieredRates | undefined>();
    let unpriced = false;
    for (const r of rows) {
      const key = refKey(r.provider, r.modelId);
      if (!rates.has(key)) {
        rates.set(key, await this.lookupPricing(projectId, r.provider, r.modelId));
      }
      const rate = rates.get(key);
      if (!rate) {
        unpriced = true;
        continue;
      }
      bySession.set(r.key, (bySession.get(r.key) ?? 0) + costOf(r, rate));
    }
    return { bySession, unpriced };
  }

  /** Daily cost of a set of sessions over a window (the organization finance trend). */
  async dailyCostForSessions(
    projectId: string,
    sessionIds: readonly string[],
    fromTs: string,
    toTs: string,
  ): Promise<Array<{ date: string; cost: number }>> {
    if (sessionIds.length === 0) return [];
    const rows = this.usage.seriesByModel(
      projectId,
      "day",
      { sessionIds, fromTs, toTs },
      this.tiers(),
    );
    const rates = new Map<string, TieredRates | undefined>();
    const byDate = new Map<string, number>();
    for (const r of rows) {
      const key = refKey(r.provider, r.modelId);
      if (!rates.has(key)) {
        rates.set(key, await this.lookupPricing(projectId, r.provider, r.modelId));
      }
      const rate = rates.get(key);
      if (!rate) continue;
      byDate.set(r.key, (byDate.get(r.key) ?? 0) + costOf(r, rate));
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }));
  }

  async query(projectId: string, q: UsageQuery): Promise<UsageResponse> {
    const cacheKey = this.cacheKey(projectId, q);
    const nowMs = Date.now();
    const hit = this.cache.get(cacheKey);
    // Rows from the last few seconds are reused; everything after them — pricing, folding, the
    // response shape — is rebuilt on every read, so nothing but the token sums can be stale.
    const rows =
      hit !== undefined && nowMs - hit.at < UsageService.CACHE_TTL_MS
        ? hit.rows
        : await this.aggregateRows(projectId, q, nowMs, cacheKey);
    return await this.buildResponse(projectId, q, rows);
  }

  /**
   * The cache key: the Project plus every parameter that can change a figure. Built from the
   * resolved fields rather than the raw object, so an absent filter and an `undefined` one are
   * the same entry.
   */
  private cacheKey(projectId: string, q: UsageQuery): string {
    return JSON.stringify([
      projectId,
      q.groupBy ?? "date",
      q.granularity ?? "day",
      q.agentId ?? null,
      q.provider ?? null,
      q.modelId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.fromTs ?? null,
      q.toTs ?? null,
      q.utcOffsetMinutes ?? null,
      q.includeGlobalErrors ?? false,
      q.groupLimit ?? null,
    ]);
  }

  /**
   * Drops every cached answer for one Project (or all of them). Called when usage is recorded, so
   * a figure on screen is never held for the full TTL after new tokens have actually landed.
   *
   * Entries carry their `projectId` rather than encoding it into a flat key string precisely so
   * this can match on the Project without re-parsing the key.
   */
  invalidate(projectId?: string): void {
    if (projectId === undefined) {
      this.cache.clear();
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.projectId === projectId) this.cache.delete(key);
    }
  }

  /**
   * The raw aggregated rows one query reads, kept apart from pricing so the row cache
   * can hold them (see the cache field's note): everything that is expensive and
   * slow-moving lives here, everything that must never be stale does not.
   */
  private async aggregateRows(
    projectId: string,
    q: UsageQuery,
    nowMs: number,
    cacheKey: string,
  ): Promise<AggregatedRows> {
    const today = formatLocalDate(this.clock.now());
    // A grouped-by-Session response over a long-lived Project carries one row per Session that
    // ever ran (thousands here). The sidebar only ever shows the most recent ones, so an explicit
    // limit lets that caller ask for what it renders; without one the full set is returned, which
    // is what every other caller (and the export) expects.
    // Top-level filter: agent + model (the cost center switches views by agent/model; the model filter is always sent as a pair).
    const base: UsageFilter = {};
    if (q.agentId !== undefined) base.agentId = q.agentId;
    if (q.provider !== undefined) base.provider = q.provider;
    if (q.modelId !== undefined) base.modelId = q.modelId;

    const win = (from?: string, to?: string): UsageFilter => ({
      ...base,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });

    // Timestamp window bounds ride alongside the date range wherever the
    // selected range applies; the calendar-fixed today / last-7-days cards
    // deliberately stay date-only.
    const ts: UsageFilter = {
      ...(q.fromTs !== undefined ? { fromTs: q.fromTs } : {}),
      ...(q.toTs !== undefined ? { toTs: q.toTs } : {}),
    };
    const tiers = this.tiers();
    // The rollup answers every one of these exactly when folding a day's rows changes nothing
    // (rollupSafeFor: no price tier, no timestamp window, no session subset). When it does, the
    // same query runs against usage_records — same figures, more rows to scan.
    const canRollup = this.usage.rollupSafeFor({}, tiers);
    const bucket = (f: UsageFilter) =>
      canRollup ? this.usage.rollupBucketByModel(projectId, f) : this.usage.bucketByModel(projectId, f, tiers);
    const todayRows = bucket(win(today, today));
    const last7dRows = bucket(win(localDateMinusDays(this.clock.now(), 6)));
    const totalRows = bucket({ ...win(q.from, q.to), ...ts });
    const groupRows = canRollup
      ? this.usage.rollupGroupsByModel(projectId, q.groupBy, { ...win(q.from, q.to), ...ts })
      : this.usage.groupsByModel(projectId, q.groupBy, { ...win(q.from, q.to), ...ts }, tiers);
    // Time series at the requested precision, zero-filled over the requested
    // range, defaulting to the last 30 days when no range is given.
    const granularity = q.granularity ?? "day";
    const seriesFrom = q.from ?? localDateMinusDays(this.clock.now(), 29);
    const seriesTo = q.to ?? today;
    // The series is zero-filled over the whole effective range: cap the bucket
    // count so an arbitrary range × precision combination cannot materialize an
    // unbounded response. 500 comfortably covers every range the Web App offers
    // (90 days daily = 90, 14 days hourly = 336, a trailing hour by minute = 61).
    // Minute buckets only make sense inside a timestamp window — the trailing
    // ranges — and hour buckets switch to the window when one is given.
    let bucketKeys: string[];
    if (granularity === "minute" || (granularity === "hour" && ts.fromTs !== undefined)) {
      if (ts.fromTs === undefined || ts.toTs === undefined) {
        throw badRequest(
          "fromTs and toTs must be given together, and minute granularity requires them.",
        );
      }
      bucketKeys = enumerateTsBuckets(new Date(ts.fromTs), new Date(ts.toTs), granularity, 500);
    } else {
      bucketKeys = enumerateBuckets(seriesFrom, seriesTo, granularity, 500);
    }
    if (bucketKeys.length > 500) {
      throw badRequest(
        "Date range too wide for this granularity; narrow the range or coarsen the granularity.",
      );
    }
    // Only DAY buckets are foldable: an hour/minute series needs each row's own instant, which
    // the day-grained rollup does not carry.
    const dailySeries = granularity === "day";
    const seriesRows =
      canRollup && dailySeries
        ? this.usage.rollupSeriesByModel(projectId, { ...win(seriesFrom, seriesTo), ...ts })
        : this.usage.seriesByModel(projectId, granularity, { ...win(seriesFrom, seriesTo), ...ts }, tiers);
    // Per-Agent and per-Model series: each drops its own dimension's filter (its
    // chart draws that dimension's whole breakdown) but honors the other
    // dimension plus the selected range.
    const agentFree: UsageFilter = {
      ...(q.provider !== undefined ? { provider: q.provider } : {}),
      ...(q.modelId !== undefined ? { modelId: q.modelId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...ts,
    };
    const agentFreeRange = { ...agentFree, from: seriesFrom, to: seriesTo };
    // agentSeries carries no price dimension, so the only thing that can disqualify the rollup here
    // is the bucket granularity (a sub-day series needs the instant).
    const agentBucketRows =
      dailySeries && this.usage.rollupSafeFor(agentFreeRange, [])
        ? this.usage.rollupAgentSeries(projectId, agentFreeRange)
        : this.usage.agentSeries(projectId, granularity, agentFreeRange);
    // With no model filter set, dropping the model filter leaves exactly the
    // query `seriesRows` already ran: reuse its rows instead of running the
    // heaviest query on this route (bucket x model) a second time.
    const modelFiltered = q.provider !== undefined || q.modelId !== undefined;
    const modelBucketRows = modelFiltered
      ? this.usage.seriesByModel(projectId, granularity, {
          ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
          from: seriesFrom,
          to: seriesTo,
          ...ts,
        })
      : seriesRows;
    // Error statistics: likewise not affected by the model filter (HTTP / process errors have no Model dimension), but still affected by the date + agent filter — and by the trailing window, like every other range-scoped aggregate.
    const errorFilter: ErrorFilter = {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...(q.fromTs !== undefined ? { fromTs: q.fromTs } : {}),
      ...(q.toTs !== undefined ? { toTs: q.toTs } : {}),
      // Unattributed errors are visible only to admins (regular members only see errors within their own Project, see the ErrorsRepo file header).
      ...(q.includeGlobalErrors === true ? { includeGlobal: true } : {}),
    };

    // Each paired reference that occurs is looked up for its current price only once.
    const rows: AggregatedRows = {
      todayRows,
      last7dRows,
      totalRows,
      groupRows,
      seriesRows,
      agentBucketRows,
      modelBucketRows,
      bucketKeys,
      granularity,
      errorFilter,
    };
    // Replace this key's entry and, past the bound, the oldest one (Map iterates in
    // insertion order, so the first key is the least recently added).
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, { projectId, at: nowMs, rows });
    if (this.cache.size > UsageService.CACHE_MAX) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    return rows;
  }

  /**
   * Prices a set of aggregated rows and folds them into the response. Deliberately NOT
   * cached: the rows behind a cost figure move at most once a minute, but a PRICE moves
   * the moment someone edits it, and a cost page showing yesterday's rate is worse than a
   * slow one.
   */
  private async buildResponse(
    projectId: string,
    q: UsageQuery,
    rows: AggregatedRows,
  ): Promise<UsageResponse> {
    const { todayRows, last7dRows, totalRows, groupRows, seriesRows, agentBucketRows, modelBucketRows, bucketKeys, granularity, errorFilter } = rows;
    const rates = new Map<string, TieredRates | undefined>();
    const allRefs = new Map<string, { provider: string; modelId: string }>();
    for (const r of [...todayRows, ...last7dRows, ...totalRows, ...groupRows, ...seriesRows]) {
      allRefs.set(refKey(r.provider, r.modelId), { provider: r.provider, modelId: r.modelId });
    }
    for (const [key, ref] of allRefs) {
      rates.set(key, await this.lookupPricing(projectId, ref.provider, ref.modelId));
    }

    return {
      summary: {
        today: this.foldBucket(todayRows, rates),
        last7d: this.foldBucket(last7dRows, rates),
        total: this.foldBucket(totalRows, rates),
      },
      groupBy: q.groupBy,
      // `groupLimit` keeps the most recent groups only. Which end is "most recent" depends on the
      // dimension (a session id embeds its creation time; a date sorts chronologically; an agent
      // id does not), so the service is told the order by the caller rather than guessing — and
      // a limit on a dimension with no such order is refused rather than silently dropping rows
      // the caller would have shown.
      groups: this.foldGroups(
        q.groupLimit === undefined
          ? groupRows
          : orderForLimit(q.groupBy, groupRows).slice(0, q.groupLimit),
        rates,
        q.groupBy,
      ),
      granularity,
      series: this.foldSeries(bucketKeys, seriesRows, rates),
      byAgentSeries: foldAgentSeries(bucketKeys, agentBucketRows),
      byModelSeries: foldModelSeries(bucketKeys, modelBucketRows),
      errors: this.foldErrors(projectId, errorFilter, q.utcOffsetMinutes),
      agentIds: this.usage.distinctAgentIds(projectId),
      models: this.usage.distinctModels(projectId),
    };
  }

  /**
   * One page of the error detail table, newest first. The dashboard's own response already
   * carries the first page (`errors.recent`); this serves the "show me earlier ones" paging,
   * where refetching the whole aggregate to move one page would be wasteful. `rows` is the
   * filtered row count, so the caller knows when it has reached the end; `total` counts the
   * records behind those rows, the occurrences the badge reports.
   *
   * Takes the same filter the dashboard applies — date + agent, and admin-only visibility of
   * unattributed errors — so a page never widens what the summary above it counted.
   *
   * Paging is by offset into a newest-first table that grows at its head, so errors recorded
   * between two page requests shift every row down and a page can re-show rows already seen.
   * Accepted deliberately: this is a diagnostic table read at a moment in time, not a feed to
   * be walked exhaustively, and keying off the newest row's id would cost a cursor the caller
   * has no other use for.
   */
  queryErrors(projectId: string, q: UsageErrorsQuery): UsageErrorsPage {
    const f: ErrorFilter = {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...(q.fromTs !== undefined ? { fromTs: q.fromTs } : {}),
      ...(q.toTs !== undefined ? { toTs: q.toTs } : {}),
      ...(q.kind !== undefined ? { kind: q.kind } : {}),
      ...(q.includeGlobalErrors === true ? { includeGlobal: true } : {}),
    };
    return {
      items: this.errors.recent(projectId, f, q.limit, q.offset, q.utcOffsetMinutes),
      total: this.errors.summary(projectId, f).total,
      rows: this.errors.rowCount(projectId, f, q.utcOffsetMinutes),
    };
  }

  /**
   * Empties the error table for the filter the panel is showing, and answers how many rows went.
   *
   * The filter is the same range (dates, and the trailing window when one is on) and Agent
   * the dashboard and the paged route take, read with the same admin visibility, so a clear
   * removes exactly the set the caller was looking at and never a row outside it: a reader
   * who has narrowed to one Agent and one week does not lose the rest of the year to a button
   * that said "clear", and an admin whose panel showed unattributed rows is not left holding
   * them after clearing it (see ErrorsRepo.deleteFiltered).
   */
  clearErrors(projectId: string, q: UsageErrorsClearQuery): number {
    return this.errors.deleteFiltered(projectId, {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...(q.fromTs !== undefined ? { fromTs: q.fromTs } : {}),
      ...(q.toTs !== undefined ? { toTs: q.toTs } : {}),
      ...(q.includeGlobalErrors === true ? { includeGlobal: true } : {}),
    });
  }

  /** Error statistics: summary info (total / unexpected / most common error code) + the table's first N rows and its row count, all filtered by the selected range. */
  private foldErrors(projectId: string, f: ErrorFilter, utcOffsetMinutes?: number): UsageErrors {
    const { total, unexpected } = this.errors.summary(projectId, f);
    return {
      total,
      unexpected,
      topCode: this.errors.topCode(projectId, f),
      recent: this.errors.recent(projectId, f, ERROR_RECENT_N, 0, utcOffsetMinutes),
      rows: this.errors.rowCount(projectId, f, utcOffsetMinutes),
    };
  }

  /**
   * Lifetime Token totals per Model — one grouped scan of `usage_records`, no filters. The
   * models page shows each configured model what it has actually spent, and that figure is not
   * scoped to a range the way the cost center's is; a model with no records is simply absent,
   * so the caller renders nothing rather than a zero.
   */
  modelTotals(projectId: string): UsageModelTotals {
    return {
      totals: this.usage.bucketByModel(projectId).map((r) => ({
        provider: r.provider,
        modelId: r.modelId,
        tokens: r.total,
        requests: r.requests,
      })),
    };
  }

  private foldBucket(
    rows: UsageModelSums[],
    rates: Map<string, TieredRates | undefined>,
  ): UsageBucket {
    let total = 0;
    let requests = 0;
    let cost: number | null = null;
    let hasUncosted = false;
    for (const r of rows) {
      total += r.total;
      requests += r.requests;
      const rate = rates.get(refKey(r.provider, r.modelId));
      if (rate) cost = (cost ?? 0) + costOf(r, rate);
      else hasUncosted = true;
    }
    return { total, requests, cost, hasUncosted };
  }

  private foldGroups(
    rows: UsageGroupModelSums[],
    rates: Map<string, TieredRates | undefined>,
    groupBy: UsageGroupBy,
  ): UsageGroupRow[] {
    // The model dimension folds by paired reference (a shared model_id name across providers is split into separate rows); other dimensions fold by their group key.
    const keyOf = (r: UsageGroupModelSums): string =>
      groupBy === "model" ? refKey(r.provider, r.key) : r.key;
    const byKey = new Map<string, UsageGroupRow>();
    for (const r of rows) {
      const acc: UsageGroupRow = byKey.get(keyOf(r)) ?? {
        key: r.key,
        ...(groupBy === "model" ? { provider: r.provider } : {}),
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 0,
        requests: 0,
        cost: null as number | null,
        hasUncosted: false,
      };
      acc.cacheRead += r.cacheRead;
      acc.cacheWrite += r.cacheWrite;
      acc.output += r.output;
      acc.total += r.total;
      acc.requests += r.requests;
      const rate = rates.get(refKey(r.provider, r.modelId));
      if (rate) {
        acc.cost = (acc.cost ?? 0) + costOf(r, rate);
        acc.costParts = sumCostParts(acc.costParts ?? ZERO_COST_PARTS, costPartsOf(r, rate));
      } else {
        acc.hasUncosted = true;
      }
      byKey.set(keyOf(r), acc);
    }
    const out = [...byKey.values()];
    // The date dimension sorts by key descending (most recent first); other dimensions sort by total Token count descending.
    if (groupBy === "date") out.sort((a, b) => b.key.localeCompare(a.key));
    else out.sort((a, b) => b.total - a.total);
    return out;
  }

  /**
   * Fold the per-Model series rows onto the zero-filled bucket skeleton: every
   * enumerated bucket appears exactly once, in order, so line charts never
   * connect across a silent gap. A row whose key falls outside the skeleton
   * cannot happen for day/week/month (keys derive from the filtered date
   * column) and is dropped defensively for minute/hour, whose keys come from
   * `ts` and can therefore fall outside a skeleton built from `date` if a row
   * was recorded under a different clock.
   */
  private foldSeries(
    keys: string[],
    rows: UsageSeriesModelSums[],
    rates: Map<string, TieredRates | undefined>,
  ): UsageSeriesPoint[] {
    const byKey = new Map<string, UsageSeriesPoint>(
      keys.map((bucket) => [
        bucket,
        {
          bucket,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          total: 0,
          cost: null,
          requests: 0,
          completed: 0,
          denominator: 0,
        },
      ]),
    );
    for (const r of rows) {
      const acc = byKey.get(r.key);
      if (!acc) continue;
      acc.cacheRead += r.cacheRead;
      acc.cacheWrite += r.cacheWrite;
      acc.output += r.output;
      acc.total += r.total;
      acc.requests += r.requests;
      acc.completed += r.completed;
      acc.denominator += r.denominator;
      const rate = rates.get(refKey(r.provider, r.modelId));
      if (rate) acc.cost = (acc.cost ?? 0) + costOf(r, rate);
    }
    return keys.map((k) => byKey.get(k)!);
  }
}

const sumOf = (a: number[]) => a.reduce((s, v) => s + v, 0);

const zeros = (n: number) => new Array<number>(n).fill(0);

/**
 * Per-Agent counts aligned index-for-index with the bucket skeleton, sorted by
 * total requests descending (the requests chart takes the head and folds the
 * tail into an "other" series client-side).
 */
function foldAgentSeries(keys: string[], rows: UsageAgentBucketCount[]): UsageAgentSeries[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const byAgent = new Map<string, UsageAgentSeries>();
  for (const r of rows) {
    const i = idx.get(r.key);
    if (i === undefined) continue;
    let s = byAgent.get(r.agentId);
    if (!s) {
      s = {
        agentId: r.agentId,
        requests: zeros(keys.length),
        completed: zeros(keys.length),
        denominator: zeros(keys.length),
      };
      byAgent.set(r.agentId, s);
    }
    s.requests[i]! += r.requests;
    s.completed[i]! += r.completed;
    s.denominator[i]! += r.denominator;
  }
  return [...byAgent.values()].sort((a, b) => sumOf(b.requests) - sumOf(a.requests));
}

/** Per-Model counts aligned with the bucket skeleton (entity identity is the (provider, modelId) pair), sorted by total requests descending. */
function foldModelSeries(keys: string[], rows: UsageSeriesModelSums[]): UsageModelSeries[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const byModel = new Map<string, UsageModelSeries>();
  for (const r of rows) {
    const i = idx.get(r.key);
    if (i === undefined) continue;
    const key = refKey(r.provider, r.modelId);
    let s = byModel.get(key);
    if (!s) {
      s = {
        provider: r.provider,
        modelId: r.modelId,
        requests: zeros(keys.length),
        completed: zeros(keys.length),
        denominator: zeros(keys.length),
      };
      byModel.set(key, s);
    }
    s.requests[i]! += r.requests;
    s.completed[i]! += r.completed;
    s.denominator[i]! += r.denominator;
  }
  return [...byModel.values()].sort((a, b) => sumOf(b.requests) - sumOf(a.requests));
}
