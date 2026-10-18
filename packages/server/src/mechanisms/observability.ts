/**
 * The observability mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type {
  ErrorCodeCount,
  ErrorFilter,
  ErrorItem,
  ErrorRecordInsert,
  ErrorSummary,
} from "../db/repos/errors.js";
import type { ErrorRecordArgs } from "../runtime/error-recorder.js";
import type {
  UsageAgentBucketCount,
  UsageFilter,
  UsageGroupModelSums,
  UsageModelSums,
  UsageRecordInsert,
  UsageSeriesGranularity,
  UsageSeriesModelSums,
  PeakTier,
} from "../db/repos/usage.js";
import type {
  UsageErrorsPage,
  UsageGroupBy,
  UsageResponse,
  UsageModelTotals,
} from "../api/types.js";
import type { UsageContext } from "../runtime/usage-recorder.js";
import type {
  AbortPayload,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  ImageUrlPayload,
  InlineDataPayload,
  InlineThinkingPayload,
  McpConnectBeginPayload,
  McpConnectEndPayload,
  OmniMessage,
  OmniPayload,
  PartialTextPayload,
  PartialThinkingPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
  RequestBeginPayload,
  RequestEndPayload,
  SessionMetaPayload,
  SubagentPayload,
  TextPayload,
  ThinkingPayload,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
  ToolListReadyPayload,
} from "@prismshadow/penguin-core";
import type {
  UsageQuery,
  UsageErrorsClearQuery,
  UsageErrorsQuery,
} from "../services/usage-service.js";

/** ErrorLog: the mechanism ErrorsRepo implements. */
@Interface()
export abstract class ErrorLog {
  abstract insert(r: ErrorRecordInsert): void;
  abstract summary(projectId: string, f?: ErrorFilter): ErrorSummary;
  abstract topCode(projectId: string, f?: ErrorFilter): ErrorCodeCount | null;
  abstract recent(
    projectId: string,
    f?: ErrorFilter,
    limit?: number,
    offset?: number,
    utcOffsetMinutes?: number,
  ): ErrorItem[];
  abstract rowCount(projectId: string, f?: ErrorFilter, utcOffsetMinutes?: number): number;
  abstract deleteFiltered(projectId: string, f?: Omit<ErrorFilter, "includeGlobal">): number;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
}

/** Errors: the mechanism ErrorRecorder implements. */
@Interface()
export abstract class Errors {
  abstract record(args: ErrorRecordArgs): void;
}

/** UsageStore: the mechanism UsageRepo implements. */
@Interface()
export abstract class UsageStore {
  abstract insert(r: UsageRecordInsert): void;

  /**
   * Rebuilds the daily rollup cache from usage_records (see UsageRepo). A cache rebuild, not a
   * write: no data lives only there, so this is the whole recovery path.
   */
  abstract rebuildRollup(projectId?: string): void;

  /**
   * Whether the rollup can answer this filter EXACTLY. False whenever folding a day's rows
   * together would change a figure — a price tier in play, a timestamp window, or a named
   * session subset — in which case the caller must read usage_records instead.
   */
  abstract rollupSafeFor(f: UsageFilter, tiers: readonly PeakTier[]): boolean;

  /** bucketByModel's shape, read from the rollup (single-rate only). */
  abstract rollupBucketByModel(projectId: string, f?: UsageFilter): UsageModelSums[];

  /** groupsByModel's shape, read from the rollup (single-rate only). */
  abstract rollupGroupsByModel(
    projectId: string,
    groupBy: UsageGroupBy,
    f?: UsageFilter,
  ): UsageGroupModelSums[];

  /** seriesByModel's shape at DAY granularity, read from the rollup (single-rate only). */
  abstract rollupSeriesByModel(projectId: string, f?: UsageFilter): UsageSeriesModelSums[];

  /** agentSeries's shape at DAY granularity, read from the rollup. */
  abstract rollupAgentSeries(projectId: string, f?: UsageFilter): UsageAgentBucketCount[];
  abstract bucketByModel(
    projectId: string,
    f?: UsageFilter,
    tiers?: readonly PeakTier[],
  ): UsageModelSums[];
  abstract groupsByModel(
    projectId: string,
    groupBy: UsageGroupBy,
    f?: UsageFilter,
    tiers?: readonly PeakTier[],
  ): UsageGroupModelSums[];
  abstract seriesByModel(
    projectId: string,
    granularity: UsageSeriesGranularity,
    f?: UsageFilter,
    tiers?: readonly PeakTier[],
  ): UsageSeriesModelSums[];
  abstract agentSeries(
    projectId: string,
    granularity: UsageSeriesGranularity,
    f?: UsageFilter,
  ): UsageAgentBucketCount[];
  abstract distinctAgentIds(projectId: string): string[];
  abstract distinctModels(projectId: string): { provider: string; modelId: string }[];
  abstract deleteByProject(projectId: string): void;
}

/** UsageRecording: the mechanism UsageRecorder implements. */
@Interface()
export abstract class UsageRecording {
  abstract record(ctx: UsageContext, msg: OmniMessage<OmniPayload>): Promise<void>;
}

/** UsageQueries: the mechanism UsageService implements. */
@Interface()
export abstract class UsageQueries {
  abstract query(projectId: string, q: UsageQuery): Promise<UsageResponse>;

  /**
   * Drops the cached answer(s) for one Project (all of them when the Project is omitted). Called
   * by the recorder the moment usage lands, so a figure already on screen is not held for the
   * rest of the cache TTL after new tokens have actually landed.
   */
  abstract invalidate(projectId?: string): void;
  abstract queryErrors(projectId: string, q: UsageErrorsQuery): UsageErrorsPage;
  abstract clearErrors(projectId: string, q: UsageErrorsClearQuery): number;
  abstract modelTotals(projectId: string): UsageModelTotals;
  abstract costBySession(
    projectId: string,
    sessionIds: readonly string[],
    fromTs: string,
    toTs: string,
  ): Promise<Opaque<"CostBySession", { bySession: Map<string, number>; unpriced: boolean }>>;
  abstract dailyCostForSessions(
    projectId: string,
    sessionIds: readonly string[],
    fromTs: string,
    toTs: string,
  ): Promise<Array<{ date: string; cost: number }>>;
}
