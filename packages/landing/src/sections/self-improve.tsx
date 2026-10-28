/**
 * One self-evolution round, drawn as the loop it is. The Optimizer (an ordinary agent running the
 * agent-optimization Skill) dispatches Evaluator subagents (agent-evaluation), which run the
 * tested agent on each Benchmark case and score it; scores and Traces flow back, and the
 * Optimizer's change turns version N into N+1, drawn as the bold evolve arrow between the two
 * versions. Beside it, the three numbers the scoreboard records for every version, each line
 * growing from the left on a slow loop.
 *
 * The chart values are illustrative. Their shapes follow the rules, not a
 * wish: the score only rises because a version is kept only when it scores higher, while cost and
 * duration are recorded but never optimised, so they wander. Phones get the same loop as a stacked
 * reading. Reduced motion: the flow dots stay off and every line is drawn finished. Under the
 * panel, the recorded demo of a decision agent's round, with what its test runs cost.
 */
import { useEffect, useRef } from "react";
import { S } from "../lib/strings";
import { useVisibleActivity } from "../lib/visible-activity";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { Section } from "../components/section";
import { DemoVideo } from "../components/demo-video";
import { demoVideoUrl } from "../lib/links";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import demoPosterZh from "../assets/shots/decision-evo-zh.webp";
import demoPosterEn from "../assets/shots/decision-evo-en.webp";

/** Skill names and version marks are identifiers, the same in every language. */
const OPTIMIZER_SKILL = "agent-optimization";
const EVALUATOR_SKILL = "agent-evaluation";
const VERSION_OLD = "vN";
const VERSION_NEW = "vN+1";

type NodeKind = "accent" | "target" | "neutral";

/** A role: its name over the Skill it runs (or the version it is), both centred. */
function Node({
  x,
  y,
  w,
  h = 56,
  label,
  sub,
  kind = "neutral",
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  sub: string;
  kind?: NodeKind;
}) {
  const rect =
    kind === "accent"
      ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
      : kind === "target"
        ? "fill-brand-50 stroke-brand-200 dark:fill-brand-950 dark:stroke-brand-800"
        : "fill-white stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700";
  const title =
    kind === "target" ? "fill-brand-800 dark:fill-brand-200" : "fill-gray-900 dark:fill-gray-100";
  const subText =
    kind === "target" ? "fill-brand-700 dark:fill-brand-300" : "fill-gray-500 dark:fill-gray-400";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} strokeWidth={1.5} className={rect} />
      <text
        x={x + w / 2}
        y={y + 24}
        textAnchor="middle"
        className={`text-[13.5px] font-semibold ${title}`}
      >
        {label}
      </text>
      <text
        x={x + w / 2}
        y={y + 42}
        textAnchor="middle"
        className={`font-mono text-[11px] ${subText}`}
      >
        {sub}
      </text>
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
          ? "fill-brand-700 text-[11.5px] font-medium dark:fill-brand-300"
          : "fill-gray-500 text-[11.5px] dark:fill-gray-400"
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
  r = 1.75,
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

/**
 * Geometry of the drawing: the Optimizer on top, the Evaluator stack in the middle, the two
 * versions of the tested agent at the bottom corners. Every arrow ends on its node's edge; the
 * viewBox is cropped to the drawn content so the diagram fills its column.
 */
const OPT = { x: 270, y: 16, w: 180 };
const EVAL = { x: 270, y: 150, w: 180 };
const OLD = { x: 50, y: 300, w: 170 };
const NEW = { x: 500, y: 300, w: 170 };
const NODE_H = 56;

const EDGE_SPAWN = "M330,74 L330,149";
const EDGE_FEEDBACK = "M390,150 L390,73";
const EDGE_BENCH_OLD = "M300,208 L150,299";
const EDGE_BENCH_NEW = "M420,208 L570,299";
const EDGE_EVOLVE = "M226,328 L494,328";

/** Draw-loop timing: grow, hold, fade, repeat. */
const CYCLE_S = 4.6;
const DRAW_END = 0.55;
const HOLD_END = 0.84;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/**
 * One recorded number across the versions, with hairline axes and ticks. A single rAF clock grows
 * the line from the left and carries the value on the moving head, so the number changes as the
 * curve moves. Reduced motion shows the finished line with its last value.
 */
function TrendChart({
  label,
  hint,
  points,
  yTicks,
  phase,
  format,
}: {
  label: string;
  hint: string;
  points: readonly number[];
  yTicks: readonly number[];
  /** Seconds this chart runs ahead of the shared cycle (staggers the trio). */
  phase: number;
  format: (v: number) => string;
}) {
  const W = 210;
  const H = 84;
  const M = { left: 34, right: 12, top: 14, bottom: 20 };
  const yMax = Math.max(...yTicks);
  const yMin = Math.min(...yTicks);
  const last = points.length - 1;
  const px = (i: number) => M.left + (i / last) * (W - M.left - M.right);
  const py = (v: number) => M.top + ((yMax - v) / (yMax - yMin || 1)) * (H - M.top - M.bottom);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`).join(" ");
  const xTicks = [0, Math.round(last / 2), last];
  const axis = "stroke-gray-200 dark:stroke-gray-800";
  const tickText = "fill-gray-400 text-[8.5px] tabular-nums dark:fill-gray-500";

  const { ref, active } = useVisibleActivity<HTMLElement>();
  const reduced = usePrefersReducedMotion();
  const fadeRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const valueRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    const fade = fadeRef.current;
    const line = pathRef.current;
    const head = headRef.current;
    const value = valueRef.current;
    if (!fade || !line || !head || !value) return;

    const apply = (p: number, opacity: number) => {
      line.style.strokeDashoffset = String(1 - p);
      const f = p * last;
      const i0 = Math.floor(f);
      const i1 = Math.min(last, i0 + 1);
      const v = (points[i0] ?? 0) + ((points[i1] ?? 0) - (points[i0] ?? 0)) * (f - i0);
      const x = px(f);
      const y = py(v);
      head.setAttribute("transform", `translate(${x}, ${y})`);
      value.textContent = format(v);
      value.setAttribute("x", String(Math.min(W - M.right - 10, Math.max(M.left + 12, x))));
      value.setAttribute("y", String(Math.max(10, y - 9)));
      fade.style.opacity = String(opacity);
    };

    if (reduced || !active) {
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
  }, [points, phase, format, active, reduced]);

  return (
    <figure ref={ref} className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold tracking-tight">{label}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" aria-hidden="true">
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
        {xTicks.map((i) => (
          <g key={i}>
            <line
              x1={px(i)}
              y1={H - M.bottom}
              x2={px(i)}
              y2={H - M.bottom + 3}
              className={axis}
              strokeWidth="1"
            />
            <text x={px(i)} y={H - M.bottom + 12} textAnchor="middle" className={tickText}>
              {`v${i + 1}`}
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
            <circle r={5} className="fill-gray-50 dark:fill-gray-900" />
            <circle r={3.5} className="fill-brand-600 dark:fill-brand-400" />
          </g>
          <text
            ref={valueRef}
            textAnchor="middle"
            className="fill-brand-700 text-[10px] font-semibold tabular-nums dark:fill-brand-300"
          />
        </g>
      </svg>
    </figure>
  );
}

/**
 * Illustrative values for seven kept versions, index-aligned with S.selfImprove.trends. The score
 * strictly rises (a version that does not score higher is never kept); cost and duration wander.
 */
const TRENDS: ReadonlyArray<{
  points: readonly number[];
  yTicks: readonly number[];
  format: (v: number) => string;
}> = [
  {
    points: [46, 52, 55, 61, 64, 69, 73],
    yTicks: [0, 50, 100],
    format: (v) => v.toFixed(1),
  },
  {
    points: [0.31, 0.35, 0.3, 0.37, 0.33, 0.29, 0.34],
    yTicks: [0, 0.25, 0.5],
    format: (v) => `$${v.toFixed(2)}`,
  },
  {
    points: [86, 97, 91, 104, 95, 89, 99],
    yTicks: [0, 60, 120],
    format: (v) => `${Math.round(v)}s`,
  },
];

function MobileNode({
  label,
  sub,
  kind = "neutral",
}: {
  label: string;
  sub: string;
  kind?: NodeKind;
}) {
  const box =
    kind === "accent"
      ? "border-brand-500 bg-white text-gray-900 dark:border-brand-400 dark:bg-gray-900 dark:text-gray-100"
      : kind === "target"
        ? "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200"
        : "border-gray-300 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
  const subText =
    kind === "target" ? "text-brand-700 dark:text-brand-300" : "text-gray-500 dark:text-gray-400";
  return (
    <div className={`min-w-0 rounded-lg border-[1.5px] px-2 py-2 text-center ${box}`}>
      <p className="text-xs font-semibold">{label}</p>
      <p className={`mt-0.5 font-mono text-[11px] break-all ${subText}`}>{sub}</p>
    </div>
  );
}

/** The same loop read top to bottom, for widths where the drawing's labels would get too small. */
function MobileEvolutionFlow() {
  const c = S.selfImprove;
  const edge = "text-[11px] leading-4 text-gray-500 dark:text-gray-400";
  return (
    <div role="img" aria-label={c.diagramLabel} className="md:hidden">
      <MobileNode label={c.nodeOptimizer} sub={OPTIMIZER_SKILL} kind="accent" />
      <div className={`grid grid-cols-2 gap-3 py-2 text-center ${edge}`}>
        <p>
          {c.edgeSpawn}
          <span className="block" aria-hidden="true">
            ↓
          </span>
        </p>
        <p>
          <span className="block" aria-hidden="true">
            ↑
          </span>
          {c.edgeFeedback}
        </p>
      </div>
      <MobileNode label={c.nodeEvaluator} sub={EVALUATOR_SKILL} />
      <p className={`py-2 text-center ${edge}`}>
        {c.edgeBench}
        <span className="block" aria-hidden="true">
          ↓
        </span>
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        <MobileNode label={c.nodeTarget} sub={VERSION_OLD} />
        <p className="text-center text-[11px] leading-4 font-medium text-brand-700 dark:text-brand-300">
          {c.edgeImprove}
          <span className="block text-base leading-5" aria-hidden="true">
            →
          </span>
        </p>
        <MobileNode label={c.nodeTarget} sub={VERSION_NEW} kind="target" />
        <p className={`self-start text-center ${edge}`}>{c.noteOld}</p>
        <span />
        <p className={`self-start text-center ${edge}`}>{c.noteNew}</p>
      </div>
    </div>
  );
}

function LoopDiagram() {
  const c = S.selfImprove;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<SVGSVGElement>();
  return (
    <svg
      ref={ref}
      viewBox="30 8 660 380"
      role="img"
      aria-label={c.diagramLabel}
      className="mx-auto hidden w-full max-w-[760px] md:block"
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

      {/* The loop: dispatch down, scores up, and every version run on the Benchmark. */}
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
      {/* The evolve chord: the Optimizer's change turns vN into vN+1. */}
      <path
        d={EDGE_EVOLVE}
        fill="none"
        strokeWidth={2.5}
        className="stroke-brand-500 dark:stroke-brand-400"
        markerEnd="url(#si-arrow-accent)"
      />

      {active && !reduced && (
        <>
          <FlowDot path={EDGE_SPAWN} dur="2.4s" begin="0s" />
          <FlowDot path={EDGE_FEEDBACK} dur="2.4s" begin="1.2s" />
          <FlowDot path={EDGE_BENCH_OLD} dur="2.6s" begin="0.6s" />
          <FlowDot path={EDGE_BENCH_NEW} dur="2.6s" begin="1.9s" />
          <FlowDot path={EDGE_EVOLVE} dur="2.2s" begin="0s" accent r={2.25} />
          <FlowDot path={EDGE_EVOLVE} dur="2.2s" begin="1.1s" accent r={2.25} />
        </>
      )}

      <EdgeLabel x={322} y={116} anchor="end">
        {c.edgeSpawn}
      </EdgeLabel>
      <EdgeLabel x={398} y={116} anchor="start">
        {c.edgeFeedback}
      </EdgeLabel>
      {/* Between the two diagonals: every version is run on the same cases. */}
      <EdgeLabel x={360} y={262}>
        {c.edgeBench}
      </EdgeLabel>
      <EdgeLabel x={360} y={316} accent>
        {c.edgeImprove}
      </EdgeLabel>

      {/* Evaluator × N: two cards behind the front one. */}
      <rect
        x={EVAL.x + 16}
        y={EVAL.y + 16}
        width={EVAL.w}
        height={NODE_H}
        rx={10}
        className="fill-gray-100 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700/50"
      />
      <rect
        x={EVAL.x + 8}
        y={EVAL.y + 8}
        width={EVAL.w}
        height={NODE_H}
        rx={10}
        className="fill-gray-100 stroke-gray-200 dark:fill-gray-800/80 dark:stroke-gray-700/80"
      />
      <Node {...EVAL} label={c.nodeEvaluator} sub={EVALUATOR_SKILL} />
      <Node {...OPT} label={c.nodeOptimizer} sub={OPTIMIZER_SKILL} kind="accent" />
      <Node {...OLD} label={c.nodeTarget} sub={VERSION_OLD} />
      <Node {...NEW} label={c.nodeTarget} sub={VERSION_NEW} kind="target" />

      <EdgeLabel x={OLD.x + OLD.w / 2} y={OLD.y + NODE_H + 20}>
        {c.noteOld}
      </EdgeLabel>
      <EdgeLabel x={NEW.x + NEW.w / 2} y={NEW.y + NODE_H + 20}>
        {c.noteNew}
      </EdgeLabel>
    </svg>
  );
}

/** The recorded demo and its title-frame poster, per language. */
const DEMO: Record<Locale, { video: string; poster: string }> = {
  zh: { video: demoVideoUrl("decision_evo_zh"), poster: demoPosterZh },
  en: { video: demoVideoUrl("decision_evo_en"), poster: demoPosterEn },
};

export function SelfImprove() {
  const c = S.selfImprove;
  const { locale } = useSiteLocale();
  const demo = DEMO[locale];
  return (
    <Section id="self-evolution" title={c.title} subtitle={c.subtitle}>
      <div className="rounded-2xl bg-gray-50 p-5 sm:p-8 dark:bg-gray-900/60">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
          <MobileEvolutionFlow />
          <LoopDiagram />
          <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-1 lg:gap-5">
            {c.trends.map((t, i) => {
              const data = TRENDS[i];
              if (!data) return null;
              return (
                <TrendChart
                  key={t.label}
                  label={t.label}
                  hint={t.hint}
                  points={data.points}
                  yTicks={data.yTicks}
                  phase={i * 1.4}
                  format={data.format}
                />
              );
            })}
          </div>
        </div>
        <p className="mt-6 text-xs leading-5 text-gray-500 dark:text-gray-400">{c.trendsNote}</p>
      </div>
      <figure className="mx-auto mt-10 max-w-5xl">
        <DemoVideo src={demo.video} poster={demo.poster} label={c.demo.caption} />
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {c.demo.caption}
        </figcaption>
        <p className="mt-2 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
          {c.demo.cost}
        </p>
      </figure>
    </Section>
  );
}
