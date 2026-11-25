/**
 * The traces domain as a library package: the TraceIndexStore mechanism (the storage
 * contract the trace-index repo implements) and the trace reading/writing interfaces the
 * server's trace service implements. One package, no server dependencies. The repo takes
 * the Db capability from @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the contracts.
 * - `./trace` - the contracts module on its own.
 * - `./repos` - the trace-index storing component.
 */
export * from "./trace.js";
export * from "./ports.js";
export { TraceIndexService, traceFilePath } from "./trace-index.js";
export {
  TraceService,
  MESSAGES_PAGE_MAX_BYTES,
  rewriteSummaryPaths,
  toolExecutionInterval,
} from "./trace-service.js";
export type { TraceSessionIndex } from "./trace-service.js";
export { sessionIdCreatedAt } from "./session-id.js";
export { fallbackTitle } from "./titles.js";
export {
  requestCostUsd,
  ZERO_COST_PARTS,
  requestCostParts,
  sumCostParts,
  ratesAt,
} from "./cost.js";
export type { PricingLookup } from "./cost.js";
export { formatLocalDate } from "./dates.js";
