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
  mergeRecordsToUniMessage,
  translateEvents,
  usageToTokenCounts,
  isUnusableResponseError,
  isFatalProviderRejection,
  isRateLimitError,
  isAuthenticationError,
  isFastModeUnsupportedError,
  FAST_MODE_UNSUPPORTED_GUIDANCE,
  mapThinkingLevel,
  toolDefinitionsToSchemas,
  buildUniConfig,
} from "./generative-model.js";
export { APP_URL, attributionHeaders } from "./app-attribution.js";
export { listEndpointModels } from "./list-models.js";
export { ModelCredentialError } from "./model-client.js";
export type { ListEndpointModelsOptions } from "./list-models.js";
export { ToolCallIdAllocator, stripToolCallIdSuffix } from "./tool-call-ids.js";
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_CONTEXT_LENGTH,
  OUTPUT_SAFETY_MARGIN,
  MIN_OUTPUT_TOKENS,
  COMPACTION_HEADROOM,
  resolveContextWindow,
  approximateTokens,
  approximateMessagesTokens,
  effectiveMaxOutputTokens,
  effectiveMaxContextLength,
} from "./context-limits.js";
