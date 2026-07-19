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
  isRetryableError,
  mapThinkingLevel,
  toolDefinitionsToSchemas,
  buildUniConfig,
} from "./generative-model.js";
export { ToolCallIdAllocator, stripToolCallIdSuffix } from "./tool-call-ids.js";
