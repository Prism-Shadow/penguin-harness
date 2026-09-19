/**
 * Stats & charts: a Trace's numbers.
 *
 * - Overview: the stat strip (cost, tokens, elapsed, cache hit), the Overall summary as a ruled
 *   key-value grid, the per-turn chips, the context ring and the week's output sparkline;
 * - Timeline: turn 2's execution timeline — a lane for the model and one per tool, the time axis,
 *   the legend — and the events it cross-highlights;
 * - Usage: a week of tokens by bucket as stacked bars, and the month's spend against its budget
 *   with the 80 % and 95 % thresholds.
 *
 * Static stand-ins for W4's `StatTile`, `StatChip`, `KeyValue`, `ProgressBar` and W8's `Legend`,
 * `Ring`, `Sparkline` and `ChartFrame`.
 */
import { fixturesFor } from "../fixtures";
import type { Fixtures, TraceSegmentKind } from "../fixtures";
import { defineModule } from "../module";
import { duration, percent, tokens, usd } from "../screens/format";
import { Badge, GlyphIcon, KeyValue, RuledSection } from "./parts";
import type { IconName } from "./parts";

/** Timeline phase inks: chart identity colours, one per kind; `other` recedes. */
const SEGMENT_INK: Record<TraceSegmentKind, string> = {
  thinking: "bg-chart-5",
  text: "bg-chart-1",
  toolgen: "bg-chart-2",
  approvalWait: "bg-chart-4",
  exec: "bg-chart-6",
  other: "bg-tone-neutral-emphasis",
};

const LEGEND: readonly TraceSegmentKind[] = [
  "thinking",
  "text",
  "toolgen",
  "approvalWait",
  "exec",
  "other",
];

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3 first:pl-0">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="font-(family-name:--ui-h3-font) text-(length:--ui-h3-size) leading-(--ui-h3-lh) font-(--ui-h3-weight) tabular-nums text-fg">
        {value}
      </p>
      {detail && <p className="text-xs tabular-nums text-fg-subtle">{detail}</p>}
    </div>
  );
}

function StatChip({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <span
      title={label}
      className="flex items-center gap-1 font-mono text-xs tabular-nums text-fg-muted"
    >
      <GlyphIcon name={icon} size={13} className="text-fg-subtle" />
      {value}
    </span>
  );
}

/**
 * A ring gauge draws its own geometry: it is not the line-icon family, so neither the family's
 * weights nor `--ui-icon-stroke` apply. Like the app's TokenDonut and FinanceGauge, its stroke
 * follows its size (W8's `Ring` replaces them all).
 */
function Ring({ share, label }: { share: number; label: string }) {
  const size = 52;
  const stroke = Math.round(size * 0.1);
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ui-chart-grid)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ui-chart-1)"
        strokeWidth={stroke}
        strokeDasharray={`${Math.max(share * c, 2)} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const w = 160;
  const h = 40;
  const max = Math.max(...values);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`)
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--ui-chart-output)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Overview({ f }: { f: Fixtures }) {
  const t = f.copy.traces;
  const o = f.trace.overall;
  const turn = f.trace.turns[1]!;
  const ctx = f.session.context;
  const context = f.copy.chat.contextOf(tokens(ctx.tokens), tokens(ctx.window));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex divide-x divide-line">
        <StatTile label={t.cost} value={usd(o.costUsd)} detail={t.overTurns(o.turns)} />
        <StatTile
          label={t.tokens}
          value={tokens(o.inputTokens + o.outputTokens)}
          detail={`${tokens(o.outputTokens)} ${t.outputTokens}`}
        />
        <StatTile label={t.elapsed} value={duration(o.elapsedMs)} detail={`${o.outputTps} tok/s`} />
        <StatTile
          label={t.cacheHitRate}
          value={percent(o.cacheReadTokens, o.inputTokens)}
          detail={tokens(o.cacheReadTokens)}
        />
      </div>
      <RuledSection title={t.overall}>
        <KeyValue
          items={[
            { label: t.turns, value: String(o.turns) },
            { label: t.toolCalls, value: String(o.toolCalls) },
            { label: t.compactions, value: String(o.compactions) },
            { label: t.inputTokens, value: tokens(o.inputTokens) },
            {
              label: t.cacheHits,
              value: `${tokens(o.cacheReadTokens)} · ${percent(o.cacheReadTokens, o.inputTokens)}`,
            },
            { label: t.outputTokens, value: tokens(o.outputTokens) },
          ]}
        />
      </RuledSection>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-4">
        <span className="flex items-center gap-3">
          <Badge>{t.turn(turn.index)}</Badge>
          <StatChip icon="wrench" value={String(turn.toolCalls)} label={t.toolCalls} />
          <StatChip icon="arrowUpLine" value={tokens(turn.inputTokens)} label={t.inputTokens} />
          <StatChip icon="arrowDownLine" value={tokens(turn.outputTokens)} label={t.outputTokens} />
          <StatChip icon="cost" value={usd(turn.costUsd)} label={t.cost} />
        </span>
        <span className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <span className="flex items-center gap-3">
            <Ring share={ctx.tokens / ctx.window} label={context} />
            <span className="text-xs text-fg-muted">{context}</span>
          </span>
          <span className="flex items-center gap-3">
            <Sparkline values={f.usage.output} label={f.copy.usage.outputThisWeek} />
            <span className="text-xs text-fg-muted">{f.copy.usage.outputThisWeek}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function Timeline({ f }: { f: Fixtures }) {
  const t = f.copy.traces;
  const turn = f.trace.turns[1]!;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <p className="text-sm font-(--ui-weight-medium) text-fg">
          {t.turn(turn.index)} · {t.timeline}
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {turn.lanes.map((lane) => (
            <div key={lane.name} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-right font-mono text-xs text-fg-muted">
                {lane.name === "model"
                  ? t.modelLane
                  : lane.name === "other"
                    ? t.legend.other
                    : lane.name}
              </span>
              <span className="relative h-4 min-w-0 flex-1 overflow-hidden bg-surface-muted">
                {lane.segments.map((seg, i) => (
                  <span
                    key={i}
                    className={`absolute inset-y-0 min-w-0.5 ${SEGMENT_INK[seg.kind]}`}
                    style={{
                      left: `${(seg.startMs / turn.spanMs) * 100}%`,
                      width: `${((seg.endMs - seg.startMs) / turn.spanMs) * 100}%`,
                    }}
                  />
                ))}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0" />
            <span className="relative h-4 min-w-0 flex-1">
              {ticks.map((p) => (
                <span
                  key={p}
                  className={`absolute top-0 font-mono text-xs tabular-nums text-fg-subtle ${
                    p === 0 ? "" : p === 1 ? "-translate-x-full" : "-translate-x-1/2"
                  }`}
                  style={{ left: `${p * 100}%` }}
                >
                  {duration(Math.round(turn.spanMs * p))}
                </span>
              ))}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-30">
          {LEGEND.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className={`inline-block h-2 w-3 ${SEGMENT_INK[kind]}`} />
              {t.legend[kind]}
            </span>
          ))}
        </div>
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <p className="text-sm font-(--ui-weight-medium) text-fg">{t.messages}</p>
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {turn.events.map((event, i) => (
            <li
              key={event.time}
              className={`flex items-center gap-2 border-t border-line-muted px-2 py-1.5 ${i === 3 ? "bg-surface-muted" : ""}`}
            >
              <span className="shrink-0 font-mono text-xs tabular-nums text-fg-subtle">
                {event.time}
              </span>
              <Badge
                tone={
                  event.messageType === "event_msg"
                    ? "attention"
                    : event.messageType === "session_meta"
                      ? "info"
                      : "neutral"
                }
                variant="outline"
              >
                {event.payloadType}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
                {event.summary}
              </span>
              {event.stopReason && (
                <span className="shrink-0 font-mono text-xs text-fg-subtle">
                  {event.stopReason}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Usage({ f }: { f: Fixtures }) {
  const copy = f.copy.usage;
  const u = f.usage;
  const totals = u.days.map((_, i) => u.cacheRead[i]! + u.cacheWrite[i]! + u.output[i]!);
  const max = Math.ceil(Math.max(...totals) / 100) * 100;
  const spend = f.company.org.spend;
  const share = spend.costUsd / spend.budgetUsd;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <p className="text-sm font-(--ui-weight-medium) text-fg">{copy.weekTitle}</p>
        <div className="flex gap-3">
          <div className="flex h-44 w-8 flex-col justify-between text-right font-mono text-xs tabular-nums text-fg-subtle">
            <span>{max}</span>
            <span>{max / 2}</span>
            <span>0</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 flex-1 gap-1">
            <div className="flex h-44 items-end gap-4 border-b border-[var(--ui-chart-axis)] border-t border-t-[var(--ui-chart-grid)] px-2">
              {u.days.map((day, i) => (
                <span
                  key={day}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${day}: ${totals[i]}k`}
                >
                  <span
                    className="block bg-chart-output"
                    style={{ height: `${(u.output[i]! / max) * 100}%` }}
                  />
                  <span
                    className="block bg-chart-cache-write"
                    style={{ height: `${(u.cacheWrite[i]! / max) * 100}%` }}
                  />
                  <span
                    className="block bg-chart-cache-read"
                    style={{ height: `${(u.cacheRead[i]! / max) * 100}%` }}
                  />
                </span>
              ))}
            </div>
            <div className="flex gap-4 px-2">
              {u.days.map((day) => (
                <span key={day} className="min-w-0 flex-1 text-center text-xs text-fg-muted">
                  {day}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-13">
          {(
            [
              ["bg-chart-cache-read", u.buckets.cacheRead],
              ["bg-chart-cache-write", u.buckets.cacheWrite],
              ["bg-chart-output", u.buckets.output],
            ] as const
          ).map(([ink, label]) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className={`inline-block size-2.5 ${ink}`} />
              {label}
            </span>
          ))}
        </div>
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-(--ui-weight-medium) text-fg">{copy.monthSpend}</p>
          <p className="font-mono text-xs tabular-nums text-fg-muted">
            {f.copy.common.spentOf(usd(spend.costUsd), usd(spend.budgetUsd))}
          </p>
        </div>
        <span className="relative block h-2 w-full bg-tone-neutral-bg">
          <span
            className="absolute inset-y-0 left-0 bg-tone-success-emphasis"
            style={{ width: `${share * 100}%` }}
          />
          <span className="absolute -inset-y-1 left-[80%] w-px bg-tone-attention-fg" />
          <span className="absolute -inset-y-1 left-[95%] w-px bg-tone-danger-fg" />
        </span>
        <p className="text-xs text-fg-muted">{copy.thresholds}</p>
      </section>
    </div>
  );
}

const VARIANTS = { overview: Overview, timeline: Timeline, usage: Usage } as const;

export const module = defineModule({
  id: "stats",
  title: "Stats & charts",
  description:
    "A Trace's numbers: the overall summary, stat tiles and chips, a context ring and a sparkline; the execution timeline and its legend; spend by day against the budget.",
  width: "wide",
  variants: [
    { key: "overview", title: "Overview" },
    { key: "timeline", title: "Timeline" },
    { key: "usage", title: "Usage" },
  ],
  parts: [
    "data-stat-tile",
    "data-stat-chip",
    "data-legend",
    "data-ring",
    "data-sparkline",
    "data-chart-frame",
    "charts-domain",
    "data-key-value",
    "feedback-progress-bar",
    "layout-ruled-section",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Overview;
    return <View f={fixturesFor(lang)} />;
  },
});
