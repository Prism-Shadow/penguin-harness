/**
 * LLM interface module entry point.
 *
 * Exports `GenerativeModel` (the LLMInterface implementation), along with internal
 * pure conversion functions for unit testing (message merging, event translation,
 * token accounting, UniConfig construction, retry determination).
 */
export {
  GenerativeModel,
  EventTranslator,
  groupHistoryToUniMessages,
  mergeOmniToUniMessage,
  translateEvents,
  usageToTokenCounts,
  isMalformedJsonParseError,
  isIncompleteStreamError,
  isFatalProviderRejection,
  isAuthenticationError,
  isFastModeUnsupportedError,
  FAST_MODE_UNSUPPORTED_GUIDANCE,
  mapThinkingLevel,
  toolDefinitionsToSchemas,
  buildUniConfig,
} from "./generative-model.js";
export { listEndpointModels } from "./list-models.js";
export type { ListEndpointModelsOptions } from "./list-models.js";
export { ToolCallIdAllocator, stripToolCallIdSuffix } from "./tool-call-ids.js";
export {
  DEFAULT_CONTEXT_WINDOW,
  OUTPUT_SAFETY_MARGIN,
  MIN_OUTPUT_TOKENS,
  COMPACTION_HEADROOM,
  resolveContextWindow,
  approximateTokens,
  approximateMessagesTokens,
  effectiveMaxOutputTokens,
  effectiveMaxContextLength,
} from "./context-limits.js";
