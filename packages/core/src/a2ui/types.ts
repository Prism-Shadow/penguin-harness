/**
 * A2UI blocks: the catalog of components an assistant reply can carry as fenced JSON, and the
 * shapes the grammar module shares with its renderers, the text fallback and the checker.
 *
 * A block is a ```a2ui fence holding ONE JSON object whose `type` names a catalog entry; the
 * client draws it with its own components and theme, never with markup from the model. Markdown
 * stays the carrier, so a surface that cannot render a block still has readable text (see
 * fallback.ts), and a pick in the rendered block comes back as ordinary user text (see the
 * fill-text helpers). Nothing in this directory depends on Node except cli.ts: the same code
 * runs in the browser renderer and in the checker script bundled into the skill.
 */

export type A2uiType =
  | "choice"
  | "form"
  | "steps"
  | "callout"
  | "weather"
  | "clock"
  | "countdown"
  | "metrics"
  | "chart"
  | "resources";

export interface A2uiOption {
  label: string;
  /** What a pick fills into the composer; defaults to the label. */
  value?: string;
  description?: string;
  recommended?: boolean;
}

/** One question with 2–7 options; the pick fills the composer and ends the model's turn. */
export interface A2uiChoice {
  type: "choice";
  id?: string;
  question: string;
  options: A2uiOption[];
  multiple?: boolean;
  /** Adds an "Other…" control that clears the composer and focuses it, for the user's own answer. */
  allowOther?: boolean;
}

/** What a form field asks for; each kind has its own control and its own answer. */
export type A2uiFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "slider"
  | "single"
  | "multiple"
  | "select"
  | "switch"
  | "date"
  | "time"
  | "datetime";

/** The answer a field holds: text (and date/time strings), option labels, or a switch's state. */
export type A2uiFormAnswer = string | string[] | boolean;
export type A2uiFormAnswers = Record<string, A2uiFormAnswer>;

export interface A2uiFormField {
  /** `^[a-z][a-z0-9_]{0,31}$`, unique in the form. */
  id: string;
  /** ≤ 60. */
  label: string;
  kind: A2uiFieldKind;
  /**
   * A line under the control, ≤ 80: the format or the convention ("one per line", "in GB").
   * Also the error line when the answer breaks the field's rule. Any kind.
   */
  hint?: string;
  /** Any kind; a switch and a slider are always answered. */
  required?: boolean;
  /**
   * single, multiple: 2–7 (warn > 5); select: 2–30 (warn > 12). Required for those three, not
   * allowed elsewhere. A select ignores `description` (one-line rows).
   */
  options?: A2uiOption[];
  /** text, textarea, number; select: the words of the empty row. ≤ 80. */
  placeholder?: string;
  /** number, slider: finite, min < max; a slider requires both. */
  min?: number;
  max?: number;
  /** number, slider: > 0 (default 1). */
  step?: number;
  /** number, slider: ≤ 12, after the figure in the fill text and in the box. */
  unit?: string;
  /** text ≤ 500, textarea ≤ 2000: the answer's length ceiling (default: that ceiling). */
  maxLength?: number;
  /** text only: a JS regular expression (no flags, ≤ 120) the whole answer must match. */
  pattern?: string;
  /**
   * The starting answer, typed by kind: text/textarea/date/time/datetime a string in the field's
   * rule; number/slider a number in range; single/select an option label; multiple option labels;
   * switch a boolean. Must satisfy the field's own rule.
   */
  default?: string | number | boolean | string[];
}

/** Several questions answered at once (1–6 fields); the answers fill the composer one line per field. */
export interface A2uiForm {
  type: "form";
  id?: string;
  title?: string;
  fields: A2uiFormField[];
  submitLabel?: string;
}

export interface A2uiStep {
  text: string;
  /** Risk of irreversible loss, security or harm; rendered above the step. */
  warning?: string;
  /** Risk of breaking something recoverable; rendered above the step. */
  caution?: string;
  /** Useful information; rendered below the step. */
  note?: string;
  code?: string;
  lang?: string;
}

/** A procedure, one instruction per step (1–15 steps). */
export interface A2uiSteps {
  type: "steps";
  title?: string;
  steps: A2uiStep[];
}

export interface A2uiCallout {
  type: "callout";
  tone: "note" | "tip" | "caution" | "warning";
  title?: string;
  text: string;
}

/*
 * The widgets below are read-only snapshots the model supplies: the client fetches nothing, and
 * the only live parts are client-side time (the clock ticks, the countdown counts down). A
 * date-time field holds ISO 8601 (`2026-10-04T14:05+08:00`, `…Z`, or no offset for the viewer's
 * local time); see parseA2uiInstant in widgets.ts.
 */

export type A2uiWeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "thunder"
  | "snow"
  | "sleet"
  | "wind";

export interface A2uiWeatherHour {
  /** "HH:mm" (24 h) or an ISO date-time; the renderer shows the hour. */
  time: string;
  temp: number;
  condition?: A2uiWeatherCondition;
  /** Chance of precipitation, 0–100. */
  precip?: number;
  /** Draws the night variant of the hour's condition art. */
  night?: boolean;
}

export interface A2uiWeatherDay {
  /** "YYYY-MM-DD" (or an ISO date-time; only the date is used). */
  date: string;
  high: number;
  low: number;
  condition: A2uiWeatherCondition;
  /** Chance of precipitation, 0–100. */
  precip?: number;
}

/** Current conditions at a place, optionally with the next hours and days. A snapshot. */
export interface A2uiWeather {
  type: "weather";
  place: string;
  condition: A2uiWeatherCondition;
  temp: number;
  /** Default "C". */
  unit?: "C" | "F";
  /** Night art (moon) for clear / partly-cloudy. */
  night?: boolean;
  /** One line in the model's words. */
  summary?: string;
  high?: number;
  low?: number;
  feelsLike?: number;
  /** 0–100. */
  humidity?: number;
  /** At least 0. */
  windSpeed?: number;
  /** Default "km/h". */
  windUnit?: "km/h" | "m/s" | "mph";
  /** "NE", "东北". */
  windDirection?: string;
  /** 2–24 entries. */
  hourly?: A2uiWeatherHour[];
  /** 2–7 entries. */
  daily?: A2uiWeatherDay[];
  /** When the data was read (ISO date-time). */
  asOf?: string;
  /** Where the data came from, e.g. "Open-Meteo". */
  source?: string;
}

export interface A2uiClockZone {
  /** An IANA zone ("Asia/Shanghai") or "local" for the viewer's own. */
  zone: string;
  /** "Beijing", "北京". */
  label?: string;
}

/** The time now, in one to four zones. Live: ticks on the client. */
export interface A2uiClock {
  type: "clock";
  title?: string;
  /** 1–4 zones; omitted means one zone, "local". */
  zones?: A2uiClockZone[];
  /** Default "digital". */
  style?: "digital" | "analog" | "both";
  /** Default "auto": the interface locale decides. */
  hourCycle?: "12" | "24" | "auto";
  /** The digital figure shows seconds; default false. */
  seconds?: boolean;
  /** Shows the weekday and date under the time; default true. */
  date?: boolean;
}

/** Time left until one instant. Live: counts down on the client. */
export interface A2uiCountdown {
  type: "countdown";
  /** ISO date-time (no offset = the viewer's local time) or "YYYY-MM-DD" (local midnight). */
  to: string;
  /** What happens then. */
  label: string;
  /** Shown once the instant is reached; default: the UI's "Time's up". */
  doneLabel?: string;
  /** Shows the target date-time under the figure; default true. */
  showTarget?: boolean;
}

export type A2uiMetricKind = "reading" | "used" | "remaining" | "progress";

export interface A2uiMetric {
  label: string;
  /** Finite. */
  value: number;
  /** The whole: required for used / remaining / progress and for a ring or bar gauge. */
  max?: number;
  /** Default 0; below max. */
  min?: number;
  /**
   * reading — a measurement (CPU 37 %, load 1.2, latency 120 ms); default.
   * used — part of a whole consumed (disk 320 of 512 GB).
   * remaining — part of a whole still left (quota 1,240 of 5,000; budget ¥320 of ¥1,000).
   * progress — how far a job got (upload 63 %, 7 of 12 tasks); at value ≥ max it is done.
   */
  kind?: A2uiMetricKind;
  /** Default: progress → "bar"; max given → "ring"; else "none". ring/bar need max. */
  gauge?: "ring" | "bar" | "none";
  /** After the number: "%", "GB", "ms", "tasks". */
  unit?: string;
  /** Before the number: "¥", "$", "€". */
  prefix?: string;
  /** An integer 0–3; default: 0 for an integer value, else up to 2. */
  decimals?: number;
  /** Which way is bad. Default: remaining → "low"; everything else → "high". */
  worse?: "high" | "low";
  /** Thresholds in value units, read along `worse`: attention at warn, danger at danger. */
  warn?: number;
  danger?: number;
  /** One quiet line ("resets in 3 days"); default from the kind (metricDetail). */
  detail?: string;
  /** Change since the previous reading, in the same unit. */
  delta?: number;
  /** "vs. yesterday". */
  deltaLabel?: string;
  /** 2–60 points in the same unit, oldest first. */
  history?: number[];
}

/** A snapshot of one to eight readings. */
export interface A2uiMetrics {
  type: "metrics";
  title?: string;
  items: A2uiMetric[];
  /** When the data was read (ISO date-time). */
  asOf?: string;
}

/*
 * The basic charts: one `chart` type whose `kind` names the chart, drawn from the data the model
 * gives. The composites above and below (`metrics`, `weather`, `resources`) are built from the
 * same charts for data of a known shape; a `chart` serves data of any other shape.
 */

export type A2uiChartKind = "line" | "area" | "bar" | "pie" | "scatter" | "histogram" | "gauge";

export interface A2uiChartSeries {
  /** ≤ 40, unique in the block. */
  label: string;
  /** line/area/bar/pie/histogram: one per category (or bin); null = no reading (a gap). */
  values?: (number | null)[];
  /** scatter: 1–500 (warn > 200) finite [x, y] pairs. */
  points?: [number, number][];
}

/** One basic chart. Which fields apply depends on `kind`; a field another kind uses is ignored with a warning. */
export interface A2uiChart {
  type: "chart";
  kind: A2uiChartKind;
  /** ≤ 60. */
  title?: string;
  /** line/area/bar: the x labels; pie: the slice names. 1–60 (warn > 24); pie 2–8 (warn > 6). */
  categories?: string[];
  /** histogram: n+1 strictly ascending bin edges, 3–61; the one series has n counts ≥ 0. */
  edges?: number[];
  /** 1–6 series (warn > 4); pie and histogram: exactly 1. Not for gauge. */
  series?: A2uiChartSeries[];
  /** Axis names, ≤ 24 ("Latency", "Day"). Not for pie. */
  xLabel?: string;
  yLabel?: string;
  /**
   * Units, ≤ 12, appended to tick labels and values ("ms", "%", "GB"). `yUnit` is the values'
   * unit (pie: the slices'); `xUnit` is the numeric x axis' (scatter, histogram).
   */
  xUnit?: string;
  yUnit?: string;
  /** bar, area. */
  stacked?: boolean;
  /** bar only. */
  horizontal?: boolean;
  /** pie only. */
  donut?: boolean;
  /**
   * Value-axis range; default 0..nice(max) (line/area/scatter: the data's range when `min` is
   * given). Not for pie or gauge (a gauge's range is its `item`'s).
   */
  min?: number;
  max?: number;
  /** 0–3. Not for gauge (its `item` has its own). */
  decimals?: number;
  /** gauge only: ONE metrics item (label, value, max, kind, unit, warn/danger, delta, history…), parsed by parseMetric. */
  item?: A2uiMetric;
  /** ISO date-time; optional (data need not be a snapshot). */
  asOf?: string;
}

/*
 * The system-resource board: a snapshot of one machine, built from the basic charts — a gauge
 * tile per reading (the metrics tile), a horizontal bar per disk, a line chart of the network.
 * The model gives the readings; the thresholds that colour them are the renderer's (resources.ts).
 */

export interface A2uiResourcesCpu {
  /** 0–100. */
  percent: number;
  /** 2–60 percents, oldest first. */
  history?: number[];
  /** A whole number ≥ 1. */
  cores?: number;
}

export interface A2uiResourcesMemory {
  /** ≥ 0, ≤ total. */
  used: number;
  /** > 0. */
  total: number;
  /** Default "GB". */
  unit?: "GB" | "MB";
  /** 2–60 percents of the total, oldest first. */
  history?: number[];
}

export interface A2uiResourcesSwap {
  used: number;
  total: number;
  /** Default "GB". */
  unit?: "GB" | "MB";
}

export interface A2uiResourcesDisk {
  /** The mount point or drive, ≤ 40, unique in the block. */
  path: string;
  used: number;
  total: number;
  /** Default "GB". */
  unit?: "GB" | "TB";
}

export interface A2uiResourcesNetwork {
  unit: "KB/s" | "MB/s" | "Mbps";
  /** Received, 2–60 readings ≥ 0, oldest first. */
  rx: number[];
  /** Sent, as many readings as `rx`. */
  tx: number[];
}

export interface A2uiResourcesLoad {
  /** The 1-minute load average, ≥ 0. */
  one: number;
  five?: number;
  fifteen?: number;
  /** A whole number ≥ 1: the thresholds read the load per core. */
  cores: number;
}

/** A snapshot of one machine: at least one section. */
export interface A2uiResources {
  type: "resources";
  /** ≤ 40. */
  host?: string;
  cpu?: A2uiResourcesCpu;
  memory?: A2uiResourcesMemory;
  swap?: A2uiResourcesSwap;
  /** 1–6. */
  disks?: A2uiResourcesDisk[];
  network?: A2uiResourcesNetwork;
  load?: A2uiResourcesLoad;
  /** ≥ 0. */
  uptimeSec?: number;
  /** When the data was read (ISO date-time). */
  asOf?: string;
}

export type A2uiSpec =
  | A2uiChoice
  | A2uiForm
  | A2uiSteps
  | A2uiCallout
  | A2uiWeather
  | A2uiClock
  | A2uiCountdown
  | A2uiMetrics
  | A2uiChart
  | A2uiResources;

export type A2uiLevel = "error" | "warning";

/**
 * Which bucket of the score an issue counts toward: `l1` protocol validity (always an error),
 * `l2` task construction (block limits, cross-block heuristics; warnings). Set by checkReply;
 * absent on issues from the single-block functions.
 */
export type A2uiScope = "l1" | "l2";

export interface A2uiIssue {
  level: A2uiLevel;
  code: string;
  /** English, and ends with what to do about it: the checker prints it verbatim to the model. */
  message: string;
  /** 1-based block index (a2ui and mermaid fences counted together, in order). */
  block?: number;
  /** JSON path inside the block, e.g. `options[2].label`. */
  path?: string;
  /** 1-based line: relative to the fence body from parseA2ui/checkMermaid, absolute in the reply from checkReply. */
  line?: number;
  scope?: A2uiScope;
}

/** One fenced block found in a reply. `index` is 1-based and counts a2ui + mermaid blocks in order. */
export interface A2uiBlock {
  index: number;
  fence: "a2ui" | "mermaid";
  /** The fence body, de-indented, without the fence lines. */
  source: string;
  /** 1-based line of the opening fence. */
  startLine: number;
  /** 1-based line of the closing fence, or of the reply's last line when the fence is unclosed. */
  endLine: number;
  closed: boolean;
  /** The full info string, e.g. `a2ui json`. */
  info?: string;
}

export type A2uiLang = "zh" | "en";
export type A2uiLangOption = A2uiLang | "auto";

export interface A2uiReport {
  /** No error-level issue. */
  ok: boolean;
  blocks: Array<{ index: number; fence: "a2ui" | "mermaid"; type?: string; ok: boolean }>;
  issues: A2uiIssue[];
  /** 0–100 each; any L1 error makes `total` 0, else it is L2. See A2UI_SCORING. */
  score: { l1: number; l2: number; total: number };
  /** The language the rubric used (resolved from `auto`). */
  lang: A2uiLang;
}

/** Field limits of the catalog. Over a limit is an L1 error; past a `warn` mark is an L2 warning. */
export const A2UI_LIMITS = {
  /** `id` of a choice or form. */
  idPattern: /^[a-z][a-z0-9_-]{0,31}$/,
  /** `id` of a form field (no hyphen: it doubles as an answer key). */
  fieldIdPattern: /^[a-z][a-z0-9_]{0,31}$/,
  question: 120,
  label: 60,
  labelWarn: 40,
  value: 500,
  description: 160,
  options: { min: 2, max: 7, warn: 5 },
  fields: { min: 1, max: 6, warn: 4 },
  // form fields
  fieldHint: 80,
  selectOptions: { min: 2, max: 30, warn: 12 },
  textMaxLength: 500,
  textareaMaxLength: 2000,
  pattern: 120,
  steps: { min: 1, max: 15, warn: 10 },
  title: 80,
  placeholder: 80,
  unit: 12,
  submitLabel: 24,
  stepText: 200,
  stepCode: 2000,
  lang: 20,
  calloutText: 400,
  mermaid: { statements: 30, lines: 400 },
  // weather
  place: 60,
  summary: 80,
  source: 40,
  windDirection: 6,
  hourly: { min: 2, max: 24, warn: 12 },
  daily: { min: 2, max: 7 },
  // clock
  zones: { min: 1, max: 4 },
  zoneLabel: 24,
  zone: 64,
  clockTitle: 40,
  // countdown
  countdownLabel: 60,
  // metrics
  metricsTitle: 40,
  metrics: { min: 1, max: 8, warn: 6 },
  metricLabel: 40,
  metricDetail: 60,
  prefix: 4,
  deltaLabel: 24,
  history: { min: 2, max: 60 },
  // chart
  chartTitle: 60,
  seriesLabel: 40,
  categoryLabel: 40,
  axisLabel: 24,
  chartCategories: { min: 1, max: 60, warn: 24 },
  pieSlices: { min: 2, max: 8, warn: 6 },
  chartSeries: { min: 1, max: 6, warn: 4 },
  scatterPoints: { min: 1, max: 500, warn: 200 },
  edges: { min: 3, max: 61 },
  // resources
  host: 40,
  disks: { min: 1, max: 6 },
  diskPath: 40,
} as const;

/**
 * The score's weights, in one place so the skill can quote them. l1 is 100 or 0; l2 loses points
 * per block warning down to 0; total is 0 on any L1 error, else l2. `passTotal` is the gate the
 * skill teaches ("errors 0, total at least 70"): at most two block warnings.
 */
export const A2UI_SCORING = {
  l2PerWarning: 15,
  passTotal: 70,
} as const;
