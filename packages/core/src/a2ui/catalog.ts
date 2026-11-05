/**
 * L1 validation of one ```a2ui body: strict JSON, one object, a known `type`, then the catalog's
 * field rules (A2UI_LIMITS). Over a limit, a missing or mistyped field, a broken reference (a
 * duplicate label, two recommended options, options on a text field) is an error: the block
 * would render wrong or not at all, so the model must fix it before sending. Past a `warn` mark
 * or an unknown field is a warning: the block renders, but a reader has more to take in.
 *
 * The one leniency is a trailing comma — the most common LLM JSON slip — accepted with a warning
 * so the renderer shows the block while the checker still teaches strict JSON. Every message
 * ends with what to do, because the checker prints it to the model verbatim.
 *
 * The field readers live in fields.ts and the option list a choice and a form share in
 * options.ts. A form (form.ts), the charts and the blocks built on them have their own modules —
 * a metrics item (metric.ts, read by `metrics` and by a gauge), `chart` (chart.ts) and
 * `resources` (resources.ts) — and this file dispatches to them by `type`.
 */
import { parseChart } from "./chart.js";
import {
  ID_HINT,
  Issues,
  type Obj,
  checkHighLow,
  isObj,
  present,
  readArray,
  readBoolean,
  readEnum,
  readInstant,
  readNumber,
  readPercent,
  readString,
  unknownFields,
} from "./fields.js";
import { parseForm } from "./form.js";
import { parseMetric } from "./metric.js";
import { parseOptions } from "./options.js";
import { parseResources } from "./resources.js";
import {
  A2UI_LIMITS,
  type A2uiCallout,
  type A2uiChoice,
  type A2uiClock,
  type A2uiClockZone,
  type A2uiCountdown,
  type A2uiIssue,
  type A2uiMetric,
  type A2uiMetrics,
  type A2uiSpec,
  type A2uiStep,
  type A2uiSteps,
  type A2uiWeather,
  type A2uiWeatherCondition,
  type A2uiWeatherDay,
  type A2uiWeatherHour,
} from "./types.js";
import { parseA2uiInstant } from "./widgets.js";

export interface A2uiParseResult {
  /** Set only when there is no error-level issue. */
  spec?: A2uiSpec;
  issues: A2uiIssue[];
  /** The `type` the block named, valid or not, so a report can label an invalid block. */
  type?: string;
}

const CHOICE_FIELDS = ["type", "id", "question", "options", "multiple", "allowOther"] as const;

function parseChoice(is: Issues, obj: Obj): A2uiChoice | undefined {
  const id = readString(is, obj, "id", "", {
    max: 32,
    pattern: A2UI_LIMITS.idPattern,
    patternHint: ID_HINT,
  });
  const question = readString(is, obj, "question", "", {
    required: true,
    max: A2UI_LIMITS.question,
  });
  const options = parseOptions(is, obj, "options", "");
  const multiple = readBoolean(is, obj, "multiple", "");
  const allowOther = readBoolean(is, obj, "allowOther", "");
  unknownFields(is, obj, CHOICE_FIELDS, "", "a choice");
  if (question === undefined || options === undefined) return undefined;
  const spec: A2uiChoice = { type: "choice", question, options };
  if (id !== undefined) spec.id = id;
  if (multiple !== undefined) spec.multiple = multiple;
  if (allowOther !== undefined) spec.allowOther = allowOther;
  return spec;
}

const STEP_FIELDS = ["text", "warning", "caution", "note", "code", "lang"] as const;
const STEPS_FIELDS = ["type", "title", "steps"] as const;

function parseSteps(is: Issues, obj: Obj): A2uiSteps | undefined {
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.title });
  const raw = readArray(is, obj, "steps", "", {
    ...A2UI_LIMITS.steps,
    warnCode: "steps_too_many",
    what: "steps",
  });
  unknownFields(is, obj, STEPS_FIELDS, "", "a steps block");
  if (raw === undefined) return undefined;
  const steps: A2uiStep[] = [];
  raw.forEach((item, i) => {
    const sp = `steps[${i}]`;
    if (!isObj(item)) {
      is.error("wrong_type", `\`${sp}\` must be an object with a \`text\`.`, sp);
      return;
    }
    const text = readString(is, item, "text", sp, { required: true, max: A2UI_LIMITS.stepText });
    const warning = readString(is, item, "warning", sp, { max: A2UI_LIMITS.stepText });
    const caution = readString(is, item, "caution", sp, { max: A2UI_LIMITS.stepText });
    const note = readString(is, item, "note", sp, { max: A2UI_LIMITS.stepText });
    const code = readString(is, item, "code", sp, { max: A2UI_LIMITS.stepCode });
    const lang = readString(is, item, "lang", sp, { max: A2UI_LIMITS.lang });
    if (lang !== undefined && code === undefined) {
      is.warn("ignored_field", `\`${sp}.lang\` without \`code\` has no effect.`, `${sp}.lang`);
    }
    unknownFields(is, item, STEP_FIELDS, sp, "a step");
    if (text === undefined) return;
    const step: A2uiStep = { text };
    if (warning !== undefined) step.warning = warning;
    if (caution !== undefined) step.caution = caution;
    if (note !== undefined) step.note = note;
    if (code !== undefined) step.code = code;
    if (lang !== undefined) step.lang = lang;
    steps.push(step);
  });
  const spec: A2uiSteps = { type: "steps", steps };
  if (title !== undefined) spec.title = title;
  return spec;
}

const TONES = ["note", "tip", "caution", "warning"] as const;
const CALLOUT_FIELDS = ["type", "tone", "title", "text"] as const;

function parseCallout(is: Issues, obj: Obj): A2uiCallout | undefined {
  const tone = readEnum(is, obj, "tone", "", TONES);
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.title });
  const text = readString(is, obj, "text", "", { required: true, max: A2UI_LIMITS.calloutText });
  unknownFields(is, obj, CALLOUT_FIELDS, "", "a callout");
  if (tone === undefined || text === undefined) return undefined;
  const spec: A2uiCallout = { type: "callout", tone, text };
  if (title !== undefined) spec.title = title;
  return spec;
}

/*
 * The widgets: read-only snapshots the model supplies (weather, metrics, and in their own
 * modules chart and resources) and the two live ones that read client time (clock, countdown). A date-time must be one parseA2uiInstant reads, the
 * same function the renderers draw it with.
 */

const WEATHER_CONDITIONS: readonly A2uiWeatherCondition[] = [
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "thunder",
  "snow",
  "sleet",
  "wind",
];
const TEMP_UNITS = ["C", "F"] as const;
const WIND_UNITS = ["km/h", "m/s", "mph"] as const;
const HOUR_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_DATE = /^\d{4}-\d{2}-\d{2}/;
const HOUR_FIELDS = ["time", "temp", "condition", "precip", "night"] as const;
const DAY_FIELDS = ["date", "high", "low", "condition", "precip"] as const;
const WEATHER_FIELDS = [
  "type",
  "place",
  "condition",
  "temp",
  "unit",
  "night",
  "summary",
  "high",
  "low",
  "feelsLike",
  "humidity",
  "windSpeed",
  "windUnit",
  "windDirection",
  "hourly",
  "daily",
  "asOf",
  "source",
] as const;

function parseHour(is: Issues, item: unknown, hp: string): A2uiWeatherHour | undefined {
  if (!isObj(item)) {
    is.error("wrong_type", `\`${hp}\` must be an object with \`time\` and \`temp\`.`, hp);
    return undefined;
  }
  const time = readString(is, item, "time", hp, { required: true, max: Number.POSITIVE_INFINITY });
  if (
    time !== undefined &&
    !HOUR_TIME.test(time) &&
    !(time.includes("T") && parseA2uiInstant(time) !== null)
  ) {
    is.error(
      "invalid_format",
      `\`${hp}.time\` must be HH:mm on the 24-hour clock, such as 14:00, or an ISO 8601 date-time such as 2026-10-04T14:00+08:00.`,
      `${hp}.time`,
    );
  }
  const temp = readNumber(is, item, "temp", hp, true);
  const condition = readEnum(is, item, "condition", hp, WEATHER_CONDITIONS, false);
  const precip = readPercent(is, item, "precip", hp);
  const night = readBoolean(is, item, "night", hp);
  unknownFields(is, item, HOUR_FIELDS, hp, "an hour");
  if (time === undefined || temp === undefined) return undefined;
  const hour: A2uiWeatherHour = { time, temp };
  if (condition !== undefined) hour.condition = condition;
  if (precip !== undefined) hour.precip = precip;
  if (night !== undefined) hour.night = night;
  return hour;
}

function parseDay(is: Issues, item: unknown, dp: string): A2uiWeatherDay | undefined {
  if (!isObj(item)) {
    is.error(
      "wrong_type",
      `\`${dp}\` must be an object with \`date\`, \`high\`, \`low\` and \`condition\`.`,
      dp,
    );
    return undefined;
  }
  const date = readString(is, item, "date", dp, { required: true, max: Number.POSITIVE_INFINITY });
  if (date !== undefined && !(DAY_DATE.test(date) && parseA2uiInstant(date) !== null)) {
    is.error(
      "invalid_format",
      `\`${dp}.date\` must be a date that exists, written YYYY-MM-DD, such as 2026-10-05.`,
      `${dp}.date`,
    );
  }
  const high = readNumber(is, item, "high", dp, true);
  const low = readNumber(is, item, "low", dp, true);
  const condition = readEnum(is, item, "condition", dp, WEATHER_CONDITIONS);
  const precip = readPercent(is, item, "precip", dp);
  unknownFields(is, item, DAY_FIELDS, dp, "a day");
  checkHighLow(is, high, low, dp);
  if (date === undefined || high === undefined || low === undefined || condition === undefined) {
    return undefined;
  }
  const day: A2uiWeatherDay = { date, high, low, condition };
  if (precip !== undefined) day.precip = precip;
  return day;
}

function parseWeather(is: Issues, obj: Obj): A2uiWeather | undefined {
  const place = readString(is, obj, "place", "", { required: true, max: A2UI_LIMITS.place });
  const condition = readEnum(is, obj, "condition", "", WEATHER_CONDITIONS);
  const temp = readNumber(is, obj, "temp", "", true);
  const unit = readEnum(is, obj, "unit", "", TEMP_UNITS, false);
  const night = readBoolean(is, obj, "night", "");
  const summary = readString(is, obj, "summary", "", { max: A2UI_LIMITS.summary });
  const high = readNumber(is, obj, "high", "");
  const low = readNumber(is, obj, "low", "");
  const feelsLike = readNumber(is, obj, "feelsLike", "");
  const humidity = readPercent(is, obj, "humidity", "");
  let windSpeed = readNumber(is, obj, "windSpeed", "");
  if (windSpeed !== undefined && windSpeed < 0) {
    is.error(
      "range_invalid",
      `\`windSpeed\` is ${windSpeed}; a speed is at least 0 — put the direction in \`windDirection\`.`,
      "windSpeed",
    );
    windSpeed = undefined;
  }
  const windUnit = readEnum(is, obj, "windUnit", "", WIND_UNITS, false);
  const windDirection = readString(is, obj, "windDirection", "", {
    max: A2UI_LIMITS.windDirection,
  });
  if (!present(obj.windSpeed)) {
    for (const key of ["windUnit", "windDirection"] as const) {
      if (!present(obj[key])) continue;
      is.warn(
        "ignored_field",
        `\`${key}\` without \`windSpeed\` has no effect; add the speed or remove it.`,
        key,
      );
    }
  }
  let hourly: A2uiWeatherHour[] | undefined;
  if (present(obj.hourly)) {
    const raw = readArray(is, obj, "hourly", "", {
      ...A2UI_LIMITS.hourly,
      warnCode: "weather_hourly_long",
      warnHint: "Show the next 12 hours, or one entry every two hours.",
      what: "hours",
    });
    const list: A2uiWeatherHour[] = [];
    raw?.forEach((item, i) => {
      const hour = parseHour(is, item, `hourly[${i}]`);
      if (hour !== undefined) list.push(hour);
    });
    hourly = list;
  }
  let daily: A2uiWeatherDay[] | undefined;
  if (present(obj.daily)) {
    const raw = readArray(is, obj, "daily", "", { ...A2UI_LIMITS.daily, what: "days" });
    const list: A2uiWeatherDay[] = [];
    raw?.forEach((item, i) => {
      const day = parseDay(is, item, `daily[${i}]`);
      if (day !== undefined) list.push(day);
    });
    daily = list;
  }
  const asOf = readInstant(is, obj, "asOf", "");
  const source = readString(is, obj, "source", "", { max: A2UI_LIMITS.source });
  unknownFields(is, obj, WEATHER_FIELDS, "", "a weather block");
  checkHighLow(is, high, low, "");
  if (place === undefined || condition === undefined || temp === undefined) return undefined;
  const spec: A2uiWeather = { type: "weather", place, condition, temp };
  if (unit !== undefined) spec.unit = unit;
  if (night !== undefined) spec.night = night;
  if (summary !== undefined) spec.summary = summary;
  if (high !== undefined) spec.high = high;
  if (low !== undefined) spec.low = low;
  if (feelsLike !== undefined) spec.feelsLike = feelsLike;
  if (humidity !== undefined) spec.humidity = humidity;
  if (windSpeed !== undefined) spec.windSpeed = windSpeed;
  if (windUnit !== undefined) spec.windUnit = windUnit;
  if (windDirection !== undefined) spec.windDirection = windDirection;
  if (hourly !== undefined) spec.hourly = hourly;
  if (daily !== undefined) spec.daily = daily;
  if (asOf !== undefined) spec.asOf = asOf;
  if (source !== undefined) spec.source = source;
  return spec;
}

const CLOCK_STYLES = ["digital", "analog", "both"] as const;
const HOUR_CYCLES = ["12", "24", "auto"] as const;
const ZONE_FIELDS = ["zone", "label"] as const;
const CLOCK_FIELDS = ["type", "title", "zones", "style", "hourCycle", "seconds", "date"] as const;

/** The zone's canonical IANA name, or null when Intl does not know it. */
function canonicalZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function parseZones(is: Issues, obj: Obj): A2uiClockZone[] | undefined {
  const raw = readArray(is, obj, "zones", "", { ...A2UI_LIMITS.zones, what: "zones" });
  if (raw === undefined) return undefined;
  const zones: A2uiClockZone[] = [];
  const seen = new Map<string, number>();
  raw.forEach((item, i) => {
    const zp = `zones[${i}]`;
    if (!isObj(item)) {
      is.error("wrong_type", `\`${zp}\` must be an object with a \`zone\`.`, zp);
      return;
    }
    const zone = readString(is, item, "zone", zp, { required: true, max: A2UI_LIMITS.zone });
    const label = readString(is, item, "label", zp, { max: A2UI_LIMITS.zoneLabel });
    unknownFields(is, item, ZONE_FIELDS, zp, "a clock zone");
    if (zone === undefined) return;
    const key = zone === "local" ? zone : canonicalZone(zone);
    if (key === null) {
      is.error(
        "invalid_timezone",
        `\`${zp}.zone\` "${zone}" is not a time zone; use an IANA name such as Asia/Shanghai, or local.`,
        `${zp}.zone`,
      );
      return;
    }
    const first = seen.get(key);
    if (first !== undefined) {
      is.error(
        "duplicate_zone",
        `\`${zp}.zone\` repeats zone ${first + 1} ("${zone}"); list each zone once.`,
        `${zp}.zone`,
      );
    } else {
      seen.set(key, i);
    }
    const entry: A2uiClockZone = { zone };
    if (label !== undefined) entry.label = label;
    zones.push(entry);
  });
  return zones;
}

function parseClock(is: Issues, obj: Obj): A2uiClock | undefined {
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.clockTitle });
  const zones = present(obj.zones) ? parseZones(is, obj) : undefined;
  const style = readEnum(is, obj, "style", "", CLOCK_STYLES, false);
  const hourCycle = readEnum(is, obj, "hourCycle", "", HOUR_CYCLES, false);
  const seconds = readBoolean(is, obj, "seconds", "");
  const date = readBoolean(is, obj, "date", "");
  unknownFields(is, obj, CLOCK_FIELDS, "", "a clock");
  const spec: A2uiClock = { type: "clock" };
  if (title !== undefined) spec.title = title;
  if (zones !== undefined) spec.zones = zones;
  if (style !== undefined) spec.style = style;
  if (hourCycle !== undefined) spec.hourCycle = hourCycle;
  if (seconds !== undefined) spec.seconds = seconds;
  if (date !== undefined) spec.date = date;
  return spec;
}

const COUNTDOWN_FIELDS = ["type", "to", "label", "doneLabel", "showTarget"] as const;

function parseCountdown(is: Issues, obj: Obj): A2uiCountdown | undefined {
  const to = readInstant(is, obj, "to", "", true);
  const label = readString(is, obj, "label", "", {
    required: true,
    max: A2UI_LIMITS.countdownLabel,
  });
  const doneLabel = readString(is, obj, "doneLabel", "", { max: A2UI_LIMITS.countdownLabel });
  const showTarget = readBoolean(is, obj, "showTarget", "");
  unknownFields(is, obj, COUNTDOWN_FIELDS, "", "a countdown");
  if (to === undefined || label === undefined) return undefined;
  const spec: A2uiCountdown = { type: "countdown", to, label };
  if (doneLabel !== undefined) spec.doneLabel = doneLabel;
  if (showTarget !== undefined) spec.showTarget = showTarget;
  return spec;
}

const METRICS_FIELDS = ["type", "title", "items", "asOf"] as const;

function parseMetrics(is: Issues, obj: Obj): A2uiMetrics | undefined {
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.metricsTitle });
  const raw = readArray(is, obj, "items", "", {
    ...A2UI_LIMITS.metrics,
    warnCode: "metrics_too_many",
    warnHint: "Keep the readings that matter and say the rest in a sentence.",
    what: "items",
  });
  const asOf = readInstant(is, obj, "asOf", "");
  unknownFields(is, obj, METRICS_FIELDS, "", "a metrics block");
  if (raw === undefined) return undefined;
  const items: A2uiMetric[] = [];
  const labels = new Map<string, number>();
  raw.forEach((item, i) => {
    const metric = parseMetric(is, item, `items[${i}]`);
    if (metric === undefined) return;
    const seen = labels.get(metric.label);
    if (seen !== undefined) {
      is.error(
        "duplicate_label",
        `\`items[${i}].label\` repeats item ${seen + 1}'s label "${metric.label}"; labels must be unique.`,
        `items[${i}].label`,
      );
    } else {
      labels.set(metric.label, i);
    }
    items.push(metric);
  });
  const spec: A2uiMetrics = { type: "metrics", items };
  if (title !== undefined) spec.title = title;
  if (asOf !== undefined) spec.asOf = asOf;
  return spec;
}

/** Removes commas that sit before a closing bracket, outside strings. Reports whether any did. */
function stripTrailingCommas(text: string): { text: string; changed: boolean } {
  let out = "";
  let inString = false;
  let changed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? "")) j++;
      const next = text[j];
      if (next === "}" || next === "]") {
        changed = true;
        continue;
      }
    }
    out += ch;
  }
  return { text: out, changed };
}

/** The 1-based line of a character offset, when the JSON error names one. */
function errorLine(err: unknown, text: string): number | undefined {
  const message = err instanceof Error ? err.message : String(err);
  const m = /position (\d+)/.exec(message);
  if (!m) return undefined;
  const pos = Math.min(Number(m[1]), text.length);
  return text.slice(0, pos).split("\n").length;
}

/** Parses and validates one ```a2ui body. `spec` is set only when there is no error. */
export function parseA2ui(source: string): A2uiParseResult {
  const is = new Issues();
  const text = source.replace(/\r\n?/g, "\n");
  if (text.trim() === "") {
    is.error("empty_block", "The a2ui fence is empty; it must hold one JSON object.");
    return { issues: is.list };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const lenient = stripTrailingCommas(text);
    let recovered = false;
    if (lenient.changed) {
      try {
        data = JSON.parse(lenient.text);
        recovered = true;
      } catch {
        // Reported below from the strict parse's error.
      }
    }
    if (!recovered) {
      const detail = err instanceof Error ? err.message : String(err);
      is.error(
        "invalid_json",
        `The block is not valid JSON (${detail}). Write one strict JSON object: double quotes, no comments, no trailing commas.`,
        undefined,
        errorLine(err, text),
      );
      return { issues: is.list };
    }
    is.warn(
      "json_trailing_comma",
      "A trailing comma was tolerated this time; strict JSON has none.",
    );
  }
  if (!isObj(data)) {
    is.error(
      "not_object",
      "The block must be ONE JSON object — not an array, a string, or several objects.",
    );
    return { issues: is.list };
  }
  const type = data.type;
  if (typeof type !== "string") {
    is.error(
      "missing_type",
      "`type` is required: one of choice, form, steps, callout, weather, clock, countdown, metrics, chart, resources.",
      "type",
    );
    return { issues: is.list };
  }
  let spec: A2uiSpec | undefined;
  switch (type) {
    case "choice":
      spec = parseChoice(is, data);
      break;
    case "form":
      spec = parseForm(is, data);
      break;
    case "steps":
      spec = parseSteps(is, data);
      break;
    case "callout":
      spec = parseCallout(is, data);
      break;
    case "weather":
      spec = parseWeather(is, data);
      break;
    case "clock":
      spec = parseClock(is, data);
      break;
    case "countdown":
      spec = parseCountdown(is, data);
      break;
    case "metrics":
      spec = parseMetrics(is, data);
      break;
    case "chart":
      spec = parseChart(is, data);
      break;
    case "resources":
      spec = parseResources(is, data);
      break;
    default:
      is.error(
        "unknown_type",
        `Unknown type "${type}"; the catalog has choice, form, steps, callout, weather, clock, countdown, metrics, chart and resources.`,
        "type",
      );
      return { issues: is.list, type };
  }
  const result: A2uiParseResult = { issues: is.list, type };
  if (spec !== undefined && !is.hasError) result.spec = spec;
  return result;
}
