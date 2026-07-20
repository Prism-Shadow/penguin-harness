/**
 * Self-improvement loop, centered on the Target Agent's vN -> vN+1 upgrade: the
 * Optimizer orchestrates Evaluators to score vN (scores & traces flow back as edge
 * labels, not as a node), analyzes them, and ships the upgraded vN+1 — drawn as a
 * bold evolve arrow between the two versions. Beside it, three outcome trends with
 * real axes and ticks, each line growing from zero rightwards on a slow loop.
 * Illustrative; all colors are theme-aware Tailwind fill/stroke classes.
 */
import { useEffect, useRef } from "react";
import { S } from "../lib/strings";
import { Section } from "../components/section";

/** Rounded node with a centered label and an optional version pill. */
function Node({
  x,
  y,
  w = 150,
  h = 48,
  label,
  kind = "neutral",
  badge,
  badgeKind = "neutral",
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  kind?: "accent" | "target" | "neutral";
  badge?: string;
  badgeKind?: "accent" | "neutral";
}) {
  const rect =
    kind === "accent"
      ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
      : kind === "target"
        ? "fill-brand-50 stroke-brand-200 dark:fill-brand-950 dark:stroke-brand-800"
        : "fill-gray-50 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700";
  const text =
    kind === "target" ? "fill-brand-800 dark:fill-brand-200" : "fill-gray-900 dark:fill-gray-100";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} strokeWidth={1.5} className={rect} />
      <text
        x={x + w / 2}
        y={y + h / 2 + 4.5}
        textAnchor="middle"
        className={`text-[13px] font-semibold ${text}`}
      >
        {label}
      </text>
      {badge && (
        <>
          <rect
            x={x + w - 26}
            y={y - 12}
            width={44}
            height={22}
            rx={11}
            className={
              badgeKind === "accent"
                ? "fill-brand-600 dark:fill-brand-400"
                : "fill-gray-400 dark:fill-gray-600"
            }
          />
          <text
            x={x + w - 4}
            y={y + 3}
            textAnchor="middle"
            className={`text-[10.5px] font-semibold ${
              badgeKind === "accent" ? "fill-white dark:fill-gray-950" : "fill-white"
            }`}
          >
            {badge}
          </text>
        </>
      )}
    </g>
  );
}

function EdgeLabel({
  x,
  y,
  anchor = "middle",
  accent = false,
  children,
}: {
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  accent?: boolean;
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className={
        accent
          ? "fill-brand-700 text-[10.5px] font-medium dark:fill-brand-300"
          : "fill-gray-500 text-[10.5px] dark:fill-gray-400"
      }
    >
      {children}
    </text>
  );
}

function FlowDot({
  path,
  dur,
  begin,
  accent = false,
  r = 1.5,
}: {
  path: string;
  dur: string;
  begin: string;
  accent?: boolean;
  r?: number;
}) {
  return (
    <circle
      r={r}
      className={accent ? "fill-brand-500 dark:fill-brand-400" : "fill-gray-400 dark:fill-gray-500"}
    >
      {/* Stop at 90% of the path so the dot never rides over the arrowhead. */}
      <animateMotion
        dur={dur}
        begin={begin}
        repeatCount="indefinite"
        path={path}
        calcMode="linear"
        keyPoints="0;0.9"
        keyTimes="0;1"
      />
    </circle>
  );
}

/** Loop edges (top machinery) and the bold evolve chord (bottom). */
const EDGE_SPAWN = "M330,76 L330,154";
const EDGE_FEEDBACK = "M390,208 L390,82";
const EDGE_BENCH_OLD = "M295,208 L163,294";
const EDGE_BENCH_NEW = "M425,208 L557,294";
const EDGE_EVOLVE = "M216,324 L504,324";

/** Draw-loop timing, mirroring the old CSS keyframes: grow, hold, fade, repeat. */
const CYCLE_S = 4.6;
const DRAW_END = 0.55;
const HOLD_END = 0.84;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/**
 * Outcome trend chart with proper axes and ticks; a single rAF clock grows the
 * line from zero rightwards and carries a value label on the moving head — the
 * number changes as the curve climbs (or falls), so the trend reads at a glance.
 * Reduced-motion users see the finished line with its final value.
 */
function TrendChart({
  label,
  hint,
  points,
  yTicks,
  xTicks,
  phase,
  format,
}: {
  label: string;
  hint: string;
  points: number[];
  yTicks: number[];
  xTicks: Array<{ at: number; text: string }>;
  /** Seconds this chart runs ahead of the shared cycle (staggers the trio). */
  phase: number;
  format: (v: number) => string;
}) {
  const W = 210;
  const H = 112;
  const M = { left: 34, right: 10, top: 16, bottom: 20 };
  const yMax = Math.max(...yTicks);
  const yMin = Math.min(...yTicks);
  const px = (i: number) => M.left + (i / (points.length - 1)) * (W - M.left - M.right);
  const py = (v: number) => M.top + ((yMax - v) / (yMax - yMin || 1)) * (H - M.top - M.bottom);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`).join(" ");
  const axis = "stroke-gray-200 dark:stroke-gray-800";
  const tickText = "fill-gray-400 text-[8.5px] tabular-nums dark:fill-gray-500";

  const fadeRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const labelRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    const fade = fadeRef.current;
    const line = pathRef.current;
    const head = headRef.current;
    const value = labelRef.current;
    if (!fade || !line || !head || !value) return;

    const apply = (p: number, opacity: number) => {
      line.style.strokeDashoffset = String(1 - p);
      const f = p * (points.length - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(points.length - 1, i0 + 1);
      const v = (points[i0] ?? 0) + ((points[i1] ?? 0) - (points[i0] ?? 0)) * (f - i0);
      const x = px(f);
      const y = py(v);
      head.setAttribute("transform", `translate(${x}, ${y})`);
      value.textContent = format(v);
      value.setAttribute("x", String(Math.min(W - M.right - 10, Math.max(M.left + 12, x))));
      value.setAttribute("y", String(Math.max(10, y - 9)));
      fade.style.opacity = String(opacity);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply(1, 1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (((now - t0) / 1000 + phase) % CYCLE_S) / CYCLE_S;
      if (t < DRAW_END) apply(easeInOut(t / DRAW_END), 1);
      else if (t < HOLD_END) apply(1, 1);
      else apply(1, 1 - (t - HOLD_END) / (1 - HOLD_END));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // px/py are pure functions of the props below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, phase, format]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold tracking-tight">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" aria-hidden="true">
        {/* Axes: hairline, solid, recessive. */}
        <line
          x1={M.left}
          y1={M.top}
          x2={M.left}
          y2={H - M.bottom}
          className={axis}
          strokeWidth="1"
        />
        <line
          x1={M.left}
          y1={H - M.bottom}
          x2={W - M.right}
          y2={H - M.bottom}
          className={axis}
          strokeWidth="1"
        />
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={M.left - 3}
              y1={py(t)}
              x2={M.left}
              y2={py(t)}
              className={axis}
              strokeWidth="1"
            />
            <text x={M.left - 6} y={py(t) + 3} textAnchor="end" className={tickText}>
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={t.text}>
            <line
              x1={px(t.at)}
              y1={H - M.bottom}
              x2={px(t.at)}
              y2={H - M.bottom + 3}
              className={axis}
              strokeWidth="1"
            />
            <text x={px(t.at)} y={H - M.bottom + 12} textAnchor="middle" className={tickText}>
              {t.text}
            </text>
          </g>
        ))}
        <g ref={fadeRef}>
          <path
            ref={pathRef}
            d={path}
            pathLength={1}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-brand-600 dark:stroke-brand-400"
            style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
          />
          <g ref={headRef}>
            <circle r={5} className="fill-white dark:fill-gray-900" />
            <circle r={3.5} className="fill-brand-600 dark:fill-brand-400" />
          </g>
          {/* The moving value label riding the curve head. */}
          <text
            ref={labelRef}
            textAnchor="middle"
            className="fill-brand-700 text-[10px] font-semibold tabular-nums dark:fill-brand-300"
          />
        </g>
      </svg>
    </div>
  );
}

const TRENDS: Array<{
  points: number[];
  yTicks: number[];
  xTicks: Array<{ at: number; text: string }>;
  format: (v: number) => string;
}> = [
  {
    points: [52, 58, 56, 64, 70, 75, 79],
    yTicks: [0, 50, 100],
    xTicks: [
      { at: 0, text: "v1" },
      { at: 3, text: "v4" },
      { at: 6, text: "v7" },
    ],
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    points: [0.42, 0.38, 0.39, 0.33, 0.3, 0.27, 0.25],
    yTicks: [0, 0.25, 0.5],
    xTicks: [
      { at: 0, text: "v1" },
      { at: 3, text: "v4" },
      { at: 6, text: "v7" },
    ],
    format: (v) => `$${v.toFixed(2)}`,
  },
  {
    points: [115, 107, 109, 98, 92, 87, 83],
    yTicks: [0, 60, 120],
    xTicks: [
      { at: 0, text: "v1" },
      { at: 3, text: "v4" },
      { at: 6, text: "v7" },
    ],
    format: (v) => `${v.toFixed(1)}s`,
  },
];

export function SelfImprove() {
  return (
    <Section
      id="self-improvement"
      eyebrow={S.selfImprove.eyebrow}
      title={S.selfImprove.title}
      subtitle={S.selfImprove.subtitle}
    >
      <div className="mx-auto grid max-w-5xl items-center gap-6 lg:grid-cols-[minmax(0,1fr)_15.5rem]">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <svg
            viewBox="0 0 720 380"
            role="img"
            aria-label={S.selfImprove.diagramLabel}
            className="mx-auto w-full max-w-2xl min-w-[34rem]"
          >
            <defs>
              <marker
                id="si-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 Z" className="fill-gray-400 dark:fill-gray-500" />
              </marker>
              <marker
                id="si-arrow-accent"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 Z" className="fill-brand-500 dark:fill-brand-400" />
              </marker>
            </defs>

            {/* Loop edges: Evaluators benchmark BOTH versions (vN and vN+1). */}
            <g
              fill="none"
              strokeWidth={1.5}
              className="stroke-gray-400 dark:stroke-gray-500"
              markerEnd="url(#si-arrow)"
            >
              <path d={EDGE_SPAWN} />
              <path d={EDGE_FEEDBACK} />
              <path d={EDGE_BENCH_OLD} />
              <path d={EDGE_BENCH_NEW} />
            </g>
            {/* The evolve chord: vN -> vN+1 is the story (the Optimizer's update lands here). */}
            <path
              d={EDGE_EVOLVE}
              fill="none"
              strokeWidth={2.5}
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#si-arrow-accent)"
            />

            {/* Moving dots along every arrow. */}
            <FlowDot path={EDGE_SPAWN} dur="2.4s" begin="0s" />
            <FlowDot path={EDGE_FEEDBACK} dur="2.4s" begin="1.2s" />
            <FlowDot path={EDGE_BENCH_OLD} dur="2.6s" begin="0.6s" />
            <FlowDot path={EDGE_BENCH_NEW} dur="2.6s" begin="1.9s" />
            <FlowDot path={EDGE_EVOLVE} dur="2.2s" begin="0s" accent r={2} />
            <FlowDot path={EDGE_EVOLVE} dur="2.2s" begin="1.1s" accent r={2} />

            <EdgeLabel x={322} y={120} anchor="end">
              {S.selfImprove.edgeSpawn}
            </EdgeLabel>
            <EdgeLabel x={398} y={120} anchor="start">
              {S.selfImprove.edgeFeedback}
            </EdgeLabel>
            {/* Centered between the two benchmark diagonals: it applies to both. */}
            <EdgeLabel x={360} y={252} anchor="middle">
              {S.selfImprove.edgeBench}
            </EdgeLabel>
            <EdgeLabel x={360} y={312} anchor="middle" accent>
              {S.selfImprove.edgeImprove}
            </EdgeLabel>

            {/* Evaluator stack (x N) */}
            <rect
              x={301}
              y={170}
              width={150}
              height={48}
              rx={10}
              className="fill-gray-100 stroke-gray-200 dark:fill-gray-800/60 dark:stroke-gray-700/60"
            />
            <rect
              x={293}
              y={162}
              width={150}
              height={48}
              rx={10}
              className="fill-gray-100 stroke-gray-200 dark:fill-gray-800/80 dark:stroke-gray-700/80"
            />
            <Node x={285} y={154} label={S.selfImprove.nodeEvaluator} />

            <Node x={285} y={28} label={S.selfImprove.nodeOptimizer} kind="accent" />
            <Node
              x={60}
              y={300}
              label={S.selfImprove.nodeTarget}
              badge={S.selfImprove.badgeOld}
              badgeKind="neutral"
            />
            <Node
              x={510}
              y={300}
              label={S.selfImprove.nodeTarget}
              kind="target"
              badge={S.selfImprove.badgeNew}
              badgeKind="accent"
            />
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {S.selfImprove.trends.map((t, i) => (
            <TrendChart
              key={t.label}
              label={t.label}
              hint={t.hint}
              points={TRENDS[i]?.points ?? []}
              yTicks={TRENDS[i]?.yTicks ?? [0, 1]}
              xTicks={TRENDS[i]?.xTicks ?? []}
              phase={i * 1.4}
              format={TRENDS[i]?.format ?? ((v) => v.toFixed(0))}
            />
          ))}
        </div>
      </div>
      <p className="mt-8 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-1 text-[13px] text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
          {S.selfImprove.videoSoon}
        </span>
      </p>
    </Section>
  );
}
