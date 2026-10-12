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
 */
import {
  A2UI_LIMITS,
  type A2uiCallout,
  type A2uiChoice,
  type A2uiClock,
  type A2uiClockZone,
  type A2uiCountdown,
  type A2uiForm,
  type A2uiFormField,
  type A2uiIssue,
  type A2uiMetric,
  type A2uiMetricKind,
  type A2uiMetrics,
  type A2uiOption,
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

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
const length = (s: string): number => [...s].length;

class Issues {
  readonly list: A2uiIssue[] = [];

  error(code: string, message: string, path?: string, line?: number): void {
    this.push("error", code, message, path, line);
  }

  warn(code: string, message: string, path?: string): void {
    this.push("warning", code, message, path);
  }

  get hasError(): boolean {
    return this.list.some((issue) => issue.level === "error");
  }

  private push(
    level: A2uiIssue["level"],
    code: string,
    message: string,
    path?: string,
    line?: number,
  ): void {
    const issue: A2uiIssue = { level, code, message };
    if (path !== undefined) issue.path = path;
    if (line !== undefined) issue.line = line;
    this.list.push(issue);
  }
}

interface StringRule {
  required?: boolean;
  max: number;
  pattern?: RegExp;
  patternHint?: string;
}

function readString(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: StringRule,
): string | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    if (rule.required) is.error("missing_field", `\`${p}\` is required.`, p);
    return undefined;
  }
  if (typeof value !== "string") {
    is.error("wrong_type", `\`${p}\` must be a string.`, p);
    return undefined;
  }
  if (value.trim() === "") {
    if (rule.required) {
      is.error("empty_string", `\`${p}\` is empty; write the text or drop the block.`, p);
    }
    return undefined;
  }
  const n = length(value);
  if (n > rule.max) {
    is.error(
      "too_long",
      `\`${p}\` is ${n} characters; the limit is ${rule.max}. Shorten it or move the detail into the prose.`,
      p,
    );
  }
  if (rule.pattern && !rule.pattern.test(value)) {
    is.error(
      "invalid_format",
      `\`${p}\` must match ${rule.pattern.source}${rule.patternHint ? ` (${rule.patternHint})` : ""}.`,
      p,
    );
  }
  return value;
}

function readBoolean(is: Issues, obj: Obj, key: string, path: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    is.error("wrong_type", `\`${join(path, key)}\` must be true or false.`, join(path, key));
    return undefined;
  }
  return value;
}

function readNumber(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  required = false,
): number | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    if (required) is.error("missing_field", `\`${p}\` is required: a number.`, p);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    is.error("wrong_type", `\`${p}\` must be a number.`, p);
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  values: readonly T[],
  required = true,
): T | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    if (required) {
      is.error("missing_field", `\`${p}\` is required: one of ${values.join(", ")}.`, p);
    }
    return undefined;
  }
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    is.error("invalid_enum", `\`${p}\` must be one of ${values.join(", ")}.`, p);
    return undefined;
  }
  return value as T;
}

interface CountRule {
  min: number;
  max: number;
  warn?: number;
  warnCode?: string;
  /** Appended to the warning: what to do about it. */
  warnHint?: string;
  what: string;
}

function readArray(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: CountRule,
): unknown[] | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    is.error("missing_field", `\`${p}\` is required.`, p);
    return undefined;
  }
  if (!Array.isArray(value)) {
    is.error("wrong_type", `\`${p}\` must be an array.`, p);
    return undefined;
  }
  if (value.length < rule.min || value.length > rule.max) {
    is.error(
      "count_out_of_range",
      `\`${p}\` has ${value.length} ${rule.what}; allowed ${rule.min}–${rule.max}. ${value.length < rule.min ? "Add more, or answer in prose." : "Cut to the realistic ones, or split into two turns."}`,
      p,
    );
  } else if (rule.warn !== undefined && rule.warnCode && value.length > rule.warn) {
    is.warn(
      rule.warnCode,
      `\`${p}\` has ${value.length} ${rule.what}; more than ${rule.warn} is hard to take in at a glance.${rule.warnHint ? ` ${rule.warnHint}` : ""}`,
      p,
    );
  }
  return value;
}

function unknownFields(is: Issues, obj: Obj, known: readonly string[], path: string, what: string) {
  for (const key of Object.keys(obj)) {
    if (known.includes(key)) continue;
    const p = join(path, key);
    is.warn("unknown_field", `\`${p}\` is not a field of ${what}; it is ignored.`, p);
  }
}

const OPTION_FIELDS = ["label", "value", "description", "recommended"] as const;

function parseOptions(is: Issues, obj: Obj, key: string, path: string): A2uiOption[] | undefined {
  const raw = readArray(is, obj, key, path, {
    ...A2UI_LIMITS.options,
    warnCode: "too_many_options",
    what: "options",
  });
  if (raw === undefined) return undefined;
  const p = join(path, key);
  const options: A2uiOption[] = [];
  const labels = new Map<string, number>();
  let recommended = 0;
  raw.forEach((item, i) => {
    const ip = `${p}[${i}]`;
    if (!isObj(item)) {
      is.error("wrong_type", `\`${ip}\` must be an object with a \`label\`.`, ip);
      return;
    }
    const label = readString(is, item, "label", ip, { required: true, max: A2UI_LIMITS.label });
    const value = readString(is, item, "value", ip, { max: A2UI_LIMITS.value });
    const description = readString(is, item, "description", ip, {
      max: A2UI_LIMITS.description,
    });
    const rec = readBoolean(is, item, "recommended", ip);
    unknownFields(is, item, OPTION_FIELDS, ip, "an option");
    if (rec === true) recommended++;
    if (label === undefined) return;
    if (length(label) > A2UI_LIMITS.labelWarn) {
      is.warn(
        "option_label_long",
        `\`${ip}.label\` is longer than ${A2UI_LIMITS.labelWarn} characters; keep labels short and put the detail in \`description\`.`,
        `${ip}.label`,
      );
    }
    const seen = labels.get(label);
    if (seen !== undefined) {
      is.error(
        "duplicate_label",
        `\`${ip}.label\` repeats option ${seen + 1}'s label "${label}"; labels must be unique.`,
        `${ip}.label`,
      );
    } else {
      labels.set(label, i);
    }
    const option: A2uiOption = { label };
    if (value !== undefined) option.value = value;
    if (description !== undefined) option.description = description;
    if (rec !== undefined) option.recommended = rec;
    options.push(option);
  });
  if (recommended > 1) {
    is.error(
      "multiple_recommended",
      `\`${p}\` marks ${recommended} options as recommended; at most one may be.`,
      p,
    );
  }
  return options;
}

const ID_HINT = "lower-case letters, digits, _ or -, starting with a letter, at most 32";

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

const FIELD_KINDS = ["single", "multiple", "text", "number"] as const;
const FIELD_FIELDS = [
  "id",
  "label",
  "kind",
  "options",
  "placeholder",
  "min",
  "max",
  "step",
  "unit",
  "required",
] as const;
const NUMBER_ONLY = ["min", "max", "step", "unit"] as const;
const FORM_FIELDS = ["type", "id", "title", "fields", "submitLabel"] as const;

function parseFormField(is: Issues, item: unknown, fp: string): A2uiFormField | undefined {
  if (!isObj(item)) {
    is.error("wrong_type", `\`${fp}\` must be an object with \`id\`, \`label\` and \`kind\`.`, fp);
    return undefined;
  }
  const id = readString(is, item, "id", fp, {
    required: true,
    max: 32,
    pattern: A2UI_LIMITS.fieldIdPattern,
    patternHint: "lower-case letters, digits or _, starting with a letter, at most 32",
  });
  const label = readString(is, item, "label", fp, { required: true, max: A2UI_LIMITS.label });
  const kind = readEnum(is, item, "kind", fp, FIELD_KINDS);
  const hasOptions = item.options !== undefined && item.options !== null;
  let options: A2uiOption[] | undefined;
  if (kind === "single" || kind === "multiple") {
    if (!hasOptions) {
      is.error(
        "options_required",
        `\`${fp}.options\` is required for kind "${kind}".`,
        `${fp}.options`,
      );
    } else {
      options = parseOptions(is, item, "options", fp);
    }
  } else if (kind !== undefined && hasOptions) {
    is.error(
      "options_forbidden",
      `\`${fp}.options\` is not allowed for kind "${kind}"; use kind "single" or "multiple" to offer options.`,
      `${fp}.options`,
    );
  }
  const placeholder = readString(is, item, "placeholder", fp, { max: A2UI_LIMITS.placeholder });
  if (placeholder !== undefined && (kind === "single" || kind === "multiple")) {
    is.warn(
      "ignored_field",
      `\`${fp}.placeholder\` has no effect on kind "${kind}"; it is ignored.`,
      `${fp}.placeholder`,
    );
  }
  const min = readNumber(is, item, "min", fp);
  const max = readNumber(is, item, "max", fp);
  const step = readNumber(is, item, "step", fp);
  const unit = readString(is, item, "unit", fp, { max: A2UI_LIMITS.unit });
  if (kind !== undefined && kind !== "number") {
    for (const key of NUMBER_ONLY) {
      if (item[key] !== undefined && item[key] !== null) {
        is.error(
          "number_only",
          `\`${fp}.${key}\` is only valid for kind "number"; remove it or change the kind.`,
          `${fp}.${key}`,
        );
      }
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    is.error("range_invalid", `\`${fp}\`: min ${min} is greater than max ${max}.`, `${fp}.min`);
  }
  if (step !== undefined && step <= 0) {
    is.error("range_invalid", `\`${fp}.step\` must be greater than 0.`, `${fp}.step`);
  }
  const required = readBoolean(is, item, "required", fp);
  unknownFields(is, item, FIELD_FIELDS, fp, "a form field");
  if (id === undefined || label === undefined || kind === undefined) return undefined;
  const field: A2uiFormField = { id, label, kind };
  if (options !== undefined) field.options = options;
  if (placeholder !== undefined) field.placeholder = placeholder;
  if (min !== undefined) field.min = min;
  if (max !== undefined) field.max = max;
  if (step !== undefined) field.step = step;
  if (unit !== undefined) field.unit = unit;
  if (required !== undefined) field.required = required;
  return field;
}

function parseForm(is: Issues, obj: Obj): A2uiForm | undefined {
  const id = readString(is, obj, "id", "", {
    max: 32,
    pattern: A2UI_LIMITS.idPattern,
    patternHint: ID_HINT,
  });
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.title });
  const raw = readArray(is, obj, "fields", "", {
    ...A2UI_LIMITS.fields,
    warnCode: "form_too_many_fields",
    what: "fields",
  });
  const submitLabel = readString(is, obj, "submitLabel", "", { max: A2UI_LIMITS.submitLabel });
  unknownFields(is, obj, FORM_FIELDS, "", "a form");
  if (raw === undefined) return undefined;
  const fields: A2uiFormField[] = [];
  const ids = new Map<string, number>();
  raw.forEach((item, i) => {
    const field = parseFormField(is, item, `fields[${i}]`);
    if (field === undefined) return;
    const seen = ids.get(field.id);
    if (seen !== undefined) {
      is.error(
        "duplicate_id",
        `\`fields[${i}].id\` repeats field ${seen + 1}'s id "${field.id}"; ids must be unique.`,
        `fields[${i}].id`,
      );
    } else {
      ids.set(field.id, i);
    }
    fields.push(field);
  });
  const spec: A2uiForm = { type: "form", fields };
  if (id !== undefined) spec.id = id;
  if (title !== undefined) spec.title = title;
  if (submitLabel !== undefined) spec.submitLabel = submitLabel;
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
 * The widgets: read-only snapshots the model supplies (weather, metrics) and the two live ones
 * that read client time (clock, countdown). A date-time must be one parseA2uiInstant reads, the
 * same function the renderers draw it with.
 */

const present = (value: unknown): boolean => value !== undefined && value !== null;

/** A string field holding an instant: ISO 8601, or a date for local midnight. */
function readInstant(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  required = false,
): string | undefined {
  const value = readString(is, obj, key, path, { required, max: Number.POSITIVE_INFINITY });
  if (value === undefined || parseA2uiInstant(value) !== null) return value;
  const p = join(path, key);
  is.error(
    "invalid_datetime",
    `\`${p}\` is "${value}", not a date-time; write ISO 8601 such as 2026-10-04T14:05+08:00 (Z or an offset; without one it is the viewer's local time), or 2026-10-04 for local midnight.`,
    p,
  );
  return undefined;
}

function readPercent(is: Issues, obj: Obj, key: string, path: string): number | undefined {
  const value = readNumber(is, obj, key, path);
  if (value === undefined || (value >= 0 && value <= 100)) return value;
  const p = join(path, key);
  is.error("range_invalid", `\`${p}\` is ${value}; a percentage is 0–100. Fix the value.`, p);
  return undefined;
}

/** Reports `high` below `low`; the two are read together on the block and on every day. */
function checkHighLow(
  is: Issues,
  high: number | undefined,
  low: number | undefined,
  path: string,
): void {
  if (high === undefined || low === undefined || high >= low) return;
  const p = join(path, "high");
  is.error(
    "range_invalid",
    `\`${p}\` ${high} is below \`${join(path, "low")}\` ${low}; swap them or fix the values.`,
    p,
  );
}

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

const METRIC_KINDS: readonly A2uiMetricKind[] = ["reading", "used", "remaining", "progress"];
const GAUGES = ["ring", "bar", "none"] as const;
const DIRECTIONS = ["high", "low"] as const;
const METRIC_FIELDS = [
  "label",
  "value",
  "max",
  "min",
  "kind",
  "gauge",
  "unit",
  "prefix",
  "decimals",
  "worse",
  "warn",
  "danger",
  "detail",
  "delta",
  "deltaLabel",
  "history",
] as const;
const METRICS_FIELDS = ["type", "title", "items", "asOf"] as const;

function readHistory(is: Issues, item: Obj, mp: string): number[] | undefined {
  const raw = readArray(is, item, "history", mp, { ...A2UI_LIMITS.history, what: "points" });
  if (raw === undefined) return undefined;
  const points: number[] = [];
  raw.forEach((point, i) => {
    if (typeof point === "number" && Number.isFinite(point)) {
      points.push(point);
      return;
    }
    const pp = `${mp}.history[${i}]`;
    is.error("wrong_type", `\`${pp}\` must be a number; leave out a reading you do not have.`, pp);
  });
  return points;
}

function parseMetric(is: Issues, item: unknown, mp: string): A2uiMetric | undefined {
  if (!isObj(item)) {
    is.error("wrong_type", `\`${mp}\` must be an object with a \`label\` and a \`value\`.`, mp);
    return undefined;
  }
  const label = readString(is, item, "label", mp, {
    required: true,
    max: A2UI_LIMITS.metricLabel,
  });
  const value = readNumber(is, item, "value", mp, true);
  const max = readNumber(is, item, "max", mp);
  const min = readNumber(is, item, "min", mp);
  const kind = readEnum(is, item, "kind", mp, METRIC_KINDS, false);
  const gauge = readEnum(is, item, "gauge", mp, GAUGES, false);
  const unit = readString(is, item, "unit", mp, { max: A2UI_LIMITS.unit });
  const prefix = readString(is, item, "prefix", mp, { max: A2UI_LIMITS.prefix });
  const decimals = readNumber(is, item, "decimals", mp);
  const worse = readEnum(is, item, "worse", mp, DIRECTIONS, false);
  const warn = readNumber(is, item, "warn", mp);
  const danger = readNumber(is, item, "danger", mp);
  const detail = readString(is, item, "detail", mp, { max: A2UI_LIMITS.metricDetail });
  const delta = readNumber(is, item, "delta", mp);
  const deltaLabel = readString(is, item, "deltaLabel", mp, { max: A2UI_LIMITS.deltaLabel });
  const history = present(item.history) ? readHistory(is, item, mp) : undefined;
  unknownFields(is, item, METRIC_FIELDS, mp, "a metric");

  if (!present(item.max)) {
    if (kind === "used" || kind === "remaining" || kind === "progress") {
      is.error(
        "missing_field",
        `\`${mp}.max\` is required for kind "${kind}"; add the whole the value is a part of.`,
        `${mp}.max`,
      );
    } else if (gauge === "ring" || gauge === "bar") {
      is.error(
        "missing_field",
        `\`${mp}.max\` is required for a ${gauge} gauge; add it, or set gauge "none".`,
        `${mp}.max`,
      );
    }
  }
  if (max !== undefined && (min ?? 0) >= max) {
    is.error(
      "range_invalid",
      `\`${mp}\`: max ${max} is not above min ${min ?? "0 (the default)"}; fix the range.`,
      min !== undefined ? `${mp}.min` : `${mp}.max`,
    );
  }
  if (decimals !== undefined && !(Number.isInteger(decimals) && decimals >= 0 && decimals <= 3)) {
    is.error(
      "range_invalid",
      `\`${mp}.decimals\` is ${decimals}; use a whole number from 0 to 3.`,
      `${mp}.decimals`,
    );
  }
  if (warn !== undefined && danger !== undefined) {
    const direction = worse ?? (kind === "remaining" ? "low" : "high");
    const why = worse === undefined ? ` (the default for kind "${kind ?? "reading"}")` : "";
    if (direction === "high" && warn > danger) {
      is.error(
        "range_invalid",
        `\`${mp}\`: warn ${warn} is above danger ${danger}, but worse is "high"${why} — a higher value is worse, so warn must be at most danger. Swap them, or set worse to "low".`,
        `${mp}.warn`,
      );
    } else if (direction === "low" && warn < danger) {
      is.error(
        "range_invalid",
        `\`${mp}\`: warn ${warn} is below danger ${danger}, but worse is "low"${why} — a lower value is worse, so warn must be at least danger. Swap them, or set worse to "high".`,
        `${mp}.warn`,
      );
    }
  }
  if (deltaLabel !== undefined && !present(item.delta)) {
    is.warn(
      "ignored_field",
      `\`${mp}.deltaLabel\` without \`delta\` has no effect; add the change or remove the label.`,
      `${mp}.deltaLabel`,
    );
  }
  if (label === undefined || value === undefined) return undefined;
  const metric: A2uiMetric = { label, value };
  if (max !== undefined) metric.max = max;
  if (min !== undefined) metric.min = min;
  if (kind !== undefined) metric.kind = kind;
  if (gauge !== undefined) metric.gauge = gauge;
  if (unit !== undefined) metric.unit = unit;
  if (prefix !== undefined) metric.prefix = prefix;
  if (decimals !== undefined) metric.decimals = decimals;
  if (worse !== undefined) metric.worse = worse;
  if (warn !== undefined) metric.warn = warn;
  if (danger !== undefined) metric.danger = danger;
  if (detail !== undefined) metric.detail = detail;
  if (delta !== undefined) metric.delta = delta;
  if (deltaLabel !== undefined) metric.deltaLabel = deltaLabel;
  if (history !== undefined) metric.history = history;
  return metric;
}

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
      "`type` is required: one of choice, form, steps, callout, weather, clock, countdown, metrics.",
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
    default:
      is.error(
        "unknown_type",
        `Unknown type "${type}"; the catalog has choice, form, steps, callout, weather, clock, countdown and metrics.`,
        "type",
      );
      return { issues: is.list, type };
  }
  const result: A2uiParseResult = { issues: is.list, type };
  if (spec !== undefined && !is.hasError) result.spec = spec;
  return result;
}
