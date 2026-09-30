/**
 * 图表: every chart kind the app draws, on fixed demo data so the themes' chart styles compare —
 * the token donut, the cost trend line, the stacked token bars with their cache-hit curve and
 * legend, the requests-and-success-rate stack, the activity and score sparklines, and the Trace
 * timeline's lanes.
 */
import { useState } from "react";
import type {
  TraceModelSegment,
  TraceToolSpan,
  UsageSeriesPoint,
} from "@prismshadow/penguin-server/api";
import { TokenDonut } from "../../../../web/src/components/ui/token-donut";
import { ActivitySparkline } from "../../../../web/src/features/agents/activity-sparkline";
import { ScoreSparkline } from "../../../../web/src/features/benchmark/score-sparkline";
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

const SCORES = [0.62, 0.66, 0.71, 0.69, 0.74, 0.78, 0.77, 0.83];
const ACTIVITY = [2, 3, 1, 5, 6, 4, 1, 0, 4, 7, 5, 3, 4, 5];

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

export function ChartsBoard() {
  const { S } = useGallery();
  const t = S.library.charts;
  const [legend, setLegend] = useState<TokenLegendKey | null>(null);
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);
  const series = daySeries();
  return (
    <div className="gf-board">
      <BoardGroup title={t.donut} aside={t.donutHint}>
        <div className="lib-row">
          <TokenDonut cacheRead={42_000} cacheWrite={6_000} output={9_000} max={200_000} />
          <TokenDonut cacheRead={120_000} cacheWrite={14_000} output={31_000} max={200_000} />
          <TokenDonut cacheRead={150_000} cacheWrite={20_000} output={26_000} max={200_000} />
          <TokenDonut
            cacheRead={42_000}
            cacheWrite={6_000}
            output={9_000}
            max={200_000}
            size={64}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.trend} aside={t.trendHint}>
        <div className="lib-box p-3">
          <TrendChart series={series} granularity="day" />
        </div>
      </BoardGroup>
      <BoardGroup title={t.tokens} aside={t.tokensHint}>
        <div className="lib-box p-3">
          <TokenBarChart series={series} granularity="day" legend={legend} />
          <TokenLegend active={legend} onHover={setLegend} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.requests} aside={t.requestsHint}>
        <div className="lib-box p-3">
          <RequestsChart
            series={series}
            entities={agentCounts(series, t.agents)}
            granularity="day"
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.activity} aside={t.activityHint}>
        <div className="lib-row">
          <ActivitySparkline data={ACTIVITY} label={t.activity} className="h-8 w-40" />
          <ActivitySparkline data={[0, 0, 0, 0, 0, 0, 0]} label={t.activity} className="h-8 w-40" />
        </div>
      </BoardGroup>
      <BoardGroup title={t.sparkline} aside={t.sparklineHint}>
        <div className="lib-row">
          <ScoreSparkline values={SCORES} label={t.sparkline} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.timeline} aside={t.timelineHint}>
        <div className="lib-box p-3">
          <TimelineChart
            segments={SEGMENTS}
            toolSpans={TOOL_SPANS}
            highlight={highlight}
            onHighlight={setHighlight}
          />
        </div>
      </BoardGroup>
    </div>
  );
}
