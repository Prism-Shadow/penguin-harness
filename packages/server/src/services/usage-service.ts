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
 * filtering), and a 30-day trend.
 * Server-side error statistics (error_records) ride along on the same response:
 * the statistics center fetches everything in one request, and filters are
 * naturally shared; unattributed errors (login failures, process crashes, and other
 * errors with no Project context) are visible only to admins, see the ErrorsRepo
 * file header.
 */
import type {
  UsageBucket,
  UsageErrors,
  UsageGroupBy,
  UsageGroupRow,
  UsageResponse,
} from "../api/types.js";
import type { ErrorFilter, ErrorsRepo } from "../db/repos/errors.js";
import type {
  UsageRepo,
  UsageModelSums,
  UsageGroupModelSums,
  UsageFilter,
} from "../db/repos/usage.js";
import { formatLocalDate, localDateMinusDays } from "../internal/dates.js";

/** Number of most-recent entries kept in the error detail table. */
const ERROR_RECENT_N = 20;

/** The three pricing buckets (usd_per_mtok convention), returned by the pricing lookup callback. */
export interface PricingRates {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export type PricingLookup = (
  projectId: string,
  provider: string,
  modelId: string,
) => Promise<PricingRates | undefined>;

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
}

/** Cost formula: sum of the three buckets, in USD per million Tokens. */
function costOf(sums: UsageModelSums, rates: PricingRates): number {
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

export class UsageService {
  constructor(
    private readonly usage: UsageRepo,
    private readonly errors: ErrorsRepo,
    private readonly lookupPricing: PricingLookup,
    private readonly now: () => Date = () => new Date(),
  ) {}

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

    const todayRows = this.usage.bucketByModel(projectId, win(today, today));
    const last7dRows = this.usage.bucketByModel(projectId, win(localDateMinusDays(this.now(), 6)));
    const totalRows = this.usage.bucketByModel(projectId, win(q.from, q.to));
    const groupRows = this.usage.groupsByModel(projectId, q.groupBy, win(q.from, q.to));
    // Fixed 30-day window; affected by the agent/model filter.
    const trendFrom = localDateMinusDays(this.now(), 29);
    const trendRows = this.usage.groupsByModel(projectId, "date", win(trendFrom));
    // Agent call-count chart: not affected by the agent filter (shows all agents), but still affected by the date + model filter.
    const agentRows = this.usage.groupsByModel(projectId, "agent", {
      ...(q.provider !== undefined ? { provider: q.provider } : {}),
      ...(q.modelId !== undefined ? { modelId: q.modelId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    });
    // Model success-rate chart: not affected by the model filter (shows all models), but still affected by the date + agent filter.
    const statusRows = this.usage.statusByModel(projectId, {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    });
    // Error statistics: likewise not affected by the model filter (HTTP / process errors have no Model dimension), but still affected by the date + agent filter.
    const errorFilter: ErrorFilter = {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      // Unattributed errors are visible only to admins (regular members only see errors within their own Project, see the ErrorsRepo file header).
      ...(q.includeGlobalErrors === true ? { includeGlobal: true } : {}),
    };

    // Each paired reference that occurs is looked up for its current price only once.
    const rates = new Map<string, PricingRates | undefined>();
    const allRefs = new Map<string, { provider: string; modelId: string }>();
    for (const r of [...todayRows, ...last7dRows, ...totalRows, ...groupRows, ...trendRows]) {
      allRefs.set(refKey(r.provider, r.modelId), { provider: r.provider, modelId: r.modelId });
    }
    for (const [key, ref] of allRefs) {
      rates.set(key, await this.lookupPricing(projectId, ref.provider, ref.modelId));
    }

    const byAgentMap = new Map<string, { requests: number; total: number }>();
    for (const r of agentRows) {
      const acc = byAgentMap.get(r.key) ?? { requests: 0, total: 0 };
      acc.requests += r.requests;
      acc.total += r.total;
      byAgentMap.set(r.key, acc);
    }

    return {
      summary: {
        today: this.foldBucket(todayRows, rates),
        last7d: this.foldBucket(last7dRows, rates),
        total: this.foldBucket(totalRows, rates),
      },
      groupBy: q.groupBy,
      groups: this.foldGroups(groupRows, rates, q.groupBy),
      trend: this.foldTrend(trendRows, rates),
      byAgent: [...byAgentMap.entries()]
        .map(([agentId, v]) => ({ agentId, requests: v.requests, total: v.total }))
        .sort((a, b) => b.requests - a.requests),
      success: statusRows.sort((a, b) => b.total - a.total),
      errors: this.foldErrors(projectId, errorFilter),
      agentIds: this.usage.distinctAgentIds(projectId),
      models: this.usage.distinctModels(projectId),
    };
  }

  /** Error statistics: summary info (total / unexpected / most common error code) + the last N entries, all filtered by the selected range. */
  private foldErrors(projectId: string, f: ErrorFilter): UsageErrors {
    const { total, unexpected } = this.errors.summary(projectId, f);
    return {
      total,
      unexpected,
      topCode: this.errors.topCode(projectId, f),
      recent: this.errors.recent(projectId, f, ERROR_RECENT_N),
    };
  }

  private foldBucket(
    rows: UsageModelSums[],
    rates: Map<string, PricingRates | undefined>,
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
    rates: Map<string, PricingRates | undefined>,
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

  private foldTrend(
    rows: UsageGroupModelSums[],
    rates: Map<string, PricingRates | undefined>,
  ): UsageResponse["trend"] {
    const byDate = new Map<
      string,
      { total: number; cacheRead: number; cacheWrite: number; output: number; cost: number | null }
    >();
    for (const r of rows) {
      const acc = byDate.get(r.key) ?? {
        total: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        cost: null,
      };
      acc.total += r.total;
      acc.cacheRead += r.cacheRead;
      acc.cacheWrite += r.cacheWrite;
      acc.output += r.output;
      const rate = rates.get(refKey(r.provider, r.modelId));
      if (rate) acc.cost = (acc.cost ?? 0) + costOf(r, rate);
      byDate.set(r.key, acc);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        total: v.total,
        cacheRead: v.cacheRead,
        cacheWrite: v.cacheWrite,
        output: v.output,
        cost: v.cost,
      }));
  }
}
