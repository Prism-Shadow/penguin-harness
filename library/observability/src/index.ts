/**
 * The observability domain as a library package: the ErrorLog and UsageStore mechanisms
 * (the storage contracts their repos implement), the Errors and UsageRecording mechanisms
 * (the service contracts the server's recorders implement), the usage grouping vocabulary.
 * One package, no server dependencies. The repos take the Db capability from
 * @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the four mechanism contracts plus UsageGroupBy.
 * - `./observability` - the contracts module on its own.
 * - `./repos` (and per-file) - the errors and usage storing components.
 */
export {
  ErrorLog,
  Errors,
  UsageStore,
  UsageRecording,
  UsageQueries,
  MESSAGE_MAX,
} from "./observability.js";
export type {
  UsageContext,
  ErrorSource,
  ErrorKind,
  ErrorRecordArgs,
  ErrorSink,
} from "./observability.js";
export type { UsageClock } from "./observability.js";
export type {
  UsageGroupBy,
  UsageQuery,
  UsageErrorsQuery,
  UsageErrorsClearQuery,
  UsageBucket,
  UsageToolRow,
  UsageSeriesPoint,
  UsageErrors,
  UsageErrorsPage,
  UsageGroupRow,
  UsageModelSeries,
  UsageModelTotals,
  UsageModelTotal,
  UsageAgentSeries,
  UsageResponse,
  UsageGranularity,
  UsageEntitySeriesCounts,
  UsageErrorCount,
  ErrorContext,
  UsageErrorItem,
} from "./observability.js";
export { UsageService } from "./usage-service.js";
export type { PricingRates, TieredRates, PricingLookup } from "./usage-service.js";
export {
  requestCostUsd,
  requestCostParts,
  sumCostParts,
  ZERO_COST_PARTS,
  ratesAt,
} from "./usage-service.js";
export {
  formatLocalDate,
  localDateMinusDays,
  formatLocalHourKey,
  formatLocalMinuteKey,
  enumerateTsBuckets,
  localWeekStart,
  localMonthKey,
  enumerateBuckets,
} from "./dates.js";
export type { BucketGranularity } from "./dates.js";
