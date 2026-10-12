/**
 * A metrics widget: one to eight readings as tiles — a measurement (CPU 37 %), a share of a whole
 * used (disk 320 of 512 GB) or left (a quota, a budget), or how far a job got — each its label,
 * its number large, and what the model gave it: a ring or a bar for a reading out of a whole, the
 * change since the last reading, a sparkline of its history, one quiet line of detail.
 *
 * The model sets the judgement, the tile only shows it: `warn` and `danger`, read along `worse`
 * (high is bad for a load, low for a quota), ink the number and its gauge in the attention or the
 * danger tone, and a finished job is done. The change beside the detail stays in the muted ink —
 * up is not good or bad on its own.
 *
 * A snapshot: the head says when it was read. A reading out of a whole is a `meter` to assistive
 * technology, with its bounds and its value; a bare reading is text.
 */
import {
  formatDelta,
  formatMetricValue,
  formatNumber,
  metricDetail,
  resolveMetric,
} from "@prismshadow/penguin-core/a2ui";
import type { A2uiLang, A2uiMetric, A2uiMetrics } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { ICON_SIZE } from "../../../icon-scale";
import { useChartWidth } from "../../charts/chart-frame/chart-frame";
import { Ring } from "../../charts/ring/ring";
import { Sparkline } from "../../charts/sparkline/sparkline";
import { ProgressBar } from "../../feedback/progress-bar/progress-bar";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { WidgetSurface } from "./widget";

type MetricTone = "done" | "danger" | "attention";

const TONE_INK: Readonly<Record<MetricTone, string>> = {
  done: "text-tone-done-fg",
  danger: "text-tone-danger-fg",
  attention: "text-tone-attention-fg",
};

/** A unit that hugs its number ("37%", "21°C"); any other takes a space ("320 GB"). */
const TIGHT_UNIT = /^[%°′″]/;

/** The sparkline's width before its tile is measured (a static render). */
const SPARK_FALLBACK = 120;

/** A history's sparkline across the tile's width. */
function History({
  values,
  label,
  tone,
}: {
  values: readonly number[];
  label: string;
  tone: MetricTone | undefined;
}) {
  const [frame, width] = useChartWidth();
  return (
    <div ref={frame} className="w-full min-w-0">
      <Sparkline
        values={values}
        label={label}
        scale="range"
        area
        marker
        width={width > 0 ? width : SPARK_FALLBACK}
        height={24}
        {...(tone !== undefined ? { tone } : {})}
      />
    </div>
  );
}

/** The change since the last reading: which way, then by how much, then against what. */
function Delta({
  metric,
  lang,
  strings,
}: {
  metric: A2uiMetric;
  lang: A2uiLang;
  strings: A2uiStrings;
}) {
  const delta = metric.delta;
  const text = formatDelta(metric, lang);
  if (delta === undefined || text === undefined) return null;
  const glyph = delta > 0 ? ICONS.arrowUp : delta < 0 ? ICONS.arrowDown : ICONS.minus;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
      {delta !== 0 && (
        <span className="sr-only">{`${delta > 0 ? strings.deltaUp : strings.deltaDown} `}</span>
      )}
      <span>{metric.deltaLabel !== undefined ? `${text} ${metric.deltaLabel}` : text}</span>
    </span>
  );
}

function MetricTile({
  metric,
  lone,
  lang,
  strings,
}: {
  metric: A2uiMetric;
  /** The only tile: its number takes the large rung. */
  lone: boolean;
  lang: A2uiLang;
  strings: A2uiStrings;
}) {
  const resolved = resolveMetric(metric);
  const tone = resolved.tone;
  const ink = tone !== undefined ? TONE_INK[tone] : "";
  const share = resolved.share ?? 0;
  const unit = metric.unit;
  const detail = metric.detail ?? metricDetail(metric, lang);
  const figure = lone ? "text-4xl" : "text-2xl";
  const meter =
    metric.max !== undefined
      ? {
          role: "meter" as const,
          "aria-label": metric.label,
          "aria-valuemin": metric.min ?? 0,
          "aria-valuemax": metric.max,
          "aria-valuenow": metric.value,
          "aria-valuetext": formatMetricValue(metric, lang),
        }
      : {};
  return (
    <div data-tile className="flex min-w-0 flex-col gap-1 rounded-sm bg-surface-muted p-2">
      <span className="truncate text-xs text-fg-muted">{metric.label}</span>
      <div {...meter} className="flex items-end justify-between gap-2">
        <span className="min-w-0">
          <span data-figure className={`${figure} leading-none font-medium tabular-nums ${ink}`}>
            {`${metric.prefix ?? ""}${formatNumber(metric.value, lang, metric.decimals)}`}
          </span>
          {unit !== undefined && (
            <span className="text-sm text-fg-muted">
              {TIGHT_UNIT.test(unit) ? unit : ` ${unit}`}
            </span>
          )}
        </span>
        {resolved.gauge === "ring" && (
          // The ring takes the number's ink, or the accent while the reading is fine.
          <span className={`shrink-0 ${ink === "" ? "text-accent" : ink}`}>
            <Ring segments={[{ value: share }]} max={1} size={40} width={5} trackOpacity={0.18} />
          </span>
        )}
      </div>
      {resolved.gauge === "bar" && (
        <ProgressBar size="sm" value={share * 100} max={100} tone={tone} label={metric.label} />
      )}
      {metric.history !== undefined && metric.history.length > 1 && (
        <History values={metric.history} label={metric.label} tone={tone} />
      )}
      {(tone === "done" || detail !== undefined || metric.delta !== undefined) && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
          {tone === "done" && <span className={TONE_INK.done}>{strings.done}</span>}
          {detail !== undefined && <span className="min-w-0">{detail}</span>}
          <Delta metric={metric} lang={lang} strings={strings} />
        </div>
      )}
    </div>
  );
}

export function MetricsBlock({ spec }: { spec: A2uiMetrics }) {
  const strings = useUiStrings().a2ui;
  const lang = strings.lang;
  const lone = spec.items.length === 1;
  return (
    <WidgetSurface
      kind="metrics"
      label={spec.title ?? strings.metrics}
      {...(spec.title !== undefined ? { title: spec.title } : {})}
      {...(spec.asOf !== undefined ? { asOf: spec.asOf } : {})}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
        {spec.items.map((metric) => (
          <MetricTile
            key={metric.label}
            metric={metric}
            lone={lone}
            lang={lang}
            strings={strings}
          />
        ))}
      </div>
    </WidgetSurface>
  );
}
