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
import type { ErrorFilter, ErrorsRepo } from "../db/repos/errors.js";
import { offPeakScheduledRefs } from "@prismshadow/penguin-core/model-catalog";
import type {
  UsageRepo,
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
import type { Overrides } from "../hmr/capabilities.js";
import type { ProjectConfigService } from "./project-config-service.js";

/**
 * Number of most-recent entries kept in the error detail table. Also the page size the whole
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
}

/** One page of the error detail table (see {@link UsageService.queryErrors}). */
export interface UsageErrorsQuery {
  offset: number;
  limit: number;
  from?: string;
  to?: string;
  agentId?: string;
  /** Narrow to one category — `unexpected` (500s / runtime exceptions) or `expected`; absent counts both. */
  kind?: string;
  /** Admin only: include errors with no Project attribution (see the ErrorsRepo file header). */
  includeGlobalErrors?: boolean;
}

/**
 * What a clear removes (see {@link UsageService.clearErrors}): the panel's own date range and
 * Agent, and nothing else. No `kind` — the panel offers no such control, so a clear has no
 * narrowing the reader could have seen — and no `includeGlobalErrors`, since unattributed rows
 * are never a Project's to delete.
 */
export interface UsageErrorsClearQuery {
  from?: string;
  to?: string;
  agentId?: string;
}

/** Cost formula: sum of the three buckets at the tier these Tokens ran in, USD per million. */
function costOf(sums: UsageModelSums, tiered: TieredRates): number {
  const rates = sums.peak ? tiered.peak : tiered.offPeak;
  return (
    (sums.cacheRead * rates.cacheRead +
      sums.cacheWrite * rates.cacheWrite +
      sums.output * rates.output) /
    1e6
  );
}

/** In-process Map key for a paired reference (\0-separated, the same style as session-manager's agentKey; never persisted). */
function refKey(provider: string, modelId: string): string {
  return `${provider}\0${modelId}`;
}

@Component()
export class UsageService {
  @Use() private readonly usage!: UsageRepo;
  @Use() private readonly errors!: ErrorsRepo;
  @Use() private readonly projectConfig!: ProjectConfigService;
  @Use() private readonly overrides!: Overrides;
  private lookupPricing: PricingLookup = (projectId, provider, modelId) =>
    this.projectConfig.getPricing(projectId, provider, modelId);
  private now: () => Date = () => new Date();

  setup(): void {
    this.now = this.overrides.value().now ?? this.now;
  }

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

  async query(projectId: string, q: UsageQuery): Promise<UsageResponse> {
    const today = formatLocalDate(this.now());
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
    const todayRows = this.usage.bucketByModel(projectId, win(today, today), tiers);
    const last7dRows = this.usage.bucketByModel(
      projectId,
      win(localDateMinusDays(this.now(), 6)),
      tiers,
    );
    const totalRows = this.usage.bucketByModel(projectId, { ...win(q.from, q.to), ...ts }, tiers);
    const groupRows = this.usage.groupsByModel(
      projectId,
      q.groupBy,
      { ...win(q.from, q.to), ...ts },
      tiers,
    );
    // Time series at the requested precision, zero-filled over the requested
    // range, defaulting to the last 30 days when no range is given.
    const granularity = q.granularity ?? "day";
    const seriesFrom = q.from ?? localDateMinusDays(this.now(), 29);
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
    const seriesRows = this.usage.seriesByModel(
      projectId,
      granularity,
      { ...win(seriesFrom, seriesTo), ...ts },
      tiers,
    );
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
    const agentBucketRows = this.usage.agentSeries(projectId, granularity, {
      ...agentFree,
      from: seriesFrom,
      to: seriesTo,
    });
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
    // Error statistics: likewise not affected by the model filter (HTTP / process errors have no Model dimension), but still affected by the date + agent filter.
    const errorFilter: ErrorFilter = {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      // Unattributed errors are visible only to admins (regular members only see errors within their own Project, see the ErrorsRepo file header).
      ...(q.includeGlobalErrors === true ? { includeGlobal: true } : {}),
    };

    // Each paired reference that occurs is looked up for its current price only once.
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
      groups: this.foldGroups(groupRows, rates, q.groupBy),
      granularity,
      series: this.foldSeries(bucketKeys, seriesRows, rates),
      byAgentSeries: foldAgentSeries(bucketKeys, agentBucketRows),
      byModelSeries: foldModelSeries(bucketKeys, modelBucketRows),
      errors: this.foldErrors(projectId, errorFilter),
      agentIds: this.usage.distinctAgentIds(projectId),
      models: this.usage.distinctModels(projectId),
    };
  }

  /**
   * One page of the error detail table, newest first. The dashboard's own response already
   * carries the first page (`errors.recent`); this serves the "show me earlier ones" paging,
   * where refetching the whole aggregate to move one page would be wasteful. `total` is the
   * filtered row count, so the caller knows when it has reached the end.
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
      ...(q.kind !== undefined ? { kind: q.kind } : {}),
      ...(q.includeGlobalErrors === true ? { includeGlobal: true } : {}),
    };
    return {
      items: this.errors.recent(projectId, f, q.limit, q.offset),
      total: this.errors.summary(projectId, f).total,
    };
  }

  /**
   * Empties the error table for the filter the panel is showing, and answers how many rows went.
   *
   * The filter is the same date range and Agent the dashboard and the paged route take, so a
   * clear removes exactly the set the caller was looking at and never a row outside it: a
   * reader who has narrowed to one Agent and one week does not lose the rest of the year to a
   * button that said "clear".
   *
   * Unattributed rows are outside every clear (see ErrorsRepo.deleteFiltered): they carry no
   * Project, so they are not this Project's to remove, and the delete's scope is therefore
   * strictly narrower than what any caller — admin included — is allowed to read.
   */
  clearErrors(projectId: string, q: UsageErrorsClearQuery): number {
    return this.errors.deleteFiltered(projectId, {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    });
  }

  /** Error statistics: summary info (total / unexpected / most common error code) + the last N entries, all filtered by the selected range. */
  private foldErrors(projectId: string, f: ErrorFilter): UsageErrors {
    const { total, unexpected } = this.errors.summary(projectId, f);
    return {
      total,
      // Counted the way deleteFiltered selects — without the unattributed rows an admin's read
      // includes — so the clear confirmation states what will really go rather than what is on
      // screen. Identical to `total` for everyone whose read did not include them.
      clearable:
        f.includeGlobal === true
          ? this.errors.summary(projectId, { ...f, includeGlobal: false }).total
          : total,
      unexpected,
      topCode: this.errors.topCode(projectId, f),
      recent: this.errors.recent(projectId, f, ERROR_RECENT_N),
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
      const acc = byKey.get(keyOf(r)) ?? {
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
      if (rate) acc.cost = (acc.cost ?? 0) + costOf(r, rate);
      else acc.hasUncosted = true;
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
