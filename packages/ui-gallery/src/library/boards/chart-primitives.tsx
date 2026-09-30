/**
 * The chart primitives on their own (packages/web/src/components/ui/chart), each on a small
 * stage with demo data: the bar, the line, the area, the point, the arc, the grid and axis
 * labels, and the Trace timeline's HTML bar. They read the theme's chart tokens themselves; the
 * stages only say where a mark sits and which slot it paints with.
 *
 * The line's curve is the theme's (`--ui-chart-curve`), so ChartLine draws in one curve at a
 * time; beside it the three values the token may take are drawn with the same path helper the
 * primitive uses, as a key to what the token chooses.
 */
import type { ReactNode } from "react";
import { useChartStyle } from "../../../../web/src/lib/chart-style";
import type { ChartCurve } from "../../../../web/src/lib/chart-style";
import {
  ChartArc,
  ChartArea,
  ChartAxis,
  ChartBar,
  ChartGrid,
  ChartLine,
  ChartPoint,
  TimelineBar,
  curvePath,
} from "../../../../web/src/components/ui/chart";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const W = 240;
const H = 100;
const BASE = 84;

/** Five points across the stage, the shape every line-like stage shares. */
const POINTS: ReadonlyArray<readonly [number, number]> = [
  [20, 70],
  [70, 34],
  [120, 52],
  [170, 22],
  [220, 44],
];

const CURVES: readonly ChartCurve[] = ["linear", "smooth", "step"];

/** The Trace timeline's five bar kinds on their slots (1, 3, 2, 4, 5) and where each sits in the lane. */
const LANES = [
  { kind: "thinking", series: 0, left: 0, width: 22 },
  { kind: "tool_call", series: 2, left: 22, width: 8 },
  { kind: "approval", series: 3, left: 32, width: 12 },
  { kind: "tool", series: 4, left: 44, width: 26 },
  { kind: "text", series: 1, left: 72, width: 28 },
] as const;

function Stage({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg
      className="lib-stage"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function ChartPrimitives() {
  const { S } = useGallery();
  const t = S.library.charts.primitives;
  const chart = useChartStyle();
  return (
    <>
      <BoardGroup title={t.bar} aside={t.barHint}>
        <Stage label={t.bar}>
          {[62, 38, 50, 24, 44].map((height, i) => (
            <ChartBar
              key={i}
              cx={24 + i * 40}
              band={40}
              y={BASE - height}
              height={height}
              paint={{ series: i }}
            />
          ))}
          <ChartBar
            cx={224}
            band={40}
            y={BASE - 30}
            height={30}
            paint={{ series: 5 }}
            top={false}
          />
          <ChartBar cx={224} band={40} y={BASE - 56} height={26} paint={{ series: 6 }} />
        </Stage>
      </BoardGroup>
      <BoardGroup title={t.line} aside={t.lineHint}>
        <div className="lib-row">
          <Stage label={`${t.line} · ${chart.curve}`}>
            <ChartLine points={POINTS} paint={{ series: 0 }} />
            <ChartLine
              points={POINTS.map(([x, y]) => [x, y + 18] as const)}
              paint={{ role: "ref" }}
              dash="4 3"
            />
          </Stage>
          <span className="lib-caption">--ui-chart-curve: {chart.curve}</span>
        </div>
        <div className="lib-row">
          {CURVES.map((curve) => (
            <span key={curve} className="lib-cell">
              <svg className="lib-stage lib-stage-small" viewBox={`0 0 ${W} ${H}`} aria-hidden>
                <path
                  d={curvePath(POINTS, curve)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={chart.lineWidth}
                  className="text-[var(--ui-fg-muted)]"
                />
              </svg>
              <span className="lib-caption">{t.curves[curve]}</span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.area} aside={t.areaHint}>
        <Stage label={t.area}>
          <ChartArea points={POINTS} baseY={BASE} paint={{ series: 2 }} />
          <ChartLine points={POINTS} paint={{ series: 2 }} />
        </Stage>
      </BoardGroup>
      <BoardGroup title={t.point} aside={t.pointHint}>
        <Stage label={t.point}>
          {POINTS.map(([x, y], i) => (
            <ChartPoint key={i} cx={x} cy={y} paint={{ series: i }} grow={i === 3} />
          ))}
        </Stage>
      </BoardGroup>
      <BoardGroup title={t.arc} aside={t.arcHint}>
        <Stage label={t.arc}>
          <ChartArc
            cx={50}
            cy={50}
            r={36}
            width={10}
            paint={{ ink: "text-[var(--ui-fg-subtle)]" }}
            track
            trackOpacity={0.3}
          />
          <ChartArc cx={50} cy={50} r={36} width={10} paint={{ role: "cacheRead" }} length={110} />
          <ChartArc
            cx={50}
            cy={50}
            r={36}
            width={10}
            paint={{ role: "cacheWrite" }}
            length={40}
            offset={-110}
          />
          <ChartArc
            cx={50}
            cy={50}
            r={36}
            width={10}
            paint={{ role: "output" }}
            length={30}
            offset={-150}
          />
          <ChartArc
            cx={150}
            cy={50}
            r={36}
            width={10}
            paint={{ ink: "text-[var(--ui-fg-subtle)]" }}
            track
            trackOpacity={0.3}
          />
          {[0, 1, 2, 3].map((slot) => (
            <ChartArc
              key={slot}
              cx={150}
              cy={50}
              r={36}
              width={10}
              paint={{ series: slot }}
              length={40}
              offset={-slot * 48}
            />
          ))}
        </Stage>
      </BoardGroup>
      <BoardGroup title={t.grid} aside={t.gridHint}>
        <Stage label={t.grid}>
          {[20, 50, 80].map((y, i) => (
            <g key={y}>
              <ChartGrid x1={36} x2={W - 8} y={y} />
              <ChartAxis x={30} y={y + 3} anchor="end">
                {[100, 50, 0][i]}
              </ChartAxis>
            </g>
          ))}
          {["09-15", "09-22", "09-28"].map((label, i) => (
            <ChartAxis
              key={label}
              x={36 + i * 98}
              y={H - 4}
              anchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            >
              {label}
            </ChartAxis>
          ))}
          <ChartLine points={POINTS} paint={{ series: 0 }} />
        </Stage>
      </BoardGroup>
      <BoardGroup title={t.timeline} aside={t.timelineHint}>
        <div className="lib-stack">
          {LANES.map((lane) => (
            <div key={lane.kind} className="lib-lane">
              <span className="lib-caption lib-lane-label">{t.kinds[lane.kind]}</span>
              <div className="lib-lane-track">
                <TimelineBar
                  paint={{ series: lane.series }}
                  place={{ left: `${lane.left}%`, width: `${lane.width}%` }}
                  aria-hidden
                />
              </div>
            </div>
          ))}
        </div>
      </BoardGroup>
    </>
  );
}
