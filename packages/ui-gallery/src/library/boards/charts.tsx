/**
 * 图表: the chart foundation's page — first the primitives every chart draws through, then the
 * current theme's chart tokens, live, then every chart kind the app draws, on fixed demo data
 * so the themes' chart styles compare: the token donut, the ring gauge, the legend in both
 * layouts, the cost trend line, the stacked token bars with their cache-hit curve and legend,
 * the requests-and-success-rate stack, the sparkline at both scales, and the Trace timeline's
 * lanes.
 *
 * Every input a chart receives is built once, at module level or memoized: a chart keeps
 * effects keyed on its data (the timeline re-measures its scroller whenever its groups change),
 * and a fresh array on every render would run them on every render.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  TraceModelSegment,
  TraceOtherSpan,
  TraceToolSpan,
  UsageSeriesPoint,
} from "@prismshadow/penguin-server/api";
import { Legend, Ring, Sparkline, TokenDonut } from "@prismshadow/penguin-ui";
import type { LegendItem, RingSegment, ToneName } from "@prismshadow/penguin-ui";
import { humanizeTokens } from "../../../../web/src/lib/format";
import { TimelineChart } from "../../../../web/src/features/traces/timeline-chart";
import type { TraceHighlight } from "../../../../web/src/features/traces/timeline-chart";
import { TrendChart } from "../../../../web/src/features/usage/trend-chart";
import {
  RequestsChart,
  TokenBarChart,
  TokenLegend,
} from "../../../../web/src/features/usage/usage-charts";
import type { TokenLegendKey } from "../../../../web/src/features/usage/usage-charts";
import type { EntityCounts } from "../../../../web/src/features/usage/usage-controls";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";
import { ChartPrimitives } from "./chart-primitives";
import { ChartTokenTable } from "./chart-tokens";

/** Fourteen days ending on a fixed date, so the charts are the same on every visit. */
const DAY_COSTS = [
  0.41, 0.63, 0.22, 0.98, 1.24, 0.77, 0.15, 0.09, 0.88, 1.43, 1.02, 0.56, 0.71, 0.93,
];

function daySeries(): UsageSeriesPoint[] {
  const end = Date.UTC(2026, 8, 28);
  return DAY_COSTS.map((cost, index) => {
    const date = new Date(end - (DAY_COSTS.length - 1 - index) * 86_400_000);
    const requests = Math.round(cost * 40) + 3;
    const output = Math.round(cost * 30_000);
    const cacheRead = output * 6;
    const cacheWrite = Math.round(output * 0.8);
    return {
      bucket: date.toISOString().slice(0, 10),
      cacheRead,
      cacheWrite,
      output,
      total: cacheRead + cacheWrite + output,
      cost,
      requests,
      completed: requests - (index % 5 === 0 ? 1 : 0),
      denominator: requests,
    };
  });
}

const SERIES: UsageSeriesPoint[] = daySeries();

/** The day series split between two agents, the first taking the larger share. */
function agentCounts(
  series: readonly UsageSeriesPoint[],
  labels: readonly string[],
): EntityCounts[] {
  const shares = [0.6, 0.4];
  return shares.map((share, entity) => {
    const requests = series.map((point) => Math.round(point.requests * share));
    return {
      label: labels[entity] ?? `agent-${entity + 1}`,
      requests,
      completed: requests.map((count, index) => count - (entity === 0 && index % 5 === 0 ? 1 : 0)),
      denominator: requests,
    };
  });
}

const SCORES = [62, 66, 71, 69, 74, 78, 77, 83];
const LONE_SCORE = SCORES.slice(-1);
const ACTIVITY = [2, 3, 1, 5, 6, 4, 1, 0, 4, 7, 5, 3, 4, 5];
const FLAT = [0, 0, 0, 0, 0, 0, 0];

/** Usage well under, near and at the limit, then the first again at a larger size. */
const DONUTS = [
  { cacheRead: 42_000, cacheWrite: 6_000, output: 9_000, size: 44 },
  { cacheRead: 120_000, cacheWrite: 14_000, output: 31_000, size: 44 },
  { cacheRead: 150_000, cacheWrite: 20_000, output: 26_000, size: 44 },
  { cacheRead: 42_000, cacheWrite: 6_000, output: 9_000, size: 64 },
];

/** Spend against a budget under, near and over it, each in the tone the finance page gives it. */
const SPEND: readonly { ratio: number; tone: ToneName }[] = [
  { ratio: 0.41, tone: "success" },
  { ratio: 0.86, tone: "attention" },
  { ratio: 1.2, tone: "danger" },
];

/** A whole split into shares, each in its series slot. */
const SHARES: readonly RingSegment[] = [0.34, 0.22, 0.18, 0.12].map((value, series) => ({
  value,
  paint: { series },
}));

/** The list legend's demo figures, one per part: its estimate and its whole percent. */
const PART_FIGURES = [
  { tokens: 18_400, percent: 38 },
  { tokens: 9_100, percent: 19 },
  { tokens: 6_300, percent: 13 },
  { tokens: 14_600, percent: 30 },
] as const;

function Figures({ tokens, percent }: { tokens: number; percent: number }) {
  return (
    <>
      <span className="shrink-0 font-mono font-medium text-fg">~{humanizeTokens(tokens)}</span>
      <span className="w-8 shrink-0 text-right font-mono text-fg-subtle">{percent}%</span>
    </>
  );
}

/** A Task's timeline: seconds after a fixed start, as the trace records them. */
const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const SEGMENTS: TraceModelSegment[] = [
  { kind: "thinking", startTs: at(0), endTs: at(1.8), taskIndex: 0 },
  {
    kind: "tool_call",
    startTs: at(1.8),
    endTs: at(2.4),
    toolCallId: "c1",
    name: "read_file",
    taskIndex: 0,
  },
  { kind: "thinking", startTs: at(4.0), endTs: at(5.2), taskIndex: 0 },
  {
    kind: "tool_call",
    startTs: at(5.2),
    endTs: at(5.6),
    toolCallId: "c2",
    name: "run_command",
    taskIndex: 0,
  },
  {
    kind: "tool_call",
    startTs: at(5.6),
    endTs: at(5.9),
    toolCallId: "c3",
    name: "read_file",
    taskIndex: 0,
  },
  { kind: "text", startTs: at(9.2), endTs: at(12.6), taskIndex: 0 },
  { kind: "thinking", startTs: at(20.0), endTs: at(21.1), taskIndex: 1 },
  { kind: "text", startTs: at(21.1), endTs: at(24.0), taskIndex: 1 },
];

const TOOL_SPANS: TraceToolSpan[] = [
  { toolCallId: "c1", name: "read_file", callTs: at(2.4), outputTs: at(3.9), taskIndex: 0 },
  {
    toolCallId: "c2",
    name: "run_command",
    callTs: at(5.9),
    approvalTs: at(6.9),
    decision: "allow",
    outputTs: at(9.0),
    taskIndex: 0,
  },
  { toolCallId: "c3", name: "read_file", callTs: at(5.9), outputTs: at(6.4), taskIndex: 0 },
];

/** Always the same empty list: the timeline's default parameter would be a new array every render. */
const OTHER_SPANS: TraceOtherSpan[] = [];

function Part({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="lib-part">
      <div className="lib-part-head">
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      {children}
    </section>
  );
}

export function ChartsBoard() {
  const { S } = useGallery();
  const t = S.library.charts;
  const [legend, setLegend] = useState<TokenLegendKey | null>(null);
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [part, setPart] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const entities = useMemo(() => agentCounts(SERIES, t.agents), [t.agents]);
  const kinds = useMemo<LegendItem[]>(
    () => [
      ...(["cacheRead", "cacheWrite", "output"] as const).map((role) => ({
        key: role,
        label: t.donutLabels[role],
        paint: { role },
        shape: "chip" as const,
      })),
      // A line on its own axis, not a fourth kind: its item names the shape and stays still.
      {
        key: "hitRate",
        label: t.legendHitRate,
        paint: { role: "ref" },
        shape: "dash",
        interactive: false,
      },
    ],
    [t],
  );
  const parts = useMemo<LegendItem[]>(
    () =>
      PART_FIGURES.map((figures, i) => ({
        key: `part-${i}`,
        label: t.legendParts[i] ?? "",
        paint: { series: i },
        value: <Figures {...figures} />,
      })),
    [t],
  );
  return (
    <div className="gf-board">
      <Part title={t.parts.primitives} hint={t.parts.primitivesHint}>
        <ChartPrimitives />
      </Part>
      <Part title={t.parts.tokens} hint={t.parts.tokensHint}>
        <ChartTokenTable />
      </Part>
      <Part title={t.parts.charts} hint={t.parts.chartsHint}>
        <BoardGroup title={t.donut} aside={t.donutHint}>
          <div className="lib-row">
            {DONUTS.map((donut, i) => (
              <TokenDonut
                key={i}
                {...donut}
                max={200_000}
                labels={t.donutLabels}
                format={humanizeTokens}
              />
            ))}
          </div>
        </BoardGroup>
        <BoardGroup title={t.ring} aside={t.ringHint}>
          <div className="lib-row">
            {SPEND.map(({ ratio, tone }) => (
              <Ring
                key={ratio}
                segments={[{ value: ratio }]}
                max={1}
                size={40}
                width={4}
                tone={tone}
                label={t.ringSpend(Math.round(ratio * 100))}
              />
            ))}
            <Ring segments={[]} max={1} size={40} width={4} label={t.ringNoBudget} />
            <Ring segments={SHARES} max={1} size={40} width={6} label={t.ringShares} />
            <span className="lib-cell text-fg-subtle">
              <Ring segments={[{ value: 0.62 }]} max={1} size={12} width={2} trackOpacity={0.25} />
              <span className="lib-caption">{t.ringContext}</span>
            </span>
          </div>
        </BoardGroup>
        <BoardGroup title={t.legend} aside={t.legendHint}>
          <div className="lib-stack">
            <Legend items={kinds} active={kind} onHover={setKind} />
            <div className="lib-box w-72 p-3">
              <Legend
                layout="list"
                items={parts}
                active={part ?? pinned}
                pinned={pinned}
                onHover={setPart}
                onSelect={(key) => setPinned((current) => (current === key ? null : key))}
              />
            </div>
          </div>
        </BoardGroup>
        <BoardGroup title={t.trend} aside={t.trendHint}>
          <div className="lib-box p-3">
            <TrendChart series={SERIES} granularity="day" />
          </div>
        </BoardGroup>
        <BoardGroup title={t.tokens} aside={t.tokensHint}>
          <div className="lib-box p-3">
            <TokenBarChart series={SERIES} granularity="day" legend={legend} />
            <TokenLegend active={legend} onHover={setLegend} />
          </div>
        </BoardGroup>
        <BoardGroup title={t.requests} aside={t.requestsHint}>
          <div className="lib-box p-3">
            <RequestsChart series={SERIES} entities={entities} granularity="day" />
          </div>
        </BoardGroup>
        <BoardGroup title={t.activity} aside={t.activityHint}>
          <div className="lib-row">
            {[ACTIVITY, FLAT].map((values, i) => (
              <Sparkline
                key={i}
                values={values}
                label={t.activity}
                area
                tone="success"
                width={100}
                height={30}
                className="h-8 w-40"
              />
            ))}
          </div>
        </BoardGroup>
        <BoardGroup title={t.sparkline} aside={t.sparklineHint}>
          <div className="lib-row">
            <Sparkline values={SCORES} label={t.sparkline} scale="range" marker />
            <Sparkline values={LONE_SCORE} label={t.sparkline} scale="range" marker />
          </div>
        </BoardGroup>
        <BoardGroup title={t.timeline} aside={t.timelineHint}>
          <div className="lib-box p-3">
            <TimelineChart
              segments={SEGMENTS}
              toolSpans={TOOL_SPANS}
              otherSpans={OTHER_SPANS}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          </div>
        </BoardGroup>
      </Part>
    </div>
  );
}
