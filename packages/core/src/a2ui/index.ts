/**
 * `@prismshadow/penguin-core/a2ui`: the grammar of A2UI blocks — catalog types and limits, fence
 * discovery, L1 validation, a form field's answer rule, the mermaid checks, the whole-reply check
 * with its score, the reply's language, the text fallback, the composer fill texts and their
 * inverse (an answered block's answers read back from the message), the self-review rubric, and
 * the pure helpers the renderers share with the fallback (formatting, a series' extent, the
 * resource board's tiles and judgement). Pure TypeScript with no dependencies, safe to bundle
 * into the browser; the checker CLI (cli.ts) is the one Node-only file and is not exported here.
 */
export type {
  A2uiBlock,
  A2uiCallout,
  A2uiChart,
  A2uiChartKind,
  A2uiChartSeries,
  A2uiChoice,
  A2uiClock,
  A2uiClockZone,
  A2uiCountdown,
  A2uiFieldKind,
  A2uiForm,
  A2uiFormAnswer,
  A2uiFormAnswers,
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
  A2uiResources,
  A2uiResourcesCpu,
  A2uiResourcesDisk,
  A2uiResourcesLoad,
  A2uiResourcesMemory,
  A2uiResourcesNetwork,
  A2uiResourcesSwap,
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
export {
  A2UI_FIELD_FORMATS,
  fieldProblem,
  fieldRule,
  initialAnswer,
  type A2uiFieldProblem,
  type A2uiFieldProblemCode,
} from "./form.js";
export { A2UI_CHART_KINDS, seriesExtent, type A2uiExtent } from "./chart.js";
export {
  resolveResources,
  resourcesTiles,
  type A2uiResolvedDisk,
  type A2uiResolvedResources,
  type A2uiResourceKey,
  type A2uiResourceTile,
  type A2uiResourceTone,
} from "./resources.js";
export { MERMAID_TYPES, checkMermaid } from "./mermaid.js";
export { detectLang } from "./lang.js";
export { checkReply } from "./check.js";
export {
  choiceFillText,
  formFillText,
  listSeparator,
  specToMarkdown,
  toFallbackMarkdown,
  type A2uiFallbackContext,
} from "./fallback.js";
export { parseChoicePick, parseFormFill } from "./fill-parse.js";
export {
  conditionName,
  countdownParts,
  countdownText,
  formatAsOf,
  formatDelta,
  formatMetricValue,
  formatNumber,
  formatTemp,
  formatValue,
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
