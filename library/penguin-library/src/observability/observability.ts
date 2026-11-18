/**
 * The observability mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { CostParts } from "../trace/index.js";
import type {
  ErrorCodeCount,
  ErrorFilter,
  ErrorItem,
  ErrorRecordInsert,
  ErrorSummary,
} from "./repos/errors.js";
import type {
  UsageAgentBucketCount,
  UsageFilter,
  UsageGroupModelSums,
  UsageModelSums,
  UsageRecordInsert,
  UsageSeriesGranularity,
  UsageSeriesModelSums,
  PeakTier,
} from "./repos/usage.js";
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
  AmspRecord,
  AmspPayload,
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

/** The vocabulary the storage and recording contracts name — from the server's
 * error recorder, usage recorder, usage service and api types. The contract names
 * them, so the types live with the contract. */

/** Capture-site source (maps one-to-one to error_records.source). */
export type ErrorSource =
  | "http"
  | "organization"
  | "session"
  | "llm"
  | "environment"
  | "compaction"
  | "usage"
  | "title"
  | "subagent"
  | "process"
  | "schedule"
  | "messaging"
  | "id_suggest"
  | "plugin";

/** Error classification: see file header — the criterion is "does a human need to step in". */
export type ErrorKind = "expected" | "unexpected";

export interface ErrorRecordArgs {
  source: ErrorSource;
  /** The caught error (unknown: the value caught may not be an Error; failures from the message stream pass the reason text directly). */
  err: unknown;
  ctx?: ErrorContext;
  /** Semantic code (required for non-HTTP sources, e.g. session_run_failed); defaults to HttpError.code. */
  code?: string;
  /** HTTP status code; leave empty for non-HTTP sources. */
  status?: number;
  /** Explicit classification (see file header); defaults to inferring from `HttpError` — HTTP sources rely on this, other sources should pass it explicitly. */
  kind?: ErrorKind;
}

export interface UsageContext {
  projectId: string;
  agentId: string;
  /** Top-level Session id (the current actual id after self-heal). */
  sessionId: string;
  /** Vendor grouping for the top-level Session's model (paired with modelId; the fallback attribution when the origin mapping has no hit). */
  provider: string;
  /** Upstream model_id of the top-level Session (paired with provider). */
  modelId: string;
}

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
}

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

export interface UsageErrorsClearQuery {
  from?: string;
  to?: string;
  fromTs?: string;
  toTs?: string;
  agentId?: string;
  /** Admin only, the value the caller's reads carry: an admin's clear takes the unattributed rows an admin's panel shows. */
  includeGlobalErrors?: boolean;
}

export interface UsageModelTotals {
  totals: UsageModelTotal[];
}

export interface UsageErrorsPage {
  items: UsageErrorItem[];
  /** Filtered record count — the occurrences, which is what the cost-center badge counts. */
  total: number;
  /** Filtered row count (records folded per {@link UsageErrorItem}), so the caller knows when it has reached the end. */
  rows: number;
}

export interface UsageResponse {
  summary: {
    today: UsageBucket;
    last7d: UsageBucket;
    total: UsageBucket;
  };
  groupBy: UsageGroupBy;
  groups: UsageGroupRow[];
  /** Effective precision of `series` (the validated `granularity` query parameter; defaults to day). */
  granularity: UsageGranularity;
  /**
   * Usage time series over the requested from/to range (defaulting to the last 30
   * days), zero-filled at `granularity`; affected by agent/model filters. Carries
   * everything the time-series charts draw: Token buckets, cost, request count,
   * and per-bucket success counts.
   */
  series: UsageSeriesPoint[];
  /**
   * Per-Agent counts per bucket, aligned index-for-index with `series`, sorted
   * by total requests descending. Unaffected by the agent filter — the by-Agent
   * chart draws the whole breakdown — but affected by date/model filters.
   */
  byAgentSeries: UsageAgentSeries[];
  /**
   * Per-Model counts per bucket, aligned index-for-index with `series`, sorted
   * by total requests descending. Unaffected by the model filter — the by-Model
   * chart draws the whole breakdown — but affected by date/agent filters.
   */
  byModelSeries: UsageModelSeries[];
  /** Server-side error capture stats (affected by date/agent filters; unaffected by model filter). */
  errors: UsageErrors;
  /** List of Agent ids that have appeared in this Project (for the filter dropdown; unaffected by current filters). */
  agentIds: string[];
  /** List of Model paired references that have appeared in this Project (for the filter dropdown). */
  models: ModelRefDto[];
}

import type { ModelRefDto } from "../agent-api/index.js";

/** From packages/server (api/types.ts): the usage response shapes. */

export type UsageGranularity = "minute" | "hour" | "day" | "week" | "month";

export interface UsageModelTotal {
  provider: string;
  modelId: string;
  /** The three buckets summed (cache read + cache write + output), matching the cost center's Token figure. */
  tokens: number;
  requests: number;
}

export interface UsageErrorItem {
  /** The latest of the records this row stands for. */
  ts: string;
  source: string;
  code: string;
  kind: string;
  message: string;
  /** How many records this row stands for (the panel's "×N"). */
  count: number;
  /** The earliest of them; equal to `ts` for a single record. */
  firstTs: string;
}

export interface UsageBucket {
  total: number;
  requests: number;
  /** Cost converted using current pricing at query time (USD); a partial sum when uncosted Models are included, null if none has pricing. */
  cost: number | null;
  /** Whether any Model has no pricing (its usage isn't included in cost; counted once pricing is added later). */
  hasUncosted: boolean;
}

export interface UsageGroupRow {
  /** Group key: date / agentId / modelId / sessionId. */
  key: string;
  /** Provider group when groupBy=model (rows are broken down by (provider, modelId); unset for other dimensions). */
  provider?: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  requests: number;
  cost: number | null;
  /**
   * `cost` split by pricing bucket, each record at the same rates, tier and promotion that
   * priced it in `cost`. Present exactly when `cost` is not null; a row's unpriced usage is in
   * neither.
   */
  costParts?: CostParts;
  hasUncosted: boolean;
}

export interface UsageSeriesPoint {
  bucket: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  /** Cost converted at query time (USD); null when no priced Model contributed. */
  cost: number | null;
  requests: number;
  /** Successful requests in the bucket. */
  completed: number;
  /** Success-rate denominator: all requests minus aborted (a user interruption is not a model failure). */
  denominator: number;
}

export interface UsageAgentSeries extends UsageEntitySeriesCounts {
  agentId: string;
}

export interface UsageModelSeries extends UsageEntitySeriesCounts {
  provider: string;
  modelId: string;
}

export interface UsageErrors {
  /** Filtered record count — also what a clear of the same filter takes (see {@link UsageErrorsClearResponse}). */
  total: number;
  /** Count of unexpected ones (500 / runtime exceptions) among them — the part the frontend highlights. */
  unexpected: number;
  /** The most frequent source · code (null when there are no errors). */
  topCode: UsageErrorCount | null;
  /** Most recent N rows (reverse chronological) — the first page; older ones come from `GET /usage/errors`. */
  recent: UsageErrorItem[];
  /** How many rows the table has for this filter (records folded per {@link UsageErrorItem}) — what the pager counts. */
  rows: number;
}

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

/** From packages/server (api/types.ts): the usage query's grouping. */
export type UsageGroupBy = "date" | "agent" | "model" | "session";

/** UsageStore: the mechanism UsageRepo implements. */
@Interface()
export abstract class UsageStore {
  abstract insert(r: UsageRecordInsert): void;
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
  abstract record(
    ctx: UsageContext,
    msg: AmspRecord<AmspPayload>,
    source?: "stream" | "standalone",
  ): Promise<void>;
}

/** UsageQueries: the mechanism UsageService implements. */
@Interface()
export abstract class UsageQueries {
  abstract query(projectId: string, q: UsageQuery): Promise<UsageResponse>;
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

/** One entity's per-bucket request and success counts, aligned index-for-index with `series` (the requests-and-success-rate chart draws one such entity — or stacks them all). `denominator` excludes aborted, same as elsewhere. */
export interface UsageEntitySeriesCounts {
  requests: number[];
  completed: number[];
  denominator: number[];
}

/** Occurrence count of an error for a given source · code (the "most common" metric in the stats center's error panel). */
export interface UsageErrorCount {
  source: string;
  code: string;
  kind: string;
  count: number;
}

/** Where an error was captured (was api/types.ts's; the Errors contract names it). */
export interface ErrorContext {
  projectId?: string;
  agentId?: string;
  sessionId?: string;
}
