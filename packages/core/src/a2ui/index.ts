/**
 * `@prismshadow/penguin-core/a2ui`: the grammar of A2UI blocks — catalog types and limits, fence
 * discovery, L1 validation, the mermaid checks, the STE-lite prose lint, the whole-reply check
 * with its score, the text fallback, the composer fill texts, the self-review rubric, and the
 * pure formatting helpers the widget renderers share with the fallback. Pure TypeScript with no
 * dependencies, safe to bundle into the browser; the checker CLI (cli.ts) is the one Node-only
 * file and is not exported here.
 */
export type {
  A2uiBlock,
  A2uiCallout,
  A2uiChoice,
  A2uiClock,
  A2uiClockZone,
  A2uiCountdown,
  A2uiForm,
  A2uiFormField,
  A2uiIssue,
  A2uiLang,
  A2uiLangOption,
  A2uiLevel,
  A2uiMetric,
  A2uiMetricKind,
  A2uiMetrics,
  A2uiOption,
  A2uiReport,
  A2uiScope,
  A2uiSpec,
  A2uiStep,
  A2uiSteps,
  A2uiType,
  A2uiWeather,
  A2uiWeatherCondition,
  A2uiWeatherDay,
  A2uiWeatherHour,
} from "./types.js";
export { A2UI_LIMITS, A2UI_SCORING } from "./types.js";
export { findBlocks } from "./fences.js";
export { parseA2ui, type A2uiParseResult } from "./catalog.js";
export { MERMAID_TYPES, checkMermaid } from "./mermaid.js";
export { A2UI_VAGUE_WORDS, PROSE_LIMITS, detectLang, lintProse } from "./prose.js";
export { checkReply } from "./check.js";
export {
  choiceFillText,
  formFillText,
  listSeparator,
  specToMarkdown,
  toFallbackMarkdown,
  type A2uiFallbackContext,
} from "./fallback.js";
export {
  conditionName,
  countdownParts,
  countdownText,
  formatAsOf,
  formatDelta,
  formatMetricValue,
  formatNumber,
  formatTemp,
  localeOf,
  metricDetail,
  parseA2uiInstant,
  resolveMetric,
  weekdayOf,
  type A2uiCountdownParts,
  type A2uiLocale,
  type A2uiResolvedMetric,
} from "./widgets.js";
export { A2UI_RUBRIC } from "./rubric.js";
export { formatReport } from "./report.js";
