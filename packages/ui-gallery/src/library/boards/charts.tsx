/** 图表: the token donut, the usage trend chart and the score sparkline, on fixed demo data. */
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { TokenDonut } from "../../../../web/src/components/ui/token-donut";
import { ScoreSparkline } from "../../../../web/src/features/benchmark/score-sparkline";
import { TrendChart } from "../../../../web/src/features/usage/trend-chart";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Fourteen days ending on a fixed date, so the chart is the same on every visit. */
const DAY_COSTS = [
  0.41, 0.63, 0.22, 0.98, 1.24, 0.77, 0.15, 0.09, 0.88, 1.43, 1.02, 0.56, 0.71, 0.93,
];

function daySeries(): UsageSeriesPoint[] {
  const end = Date.UTC(2026, 8, 28);
  return DAY_COSTS.map((cost, index) => {
    const date = new Date(end - (DAY_COSTS.length - 1 - index) * 86_400_000);
    const requests = Math.round(cost * 40) + 3;
    const output = Math.round(cost * 30_000);
    return {
      bucket: date.toISOString().slice(0, 10),
      cacheRead: output * 6,
      cacheWrite: Math.round(output * 0.8),
      output,
      total: output * 6 + Math.round(output * 0.8) + output,
      cost,
      requests,
      completed: requests - (index % 5 === 0 ? 1 : 0),
      denominator: requests,
    };
  });
}

const SCORES = [0.62, 0.66, 0.71, 0.69, 0.74, 0.78, 0.77, 0.83];

export function ChartsBoard() {
  const { S } = useGallery();
  const t = S.library.charts;
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
          <TrendChart series={daySeries()} granularity="day" />
        </div>
      </BoardGroup>
      <BoardGroup title={t.sparkline} aside={t.sparklineHint}>
        <div className="lib-row">
          <ScoreSparkline values={SCORES} label={t.sparkline} />
        </div>
      </BoardGroup>
    </div>
  );
}
