/**
 * The observability mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
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
export abstract class ErrorLog extends Interface<{
  insert(r: ErrorRecordInsert): void;
  summary(projectId: string, f?: ErrorFilter): ErrorSummary;
  topCode(projectId: string, f?: ErrorFilter): ErrorCodeCount | null;
  recent(projectId: string, f?: ErrorFilter, limit?: number, offset?: number): ErrorItem[];
  deleteFiltered(projectId: string, f?: Omit<ErrorFilter, "includeGlobal">): number;
  deleteByAgent(projectId: string, agentId: string): void;
  deleteByProject(projectId: string): void;
}>() {}

/** Errors: the mechanism ErrorRecorder implements. */
export abstract class Errors extends Interface<{
  record(args: ErrorRecordArgs): void;
}>() {}

/** UsageStore: the mechanism UsageRepo implements. */
export abstract class UsageStore extends Interface<{
  insert(r: UsageRecordInsert): void;
  bucketByModel(projectId: string, f?: UsageFilter, tiers?: readonly PeakTier[]): UsageModelSums[];
  groupsByModel(
    projectId: string,
    groupBy: UsageGroupBy,
    f?: UsageFilter,
    tiers?: readonly PeakTier[],
  ): UsageGroupModelSums[];
  seriesByModel(
    projectId: string,
    granularity: UsageSeriesGranularity,
    f?: UsageFilter,
    tiers?: readonly PeakTier[],
  ): UsageSeriesModelSums[];
  agentSeries(
    projectId: string,
    granularity: UsageSeriesGranularity,
    f?: UsageFilter,
  ): UsageAgentBucketCount[];
  distinctAgentIds(projectId: string): string[];
  distinctModels(projectId: string): { provider: string; modelId: string }[];
  deleteByProject(projectId: string): void;
}>() {}

/** UsageRecording: the mechanism UsageRecorder implements. */
export abstract class UsageRecording extends Interface<{
  record(ctx: UsageContext, msg: OmniMessage<OmniPayload>): Promise<void>;
}>() {}

/** UsageQueries: the mechanism UsageService implements. */
export abstract class UsageQueries extends Interface<{
  query(projectId: string, q: UsageQuery): Promise<UsageResponse>;
  queryErrors(projectId: string, q: UsageErrorsQuery): UsageErrorsPage;
  clearErrors(projectId: string, q: UsageErrorsClearQuery): number;
  modelTotals(projectId: string): UsageModelTotals;
}>() {}
