/** The default optimizer and evaluators, followed by a recorded round on a decision agent. */
import { AgentEvaluationDiagram } from "../components/application-diagrams";
import { S } from "../lib/strings";
import { useVisibleActivity } from "../lib/visible-activity";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { gallerySurfaceUrl } from "../lib/live-frame";
import { PHONE_VIEWPORT, useMedia } from "../lib/use-media";
import { StorySection } from "../components/story-section";
import { DemoVideo } from "../components/demo-video";
import { demoVideoUrl } from "../lib/community-assets";
import { useSiteLocale, useSiteTheme } from "@prismshadow/penguin-ui/site";
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
        className={`text-sm font-semibold ${title}`}
      >
        {label}
      </text>
      <text x={x + w / 2} y={y + 42} textAnchor="middle" className={`font-mono text-xs ${subText}`}>
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
          ? "fill-brand-700 text-xs font-medium dark:fill-brand-300"
          : "fill-gray-500 text-xs dark:fill-gray-400"
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
      <p className={`mt-0.5 font-mono text-xs break-all ${subText}`}>{sub}</p>
    </div>
  );
}

/** The same loop read top to bottom, for widths where the drawing's labels would get too small. */
function MobileEvolutionFlow() {
  const c = S.selfImprove;
  const edge = "text-xs text-gray-500 dark:text-gray-400";
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
        <p className="text-center text-xs font-medium text-brand-700 dark:text-brand-300">
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
  const { dark } = useSiteTheme();
  const phone = useMedia(PHONE_VIEWPORT);
  const demo = DEMO[locale];
  return (
    <StorySection
      id="self-evolution"
      title={c.title}
      intro={c.toolkit}
      action={<a href={gallerySurfaceUrl("benchmark", locale, dark, phone)}>{c.center}</a>}
    >
      <AgentEvaluationDiagram />
      <div className="story-evidence">
        <div>
          <h3>{c.framework}</h3>
          <p>{c.baseline}</p>
          <p>{c.diagnosis}</p>
          <p>{c.subtitle}</p>
          <p>{c.acceptance}</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-4 dark:bg-gray-900">
          <MobileEvolutionFlow />
          <LoopDiagram />
        </div>
      </div>
      <figure className="mx-auto mt-8 max-w-4xl sm:mt-12">
        <DemoVideo src={demo.video} poster={demo.poster} label={c.demo.caption} />
        <figcaption className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
          {c.demo.cost}
        </figcaption>
      </figure>
    </StorySection>
  );
}
