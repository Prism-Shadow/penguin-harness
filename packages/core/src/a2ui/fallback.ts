/**
 * Readable text for a surface that cannot render a block — the CLI, a messaging channel, a raw
 * Trace — and the plain text a rendered choice or form fills into the composer. The fill text is
 * deliberately just the answer (the option's `value`, or `label: answer` lines): the model reads
 * it next turn as ordinary user text, so nothing here is a marker the core would have to parse;
 * only the renderer reads it back, to show an answered block's answers (fill-parse.ts). A widget
 * becomes its reading as lines of text; what is live on screen (the clock's time, a countdown's
 * time left) and every relative time ("as of") is printed for one moment and zone, the call's
 * `now` and `timeZone`.
 */
import { parseA2ui } from "./catalog.js";
import { chartMarkdown } from "./chart.js";
import { scanFences, splitLines } from "./fences.js";
import { fieldRule, initialAnswer } from "./form.js";
import { detectLang } from "./lang.js";
import { metricLine } from "./metric.js";
import { resourcesMarkdown } from "./resources.js";
import type {
  A2uiCallout,
  A2uiChoice,
  A2uiClock,
  A2uiClockZone,
  A2uiCountdown,
  A2uiForm,
  A2uiFormAnswer,
  A2uiFormAnswers,
  A2uiFormField,
  A2uiLang,
  A2uiMetrics,
  A2uiSpec,
  A2uiSteps,
  A2uiWeather,
} from "./types.js";
import {
  appendUnit,
  conditionName,
  countdownParts,
  countdownText,
  formatAsOf,
  formatNumber,
  formatTemp,
  localeOf,
  parseA2uiInstant,
  weekdayOf,
  zonedParts,
} from "./widgets.js";

/** The moment and zone a widget's fallback is printed for. */
export interface A2uiFallbackContext {
  /** Default: the time of the call. */
  now?: Date;
  /** An IANA zone, the reader's; default: the runtime's. */
  timeZone?: string;
}

interface Moment {
  now: Date;
  timeZone: string | undefined;
}

const STR = {
  zh: {
    recommended: "推荐",
    multiple: "可多选。",
    replyChoice: "回复编号或直接写出你的答案。",
    replyForm: "按字段逐行回复。",
    required: "必填",
    yes: "是",
    no: "否",
    yesNo: "是 / 否",
    step: "步长",
    byDefault: (value: string) => `（默认 ${value}）`,
    colon: "：",
    sep: "、",
    stepWarning: "警告：",
    stepCaution: "注意：",
    stepNote: "说明：",
    tone: { note: "说明", tip: "提示", caution: "注意", warning: "警告" },
    high: "最高",
    low: "最低",
    feelsLike: "体感",
    humidity: "湿度",
    wind: "风",
    hourly: "逐小时：",
    daily: "未来几天：",
    precip: "降水 ",
    asOf: "数据时间",
    source: "来源：",
    localTime: "本地时间",
    left: (time: string) => `还有 ${time}`,
    reached: "已到",
  },
  en: {
    recommended: "recommended",
    multiple: "Pick all that apply.",
    replyChoice: "Reply with a number or your own answer.",
    replyForm: "Reply with one line per field.",
    required: "required",
    yes: "Yes",
    no: "No",
    yesNo: "yes / no",
    step: "step",
    byDefault: (value: string) => ` (default ${value})`,
    colon: ": ",
    sep: ", ",
    stepWarning: "WARNING:",
    stepCaution: "CAUTION:",
    stepNote: "NOTE:",
    tone: { note: "Note", tip: "Tip", caution: "Caution", warning: "Warning" },
    high: "H",
    low: "L",
    feelsLike: "Feels like",
    humidity: "Humidity",
    wind: "Wind",
    hourly: "Next hours: ",
    daily: "Next days:",
    precip: "",
    asOf: "As of",
    source: "Source: ",
    localTime: "Local time",
    left: (time: string) => `${time} left`,
    reached: "reached",
  },
} as const;

/** The separator between several picked values: 「、」 in zh, ", " in en. */
export const listSeparator = (lang: A2uiLang): string => STR[lang].sep;

/** What sits between a form field's label and its answer in the fill text: 「：」 in zh, ": " in en. */
export const answerColon = (lang: A2uiLang): string => STR[lang].colon;

/** A switch's answer as the fill text writes it: 「是」 / 「否」 in zh, "Yes" / "No" in en. */
export const switchAnswer = (on: boolean, lang: A2uiLang): string =>
  on ? STR[lang].yes : STR[lang].no;

function choiceMarkdown(spec: A2uiChoice, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out = [`**${spec.question}**`, ""];
  spec.options.forEach((option, i) => {
    let line = `${i + 1}. ${option.label}`;
    if (option.description) line += ` — ${option.description}`;
    if (option.recommended) line += lang === "zh" ? `（${t.recommended}）` : ` (${t.recommended})`;
    out.push(line);
  });
  out.push(
    "",
    spec.multiple ? `${t.multiple}${lang === "zh" ? "" : " "}${t.replyChoice}` : t.replyChoice,
  );
  return out;
}

/** What a field asks for, as the bullet's detail: its options, range, format or placeholder. */
function fieldDetail(field: A2uiFormField, lang: A2uiLang): string[] {
  const t = STR[lang];
  const detail: string[] = [];
  const rule = fieldRule(field);
  switch (field.kind) {
    case "single":
    case "multiple":
    case "select":
      detail.push((field.options ?? []).map((o) => o.label).join(" / "));
      break;
    case "number":
    case "slider": {
      // The range with its unit, spaced as every A2UI value is: "1–10 pods", "0–100%".
      const range = rule === undefined ? field.unit : appendUnit(rule, field.unit);
      if (range) detail.push(range);
      if (field.kind === "slider" && field.step !== undefined) {
        detail.push(`${t.step} ${field.step}`);
      }
      break;
    }
    case "switch":
      detail.push(t.yesNo);
      break;
    case "date":
    case "time":
    case "datetime":
      if (rule !== undefined) detail.push(rule);
      break;
  }
  if (field.placeholder && field.kind !== "select") detail.push(field.placeholder);
  return detail;
}

/** A field's default as the bullet shows it: labels, not values; yes or no; a space for `T`. */
function defaultText(field: A2uiFormField, lang: A2uiLang): string | undefined {
  if (field.default === undefined) return undefined;
  const answer = initialAnswer(field);
  if (typeof answer === "boolean") return (answer ? STR[lang].yes : STR[lang].no).toLowerCase();
  if (Array.isArray(answer)) return answer.join(listSeparator(lang));
  return field.kind === "datetime" ? answer?.replace("T", " ") : answer;
}

function formMarkdown(spec: A2uiForm, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  for (const field of spec.fields) {
    let line = `- **${field.label}**`;
    if (field.required) line += lang === "zh" ? `（${t.required}）` : ` (${t.required})`;
    const detail = fieldDetail(field, lang);
    if (detail.length > 0) line += `${t.colon}${detail.join(" ")}`;
    const fallback = defaultText(field, lang);
    if (fallback !== undefined) line += t.byDefault(fallback);
    if (field.hint) line += ` — ${field.hint}`;
    out.push(line);
  }
  out.push("", t.replyForm);
  return out;
}

function stepsMarkdown(spec: A2uiSteps, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  spec.steps.forEach((step, i) => {
    const marker = `${i + 1}. `;
    const indent = " ".repeat(marker.length);
    const parts: string[] = [];
    if (step.warning) parts.push(`**${t.stepWarning}** ${step.warning}`);
    if (step.caution) parts.push(`**${t.stepCaution}** ${step.caution}`);
    parts.push(step.text);
    if (step.note) parts.push(`**${t.stepNote}** ${step.note}`);
    if (step.code !== undefined) {
      parts.push(["```" + (step.lang ?? ""), ...step.code.split("\n"), "```"].join("\n"));
    }
    parts.forEach((part, j) => {
      const partLines = part.split("\n");
      partLines.forEach((line, k) => {
        out.push(j === 0 && k === 0 ? marker + line : indent + line);
      });
      if (j < parts.length - 1) out.push("");
    });
  });
  return out;
}

function calloutMarkdown(spec: A2uiCallout, lang: A2uiLang): string[] {
  const t = STR[lang];
  const tone = t.tone[spec.tone];
  const body = spec.text.split("\n").map((line) => `> ${line}`);
  if (spec.title) {
    return [`> **${tone}${t.colon.trim()}${lang === "zh" ? "" : " "}${spec.title}**`, ">", ...body];
  }
  const first = body[0] ?? ">";
  return [`> **${tone}${t.colon.trim()}** ${first.slice(2)}`, ...body.slice(1)];
}

/** "14:00" as written, or the HH:mm of an ISO date-time in the reader's zone. */
function hourOf(time: string, at: Moment): string {
  if (!time.includes("T")) return time;
  const instant = parseA2uiInstant(time);
  if (instant === null) return time;
  const p = zonedParts(instant, at.timeZone);
  return `${p.hour}:${p.minute}`;
}

function weatherMarkdown(spec: A2uiWeather, lang: A2uiLang, at: Moment): string[] {
  const t = STR[lang];
  const temp = (value: number): string => formatTemp(value, spec.unit, false, lang);
  const current = formatTemp(spec.temp, spec.unit, true, lang);
  const out = [`**${spec.place} · ${conditionName(spec.condition, lang)} ${current}**`];
  if (spec.summary) out.push("", spec.summary);
  const range: string[] = [];
  if (spec.high !== undefined) range.push(`${t.high} ${temp(spec.high)}`);
  if (spec.low !== undefined) range.push(`${t.low} ${temp(spec.low)}`);
  const details: string[] = [];
  if (range.length > 0) details.push(range.join(" / "));
  if (spec.feelsLike !== undefined) details.push(`${t.feelsLike} ${temp(spec.feelsLike)}`);
  if (spec.humidity !== undefined) {
    details.push(`${t.humidity} ${formatNumber(spec.humidity, lang)}%`);
  }
  if (spec.windSpeed !== undefined) {
    const speed = `${formatNumber(spec.windSpeed, lang)} ${spec.windUnit ?? "km/h"}`;
    details.push(`${t.wind} ${speed}${spec.windDirection ? ` ${spec.windDirection}` : ""}`);
  }
  if (details.length > 0) out.push("", details.join(" · "));
  if (spec.hourly) {
    const hours = spec.hourly.slice(0, 8).map((h) => `${hourOf(h.time, at)} ${temp(h.temp)}`);
    out.push("", `${t.hourly}${hours.join(" · ")}`);
  }
  if (spec.daily) {
    const p = zonedParts(at.now, at.timeZone);
    const today = `${p.year}-${p.month}-${p.day}`;
    out.push("", t.daily);
    for (const day of spec.daily) {
      const name = `${weekdayOf(day.date, lang, today)} ${conditionName(day.condition, lang)}`;
      let line = `- ${name} ${temp(day.high)} / ${temp(day.low)}`;
      if (day.precip !== undefined) line += ` · ${t.precip}${formatNumber(day.precip, lang)}%`;
      out.push(line);
    }
  }
  const foot: string[] = [];
  if (spec.asOf) foot.push(`${t.asOf} ${formatAsOf(spec.asOf, lang, at.now, at.timeZone)}`);
  if (spec.source) foot.push(`${t.source}${spec.source}`);
  if (foot.length > 0) out.push("", foot.join(" · "));
  return out;
}

function clockMarkdown(spec: A2uiClock, lang: A2uiLang, at: Moment): string[] {
  const t = STR[lang];
  const locale = localeOf(lang);
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  const hourCycle = spec.hourCycle === "12" ? "h12" : spec.hourCycle === "24" ? "h23" : undefined;
  const localZone = at.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones: A2uiClockZone[] = spec.zones ?? [{ zone: "local" }];
  for (const entry of zones) {
    const local = entry.zone === "local";
    const zone = local ? localZone : entry.zone;
    // An unlabelled zone goes by its city: "America/New_York" → "New York".
    const city = zone.slice(zone.lastIndexOf("/") + 1).replace(/_/g, " ");
    const label = entry.label ?? (local ? t.localTime : city);
    const options: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    };
    if (hourCycle !== undefined) options.hourCycle = hourCycle;
    const time = new Intl.DateTimeFormat(locale, options).format(at.now);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: zone }).format(
      at.now,
    );
    out.push(
      lang === "zh"
        ? `- ${label}：${time}（${weekday}，${zone}）`
        : `- ${label}: ${time} (${weekday}, ${zone})`,
    );
  }
  return out;
}

function countdownMarkdown(spec: A2uiCountdown, lang: A2uiLang, at: Moment): string[] {
  const t = STR[lang];
  const target = parseA2uiInstant(spec.to);
  if (target === null) return [`**${spec.label}**${t.colon}${spec.to}`];
  const parts = countdownParts(target, at.now);
  const status = parts.reached ? (spec.doneLabel ?? t.reached) : t.left(countdownText(parts, lang));
  let line = `**${spec.label}**${t.colon}${status}`;
  if (spec.showTarget !== false) {
    const p = zonedParts(target, at.timeZone);
    const stamp = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    line += lang === "zh" ? `（${stamp}）` : ` (${stamp})`;
  }
  return [line];
}

function metricsMarkdown(spec: A2uiMetrics, lang: A2uiLang): string[] {
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  for (const item of spec.items) out.push(metricLine(item, lang));
  return out;
}

/** A snapshot's lines, then the time it was read: "As of 14:05" / 「数据时间 14:05」. */
function withAsOf(lines: string[], asOf: string | undefined, lang: A2uiLang, at: Moment): string[] {
  if (!asOf) return lines;
  return [...lines, "", `${STR[lang].asOf} ${formatAsOf(asOf, lang, at.now, at.timeZone)}`];
}

/** Readable Markdown for one valid block; a widget is printed for `ctx`'s moment and zone. */
export function specToMarkdown(
  spec: A2uiSpec,
  lang: A2uiLang,
  ctx: A2uiFallbackContext = {},
): string {
  const at: Moment = { now: ctx.now ?? new Date(), timeZone: ctx.timeZone };
  switch (spec.type) {
    case "choice":
      return choiceMarkdown(spec, lang).join("\n");
    case "form":
      return formMarkdown(spec, lang).join("\n");
    case "steps":
      return stepsMarkdown(spec, lang).join("\n");
    case "callout":
      return calloutMarkdown(spec, lang).join("\n");
    case "weather":
      return weatherMarkdown(spec, lang, at).join("\n");
    case "clock":
      return clockMarkdown(spec, lang, at).join("\n");
    case "countdown":
      return countdownMarkdown(spec, lang, at).join("\n");
    case "metrics":
      return withAsOf(metricsMarkdown(spec, lang), spec.asOf, lang, at).join("\n");
    case "chart":
      return withAsOf(chartMarkdown(spec, lang), spec.asOf, lang, at).join("\n");
    case "resources":
      return withAsOf(resourcesMarkdown(spec, lang), spec.asOf, lang, at).join("\n");
  }
}

/**
 * The reply with every valid, closed ```a2ui fence replaced by readable Markdown. Mermaid fences
 * stay as they are; an invalid or unclosed block stays as its source fence (the reader still sees
 * what the model wrote). Language from `opts.lang`, else detected from the reply; widgets are
 * printed for `opts.now` in `opts.timeZone` (defaults: the time of the call, the runtime's zone).
 */
export function toFallbackMarkdown(
  markdown: string,
  opts: { lang?: A2uiLang } & A2uiFallbackContext = {},
): string {
  const lang = opts.lang ?? detectLang(markdown);
  const ctx: A2uiFallbackContext = { now: opts.now ?? new Date(), timeZone: opts.timeZone };
  const lines = splitLines(markdown);
  const out: string[] = [];
  let cursor = 0;
  for (const span of scanFences(markdown)) {
    if (span.lang !== "a2ui" || !span.closed) continue;
    const { spec } = parseA2ui(span.body.join("\n"));
    if (spec === undefined) continue;
    for (; cursor < span.startLine - 1; cursor++) out.push(lines[cursor] ?? "");
    out.push(...specToMarkdown(spec, lang, ctx).split("\n"));
    cursor = span.endLine;
  }
  for (; cursor < lines.length; cursor++) out.push(lines[cursor] ?? "");
  return out.join("\n");
}

/**
 * The text a choice fills into the composer. `picked` holds option LABELS (unique by L1); each
 * maps to the option's `value` (default: the label). A string that is not a label passes through
 * as typed, so an "Other…" answer can be given the same way. Several picks are joined with the
 * language's list separator.
 */
export function choiceFillText(spec: A2uiChoice, picked: string[], lang: A2uiLang): string {
  const byLabel = new Map(spec.options.map((o) => [o.label, o.value ?? o.label] as const));
  return picked
    .map((label) => byLabel.get(label) ?? label)
    .filter((value) => value.trim() !== "")
    .join(listSeparator(lang));
}

/** One field's answer as the fill text writes it, or undefined when the field has none. */
function fillAnswer(field: A2uiFormField, raw: A2uiFormAnswer, lang: A2uiLang): string | undefined {
  if (field.kind === "switch") {
    return typeof raw === "boolean" ? switchAnswer(raw, lang) : undefined;
  }
  if (typeof raw === "boolean") return undefined;
  const byLabel = new Map((field.options ?? []).map((o) => [o.label, o.value ?? o.label] as const));
  const parts = (Array.isArray(raw) ? raw : [raw])
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .map((value) => byLabel.get(value) ?? value);
  if (parts.length === 0) return undefined;
  const answer = parts.join(listSeparator(lang));
  if (field.kind === "number" || field.kind === "slider") return appendUnit(answer, field.unit);
  return field.kind === "datetime" ? answer.replace("T", " ") : answer;
}

/**
 * The text a form fills into the composer: one line per answered field in the form's order,
 * `label: answer` (en) / `label：answer` (zh). Answers for option fields are LABELS and map to
 * values like a choice's; several are joined with the list separator; a number or a slider gets
 * its unit; a switch is Yes or No; a datetime's `T` is a space. Text of several lines starts on
 * the next line, each line indented two spaces. A field with no answer (missing, blank text, no
 * option) fills no line; the renderer starts every field at its initial answer (initialAnswer),
 * so a switch and a slider always hold one and always fill a line.
 */
export function formFillText(spec: A2uiForm, answers: A2uiFormAnswers, lang: A2uiLang): string {
  const colon = answerColon(lang);
  const lines: string[] = [];
  for (const field of spec.fields) {
    const raw = answers[field.id];
    if (raw === undefined) continue;
    const answer = fillAnswer(field, raw, lang);
    if (answer === undefined) continue;
    if (!answer.includes("\n")) {
      lines.push(`${field.label}${colon}${answer}`);
      continue;
    }
    lines.push(`${field.label}${colon.trimEnd()}`);
    for (const line of answer.split("\n"))
      lines.push(line.trim() === "" ? "" : `  ${line.trimEnd()}`);
  }
  return lines.join("\n");
}
