/**
 * Progressive 4-Stage Spotlight Diagram for Section 4 of the GDPEVO blog post.
 *
 * Matches Section 2's visual & motion language 1-to-1:
 * All 4 columns stay in place on the 4-column horizontal grid (CY = 170), transitioning smoothly
 * from dimmed ghost (opacity 0.24) -> bright active spotlight -> calm completed state:
 *   Stage 1 (Col 1, x = 8..242):   `1. 多轮训练循环` / `1. Multi-Round Train`
 *                                  `1 Shared Docker` — 3+2 `T1..T5` (left) <-> `Target Agent` (right, w=86)
 *   Stage 2 (Col 2, x = 262..356): `2. 产出进化 Agent` / `2. Evolved Agent`
 *                                  Exports frozen `Evolved Agent (+ SKILL.md)`
 *   Stage 3 (Col 3, x = 390..542): `3. 多轮隔离测试` / `3. Isolated Testing`
 *                                  `Isolated Test Dockers` — 5 stacked `Test 1..5` (x3 runs)
 *   Stage 4 (Col 4, x = 576..712): `4. 离线判分出分` / `4. Scoreboard`
 *                                  `Offline Verifier` — per-task scores (`T1..T5`) + `68.95 ± 0.74`
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

const TOTAL_TICKS = 22;

interface StageTab {
  readonly id: string;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly startTick: number;
  readonly endTick: number;
}

const STAGE_TABS: readonly StageTab[] = [
  {
    id: "train",
    labelZh: "1. 多轮训练循环",
    labelEn: "1. Multi-Round Train",
    startTick: 0,
    endTick: 11,
  },
  {
    id: "freeze",
    labelZh: "2. 产出进化 Agent",
    labelEn: "2. Evolved Agent",
    startTick: 12,
    endTick: 13,
  },
  {
    id: "test",
    labelZh: "3. 多轮隔离测试",
    labelEn: "3. Isolated Testing",
    startTick: 14,
    endTick: 17,
  },
  {
    id: "result",
    labelZh: "4. 离线判分出分",
    labelEn: "4. Scoreboard",
    startTick: 18,
    endTick: 21,
  },
];

/**
 * 3+2 training task cards inside `1 Shared Docker` (x=8..242, y=92..248):
 * Placed on the LEFT side (x=18..126) so tasks feed into `Target Agent` on the RIGHT (x=148..234, w=86),
 * which then exports directly out the right wall of `1 Shared Docker` into `Evolved Agent (+ SKILL.md)`.
 */
const TRAIN_CARDS = [
  { label: "T1", x: 22, y: 150, w: 30, h: 30 },
  { label: "T2", x: 56, y: 150, w: 30, h: 30 },
  { label: "T3", x: 90, y: 150, w: 30, h: 30 },
  { label: "T4", x: 39, y: 186, w: 30, h: 30 },
  { label: "T5", x: 73, y: 186, w: 30, h: 30 },
] as const;

/** Vertical center Y coordinates for the 5 stacked horizontal Isolated Test Dockers (centered on CY=170). */
const TEST_ROWS_Y = [106, 138, 170, 202, 234] as const;

/** Per-task verified scores displayed inside the rightmost Offline Verifier Scoreboard column. */
const VERIFIER_SCORES = [
  { label: "Test 1", score: 74.3, width: 28 },
  { label: "Test 2", score: 65.8, width: 25 },
  { label: "Test 3", score: 80.7, width: 31 },
  { label: "Test 4", score: 63.9, width: 24 },
  { label: "Test 5", score: 73.7, width: 28 },
] as const;

function tickDelayMs(tick: number): number {
  if (tick === 5 || tick === 11) return 1100;
  if (tick < 12) return 520;
  if (tick === 13) return 1200;
  if (tick >= 14 && tick <= 17) return 780;
  if (tick === 21) return 3200;
  return 800;
}

/** Crisp inline SVG Docker whale + stacked container blocks mark (15x11px). */
function DockerWhale({ x, y, active }: { x: number; y: number; active: boolean }) {
  const fill = active ? "fill-brand-600 dark:fill-brand-400" : "fill-gray-400 dark:fill-gray-500";
  return (
    <g transform={`translate(${x}, ${y})`} className={fill}>
      {/* Stacked container blocks on the whale's back */}
      <rect x="2" y="2.2" width="2.1" height="2" rx="0.3" />
      <rect x="4.6" y="2.2" width="2.1" height="2" rx="0.3" />
      <rect x="7.2" y="2.2" width="2.1" height="2" rx="0.3" />
      <rect x="4.6" y="0" width="2.1" height="1.8" rx="0.3" />
      <rect x="7.2" y="0" width="2.1" height="1.8" rx="0.3" />
      {/* Whale body and tail */}
      <path d="M0.5,5.1 H11.2 C12.1,5.1 12.9,4.5 13.3,3.6 C13.9,3.9 14.3,4.5 14.2,5.3 C14.9,5.1 15.5,5.3 15.8,5.8 C15.2,6.5 14.4,6.8 13.5,6.7 C12.6,9.1 10.1,10.5 6.4,10.5 C2.8,10.5 0.6,8.7 0.5,5.1 Z" />
    </g>
  );
}

export function GdpevoOrchestrationWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  const [tick, setTick] = useState<number>(21);
  const [paused, setPaused] = useState<boolean>(false);
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const running = active && !reduced && !paused;

  useEffect(() => {
    if (active && !reduced && !hasStarted) {
      setHasStarted(true);
      setTick(0);
    }
  }, [active, reduced, hasStarted]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setTick((prev) => (prev + 1) % TOTAL_TICKS);
    }, tickDelayMs(tick));
    return () => window.clearTimeout(timer);
  }, [running, tick]);

  const activeStageIdx = STAGE_TABS.findIndex((s) => tick >= s.startTick && tick <= s.endTick);

  const selectStage = (idx: number) => {
    const target = STAGE_TABS[idx];
    if (!target) return;
    if (idx === 0) {
      setTick(0);
      setPaused(false);
    } else {
      setTick(target.endTick);
      setPaused(true);
    }
  };

  // Derive visual state from `tick` (0..21)
  const isS0 = activeStageIdx === 0;
  const isS1 = activeStageIdx === 1;
  const isS2 = activeStageIdx === 2;
  const isS3 = activeStageIdx === 3;

  const reachedS1 = tick >= 12;
  const reachedS2 = tick >= 14;
  const reachedS3 = tick >= 18;

  const trainRound = tick < 6 ? 1 : 2;
  const activeTaskIdx = tick < 5 ? tick : tick >= 6 && tick < 11 ? tick - 6 : -1;
  const isSkillUpdating = tick === 5 || tick === 11;
  const skillBadge = tick < 5 ? "No Skill" : tick < 11 ? "Skill v1" : "Skill v2";

  const completedTestRuns = tick < 15 ? 0 : tick === 15 ? 1 : tick === 16 ? 2 : 3;
  const revealedScores = tick < 18 ? 0 : tick === 18 ? 2 : tick === 19 ? 4 : 5;
  const showFinalMean = tick >= 20;

  const copy = isZh
    ? {
        play: "播放实验动态演进",
        pause: "暂停实验动态演进",
        controllerAgent: "主控 Agent",
        targetAgent: "目标 Agent",
        evolvedAgent: "进化 Agent",
        verifier: "离线评分器",
        finalScore: "最终均分",
      }
    : {
        play: "Play experiment flow",
        pause: "Pause experiment flow",
        controllerAgent: "Controller Agent",
        targetAgent: "Target Agent",
        evolvedAgent: "Evolved Agent",
        verifier: "Offline Verifier",
        finalScore: "Final Score",
      };

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      {/* Minimal Frameless Control Strip */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Experiment stages"
        >
          {STAGE_TABS.map((s, idx) => {
            const isCurrent = idx === activeStageIdx;
            const isReached = tick >= s.startTick;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => selectStage(idx)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  isCurrent
                    ? "bg-brand-600 text-white dark:bg-brand-500 dark:text-gray-950"
                    : isReached
                      ? "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/70 dark:text-brand-300 dark:hover:bg-brand-900/60"
                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                }`}
              >
                {isZh ? s.labelZh : s.labelEn}
              </button>
            );
          })}
        </div>
        <SitePlaybackButton
          paused={paused}
          onPausedChange={setPaused}
          labels={{ play: copy.play, pause: copy.pause }}
        />
      </div>

      {/* Strictly Left-to-Right 4-Column Spotlight SVG (All Columns Stay in Place, Gray -> Bright) */}
      <svg
        viewBox="0 0 720 256"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label="PenguinHarness GDPEVO experiment orchestration"
      >
        <defs>
          <marker
            id="pg-arrow-brand"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 Z" className="fill-brand-500 dark:fill-brand-400" />
          </marker>
          <marker
            id="pg-arrow-gray"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 Z" className="fill-gray-400 dark:fill-gray-500" />
          </marker>
          <marker
            id="pg-arrow-emerald"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 Z" className="fill-emerald-600 dark:fill-emerald-400" />
          </marker>
        </defs>

        {/* ==================== TOP ORCHESTRATOR: CONTROLLER AGENT (Centered at x=295, y=26) ==================== */}
        <g>
          <rect
            x="222"
            y="6"
            width="146"
            height="40"
            rx="8"
            strokeWidth="1.5"
            className="fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
          />
          <text
            x="295"
            y="31"
            textAnchor="middle"
            className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
          >
            {copy.controllerAgent}
          </text>
        </g>

        {/* ==================== COL 1: HARBOR -> 1 SHARED DOCKER (x=8..242, y=92..248, CY=170) ==================== */}
        <g>
          <path
            d="M222,26 L125,26 L125,90"
            fill="none"
            strokeWidth={isS0 ? "1.75" : "1.5"}
            strokeLinejoin="round"
            className={
              isS0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS0 ? "url(#pg-arrow-brand)" : "url(#pg-arrow-gray)"}
          />
          <rect
            x="96"
            y="44"
            width="58"
            height="20"
            rx="5"
            strokeWidth="1.25"
            className={
              isS0
                ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="125"
            y="58"
            textAnchor="middle"
            className={
              isS0
                ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 font-mono text-xs font-semibold dark:fill-gray-400"
            }
          >
            Harbor
          </text>

          {/* 1 Shared Docker Boundary (x=8..242, y=92..248, h=156) */}
          <rect
            x="8"
            y="92"
            width="234"
            height="156"
            rx="10"
            strokeWidth={isS0 ? "2" : "1.5"}
            strokeDasharray="6 4"
            className={
              isS0
                ? "fill-brand-50/35 stroke-brand-600 dark:fill-brand-950/25 dark:stroke-brand-400"
                : "fill-gray-50/50 stroke-gray-300 dark:fill-gray-900/40 dark:stroke-gray-700"
            }
          />
          <DockerWhale x={18} y={103} active={isS0} />
          <text
            x="37"
            y="113"
            className={
              isS0
                ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 font-mono text-xs font-semibold dark:fill-gray-400"
            }
          >
            1 Shared Docker
          </text>
          {/* Live Round Pill in top-right of 1 Shared Docker */}
          <rect
            x="164"
            y="100"
            width="66"
            height="18"
            rx="4"
            className={
              isS0 ? "fill-brand-100 dark:fill-brand-900/70" : "fill-gray-200/80 dark:fill-gray-800"
            }
          />
          <text
            x="197"
            y="113"
            textAnchor="middle"
            className={
              isS0
                ? "fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
                : "fill-gray-600 font-mono text-xs font-medium tabular-nums dark:fill-gray-400"
            }
          >
            {isS0 ? `Round ${trainRound}/2` : "2/2 Done"}
          </text>

          {/* Clean Bidirectional Loop between Train Set Pool on LEFT (x=16..126) and Target Agent on RIGHT (x=148..234) */}
          <rect
            x="16"
            y="126"
            width="110"
            height="98"
            rx="8"
            strokeWidth="1"
            className="fill-white/80 stroke-gray-200 dark:fill-gray-800/40 dark:stroke-gray-700"
          />
          <text
            x="71"
            y="141"
            textAnchor="middle"
            className={
              isS0
                ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 font-mono text-xs font-medium dark:fill-gray-400"
            }
          >
            Train Set
          </text>
          <path
            d="M126,166 L146,166"
            fill="none"
            strokeWidth={isSkillUpdating ? "2" : "1.5"}
            className={
              isSkillUpdating
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : isS0
                  ? "stroke-brand-500 dark:stroke-brand-400"
                  : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={
              isSkillUpdating
                ? "url(#pg-arrow-emerald)"
                : isS0
                  ? "url(#pg-arrow-brand)"
                  : "url(#pg-arrow-gray)"
            }
          />
          <path
            d="M148,192 L128,192"
            fill="none"
            strokeWidth="1.5"
            className={
              isS0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS0 ? "url(#pg-arrow-brand)" : "url(#pg-arrow-gray)"}
          />

          {/* 3+2 Training Task Cards on LEFT (T1..T5 in natural left-to-right reading order) */}
          {TRAIN_CARDS.map((card, i) => {
            const isCurrentTask = isS0 && i === activeTaskIdx;
            const doneRound2 = tick > 6 + i;
            const doneRound1 = tick > i && tick < 6;
            const cardStyle = isCurrentTask
              ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
              : isS0 && doneRound2
                ? "fill-emerald-50 stroke-emerald-500 dark:fill-emerald-950/60 dark:stroke-emerald-400"
                : isS0 && doneRound1
                  ? "fill-brand-50 stroke-brand-400 dark:fill-brand-950/60 dark:stroke-brand-500"
                  : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700";
            const textStyle = isCurrentTask
              ? "fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
              : isS0 && doneRound2
                ? "fill-emerald-800 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-200"
                : isS0 && doneRound1
                  ? "fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
                  : "fill-gray-600 font-mono text-xs font-medium tabular-nums dark:fill-gray-400";
            return (
              <g key={card.label}>
                <rect
                  x={card.x}
                  y={card.y}
                  width={card.w}
                  height={card.h}
                  rx="6"
                  strokeWidth={isCurrentTask ? "1.75" : "1.25"}
                  className={cardStyle}
                />
                <text
                  x={card.x + card.w / 2}
                  y={card.y + 19}
                  textAnchor="middle"
                  className={textStyle}
                >
                  {card.label}
                </text>
              </g>
            );
          })}

          {/* Target Agent Node on RIGHT inside 1 Shared Docker (x=148..234, w=86, y=142..214, h=72) */}
          <rect
            x="148"
            y="142"
            width="86"
            height="72"
            rx="8"
            strokeWidth="1.5"
            className={
              isSkillUpdating
                ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950 dark:stroke-emerald-400"
                : isS0
                  ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                  : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="191"
            y="168"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {copy.targetAgent}
          </text>
          <rect
            x="157"
            y="180"
            width="68"
            height="22"
            rx="4"
            className={
              !isS0
                ? "fill-gray-100 dark:fill-gray-800"
                : tick < 5
                  ? "fill-gray-100 dark:fill-gray-800"
                  : tick < 11
                    ? "fill-brand-100 dark:fill-brand-900"
                    : "fill-emerald-100 dark:fill-emerald-900"
            }
          />
          <text
            x="191"
            y="195"
            textAnchor="middle"
            className={
              !isS0
                ? "fill-gray-600 font-mono text-xs font-medium dark:fill-gray-400"
                : tick < 5
                  ? "fill-gray-500 font-mono text-xs font-medium dark:fill-gray-400"
                  : tick < 11
                    ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                    : "fill-emerald-700 font-mono text-xs font-semibold dark:fill-emerald-300"
            }
          >
            {skillBadge}
          </text>
        </g>

        {/* ==================== COL 2: EVOLVED AGENT (+ SKILL.MD) (x=262..356, CY=170) ==================== */}
        <g style={{ opacity: reachedS1 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M242,170 L260,170"
            fill="none"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS1 ? "url(#pg-arrow-emerald)" : "url(#pg-arrow-gray)"}
          />
          <rect
            x="262"
            y="134"
            width="94"
            height="72"
            rx="8"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "fill-emerald-50/60 stroke-emerald-600 dark:fill-emerald-950/60 dark:stroke-emerald-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="309"
            y="164"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {copy.evolvedAgent}
          </text>
          <text
            x="309"
            y="186"
            textAnchor="middle"
            className={
              isS1
                ? "fill-emerald-700 font-mono text-xs font-semibold dark:fill-emerald-300"
                : "fill-gray-500 font-mono text-xs font-medium dark:fill-gray-400"
            }
          >
            + SKILL.md
          </text>
        </g>

        {/* ==================== COL 3: HARBOR -> ISOLATED TEST DOCKERS (x=390..542, CY=170) ==================== */}
        <g style={{ opacity: reachedS2 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M368,26 L466,26 L466,74"
            fill="none"
            strokeWidth={isS2 ? "1.75" : "1.5"}
            strokeLinejoin="round"
            className={
              isS2
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS2 ? "url(#pg-arrow-brand)" : "url(#pg-arrow-gray)"}
          />
          <rect
            x="437"
            y="44"
            width="58"
            height="20"
            rx="5"
            strokeWidth="1.25"
            className={
              isS2
                ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="466"
            y="58"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 font-mono text-xs font-semibold dark:fill-gray-400"
            }
          >
            Harbor
          </text>

          <DockerWhale x={378} y={78} active={isS2} />
          <text
            x="474"
            y="88"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 font-mono text-xs font-semibold dark:fill-gray-400"
            }
          >
            Isolated Test Dockers
          </text>

          {/* 1-to-5 Orthogonal Fork Tree (x=356..390, y=106..234, center CY=170) */}
          <path
            d="M356,170 L373,170 M373,106 L373,234"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="round"
            className={
              isS2
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
          />
          {TEST_ROWS_Y.map((ry, idx) => (
            <path
              key={`fork-${idx}`}
              d={`M373,${ry} L388,${ry}`}
              fill="none"
              strokeWidth="1.5"
              className={
                isS2
                  ? "stroke-brand-500 dark:stroke-brand-400"
                  : "stroke-gray-300 dark:stroke-gray-600"
              }
              markerEnd={isS2 ? "url(#pg-arrow-brand)" : "url(#pg-arrow-gray)"}
            />
          ))}

          {/* 5 Vertically Stacked Horizontal Isolated Test Dockers (x=390..542, h=26, y=93..247) */}
          {TEST_ROWS_Y.map((ry, idx) => {
            const topY = ry - 13;
            return (
              <g key={`test-row-${idx}`}>
                <rect
                  x="390"
                  y={topY}
                  width="152"
                  height="26"
                  rx="6"
                  strokeWidth={isS2 ? "1.5" : "1.25"}
                  className={
                    isS2
                      ? "fill-brand-50/30 stroke-brand-500 dark:fill-brand-950/25 dark:stroke-brand-400"
                      : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                  }
                />
                <text
                  x="402"
                  y={ry + 4}
                  className={
                    isS2
                      ? "fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
                      : "fill-gray-700 font-mono text-xs font-medium tabular-nums dark:fill-gray-300"
                  }
                >
                  {`Test ${idx + 1}`}
                </text>
                <line
                  x1="454"
                  y1={topY + 5}
                  x2="454"
                  y2={topY + 21}
                  strokeWidth="1"
                  className="stroke-gray-200 dark:stroke-gray-700"
                />
                <text
                  x="466"
                  y={ry + 4}
                  className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
                >
                  ×3
                </text>
                {[1, 2, 3].map((rNum) => {
                  const done = completedTestRuns >= rNum;
                  return (
                    <rect
                      key={rNum}
                      x={490 + (rNum - 1) * 15}
                      y={ry - 6}
                      width="11"
                      height="12"
                      rx="2.5"
                      className={
                        done
                          ? isS2
                            ? "fill-brand-600 dark:fill-brand-400"
                            : "fill-gray-400 dark:fill-gray-500"
                          : "fill-gray-100 dark:fill-gray-800"
                      }
                    />
                  );
                })}
              </g>
            );
          })}
        </g>

        {/* ==================== COL 4: OFFLINE VERIFIER SCOREBOARD COLUMN (x=572..714, y=92..248, CY=170) ==================== */}
        <g style={{ opacity: reachedS3 ? 1 : 0.24 }} className="transition-opacity duration-200">
          {TEST_ROWS_Y.map((ry, idx) => (
            <path
              key={`join-${idx}`}
              d={`M542,${ry} L556,${ry}`}
              fill="none"
              strokeWidth="1.5"
              className={
                isS3
                  ? "stroke-emerald-600 dark:stroke-emerald-400"
                  : "stroke-gray-300 dark:stroke-gray-600"
              }
            />
          ))}
          <path
            d="M556,106 L556,234 M556,170 L570,170"
            fill="none"
            strokeWidth={isS3 ? "1.75" : "1.5"}
            strokeLinejoin="round"
            className={
              isS3
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS3 ? "url(#pg-arrow-emerald)" : "url(#pg-arrow-gray)"}
          />

          <rect
            x="572"
            y="92"
            width="142"
            height="156"
            rx="10"
            strokeWidth={isS3 ? "2" : "1.5"}
            className={
              isS3
                ? "fill-emerald-50/35 stroke-emerald-600 dark:fill-emerald-950/25 dark:stroke-emerald-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="643"
            y="112"
            textAnchor="middle"
            className={
              isS3
                ? "fill-emerald-800 text-xs font-semibold dark:fill-emerald-200"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.verifier}
          </text>

          {/* 5 Per-Task Verified Score Bars inside the Scoreboard Column */}
          {VERIFIER_SCORES.map((item, idx) => {
            const sy = 128 + idx * 15;
            const shown = idx < revealedScores;
            return (
              <g key={item.label}>
                <text
                  x="581"
                  y={sy + 4}
                  className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
                >
                  {item.label}
                </text>
                <rect
                  x="628"
                  y={sy - 3}
                  width="38"
                  height="7"
                  rx="3.5"
                  className="fill-gray-100 dark:fill-gray-800"
                />
                {shown && (
                  <rect
                    x="628"
                    y={sy - 3}
                    width={item.width}
                    height="7"
                    rx="3.5"
                    className={
                      isS3
                        ? "fill-emerald-500 dark:fill-emerald-400"
                        : "fill-gray-400 dark:fill-gray-500"
                    }
                  />
                )}
                <text
                  x="704"
                  y={sy + 4}
                  textAnchor="end"
                  className="fill-gray-800 font-mono text-xs font-medium tabular-nums dark:fill-gray-200"
                >
                  {shown ? item.score.toFixed(1) : "--"}
                </text>
              </g>
            );
          })}

          {/* Final Aggregated Mean Badge at Bottom of Scoreboard Column */}
          <rect
            x="585"
            y="206"
            width="116"
            height="34"
            rx="6"
            className={
              showFinalMean
                ? "fill-emerald-600 dark:fill-emerald-500"
                : "fill-gray-100 dark:fill-gray-800"
            }
          />
          <text
            x="643"
            y="220"
            textAnchor="middle"
            className={
              showFinalMean
                ? "fill-emerald-100 font-mono text-xs font-medium dark:fill-gray-900"
                : "fill-gray-400 font-mono text-xs dark:fill-gray-500"
            }
          >
            {copy.finalScore}
          </text>
          <text
            x="643"
            y="234"
            textAnchor="middle"
            className={
              showFinalMean
                ? "fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
                : "fill-gray-400 font-mono text-xs tabular-nums dark:fill-gray-500"
            }
          >
            {showFinalMean ? "68.95 ± 0.74" : "--"}
          </text>
        </g>
      </svg>
    </div>
  );
}
