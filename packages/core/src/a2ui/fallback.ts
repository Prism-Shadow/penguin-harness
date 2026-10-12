/**
 * Readable text for a surface that cannot render a block — the CLI, a messaging channel, a raw
 * Trace — and the plain text a rendered choice or form fills into the composer. The fill text is
 * deliberately just the answer (the option's `value`, or `label: answer` lines): the model reads
 * it next turn as ordinary user text, so nothing here is a marker the core would have to parse.
 * A widget becomes its reading as lines of text; what is live on screen (the clock's time, a
 * countdown's time left) and every relative time ("as of") is printed for one moment and zone,
 * the call's `now` and `timeZone`.
 */
import { parseA2ui } from "./catalog.js";
import { scanFences, splitLines } from "./fences.js";
import { detectLang } from "./prose.js";
import type {
  A2uiCallout,
  A2uiChoice,
  A2uiClock,
  A2uiClockZone,
  A2uiCountdown,
  A2uiForm,
  A2uiLang,
  A2uiMetrics,
  A2uiSpec,
  A2uiSteps,
  A2uiWeather,
} from "./types.js";
import {
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
    metricTone: { attention: "注意", danger: "警告", done: "已完成" },
  },
  en: {
    recommended: "recommended",
    multiple: "Pick all that apply.",
    replyChoice: "Reply with a number or your own answer.",
    replyForm: "Reply with one line per field.",
    required: "required",
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
    metricTone: { attention: "warning", danger: "critical", done: "done" },
  },
} as const;

/** The separator between several picked values: 「、」 in zh, ", " in en. */
export const listSeparator = (lang: A2uiLang): string => STR[lang].sep;

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

function formMarkdown(spec: A2uiForm, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  for (const field of spec.fields) {
    let line = `- **${field.label}**`;
    if (field.required) line += lang === "zh" ? `（${t.required}）` : ` (${t.required})`;
    const detail: string[] = [];
    if (field.options) detail.push(field.options.map((o) => o.label).join(" / "));
    if (field.kind === "number") {
      if (field.min !== undefined && field.max !== undefined)
        detail.push(`${field.min}–${field.max}`);
      else if (field.min !== undefined) detail.push(`≥ ${field.min}`);
      else if (field.max !== undefined) detail.push(`≤ ${field.max}`);
      if (field.unit) detail.push(field.unit);
    }
    if (field.placeholder && (field.kind === "text" || field.kind === "number")) {
      detail.push(field.placeholder);
    }
    if (detail.length > 0) line += `${t.colon}${detail.join(" ")}`;
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

function metricsMarkdown(spec: A2uiMetrics, lang: A2uiLang, at: Moment): string[] {
  const t = STR[lang];
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  for (const item of spec.items) {
    let line = `- ${item.label}${t.colon}${formatMetricValue(item, lang)}`;
    const detail = item.detail ?? metricDetail(item, lang);
    if (detail !== undefined) line += ` — ${detail}`;
    const delta = formatDelta(item, lang);
    if (delta !== undefined) {
      const change = item.deltaLabel ? `${delta} ${item.deltaLabel}` : delta;
      line += lang === "zh" ? `（${change}）` : ` (${change})`;
    }
    const { tone } = resolveMetric(item);
    if (tone !== undefined) line += ` — ${t.metricTone[tone]}`;
    out.push(line);
  }
  if (spec.asOf) {
    out.push("", `${t.asOf} ${formatAsOf(spec.asOf, lang, at.now, at.timeZone)}`);
  }
  return out;
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
      return metricsMarkdown(spec, lang, at).join("\n");
  }
}

/**
 * The reply with every valid, closed ```a2ui fence replaced by readable Markdown. Mermaid fences
 * stay as they are; an invalid or unclosed block stays as its source fence (the reader still sees
 * what the model wrote). Language from `opts.lang`, else detected from the prose; widgets are
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

/**
 * The text a form fills into the composer: one line per answered field in the form's order,
 * `label: answer` (en) / `label：answer` (zh). Answers for option fields are LABELS and map to
 * values like a choice's; several are joined with the list separator; a number gets its unit.
 * Unanswered fields (missing, empty, or an empty list) produce no line.
 */
export function formFillText(
  spec: A2uiForm,
  answers: Record<string, string | string[]>,
  lang: A2uiLang,
): string {
  const lines: string[] = [];
  for (const field of spec.fields) {
    const raw = answers[field.id];
    if (raw === undefined) continue;
    const byLabel = new Map(
      (field.options ?? []).map((o) => [o.label, o.value ?? o.label] as const),
    );
    const parts = (Array.isArray(raw) ? raw : [raw])
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .map((value) => byLabel.get(value) ?? value);
    if (parts.length === 0) continue;
    let answer = parts.join(listSeparator(lang));
    if (field.kind === "number" && field.unit) answer = `${answer} ${field.unit}`;
    lines.push(`${field.label}${STR[lang].colon}${answer}`);
  }
  return lines.join("\n");
}
