/**
 * One metrics item — a reading against an optional whole, with thresholds — as the grammar reads
 * it and as text prints it. A `metrics` block is a grid of these, a `chart` of kind `gauge` is
 * one, and a `resources` block turns its sections into them; all three parse through parseMetric
 * and print through metricLine, so a reading reads the same wherever it appears.
 */
import {
  Issues,
  type Obj,
  isObj,
  present,
  readArray,
  readEnum,
  readNumber,
  readString,
  unknownFields,
} from "./fields.js";
import { A2UI_LIMITS, type A2uiLang, type A2uiMetric, type A2uiMetricKind } from "./types.js";
import { formatDelta, formatMetricValue, metricDetail, resolveMetric } from "./widgets.js";

const METRIC_KINDS: readonly A2uiMetricKind[] = ["reading", "used", "remaining", "progress"];
const GAUGES = ["ring", "bar", "none"] as const;
const DIRECTIONS = ["high", "low"] as const;
export const METRIC_FIELDS = [
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

/** Reads one metrics item at `mp` (`items[2]`, `item`). Undefined when the label or value is unusable. */
export function parseMetric(is: Issues, item: unknown, mp: string): A2uiMetric | undefined {
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

const LINE = {
  zh: { colon: "：", tone: { attention: "注意", danger: "警告", done: "已完成" } },
  en: { colon: ": ", tone: { attention: "warning", danger: "critical", done: "done" } },
} as const;

/**
 * One metrics item as a bullet: its value, its detail (the item's own, else the kind's default),
 * its change, and a word for its tone — `- Memory: 13.9 GB — 13.9 / 16 GB used (+0.4 GB) — warning`.
 */
export function metricLine(item: A2uiMetric, lang: A2uiLang): string {
  const t = LINE[lang];
  let line = `- ${item.label}${t.colon}${formatMetricValue(item, lang)}`;
  const detail = item.detail ?? metricDetail(item, lang);
  if (detail !== undefined) line += ` — ${detail}`;
  const delta = formatDelta(item, lang);
  if (delta !== undefined) {
    const change = item.deltaLabel ? `${delta} ${item.deltaLabel}` : delta;
    line += lang === "zh" ? `（${change}）` : ` (${change})`;
  }
  const { tone } = resolveMetric(item);
  if (tone !== undefined) line += ` — ${t.tone[tone]}`;
  return line;
}
