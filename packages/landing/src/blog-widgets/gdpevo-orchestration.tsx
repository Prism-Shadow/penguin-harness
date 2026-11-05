/**
 * Progressive, grid-aligned orchestration diagram for Section 4 of the GDPEVO blog post.
 *
 * Geometry is locked to a strict 4-column horizontal pipeline (all centered on CY = 170,
 * outer columns spanning y = 92..248, h = 156):
 *   Col 1 (x = 8..242):   `1 Shared Docker` — Base Agent + 3+2 closed-circuit training loop
 *   Col 2 (x = 262..356): `Evolved Agent (+ SKILL.md)` — frozen skill handoff
 *   Col 3 (x = 390..542): `Isolated Dockers` — 5 stacked Test 1..5 containers (x3 runs)
 *   Col 4 (x = 576..712): `Offline Verifier` — dedicated full-height Scoreboard column showing
 *                         per-task verified score bars and the final 68.95 ± 0.74 summary.
 *
 * Above Col 1 and Col 3 (on TY = 26), `General Agent` sits at the exact midpoint (x = 295)
 * and dispatches symmetrically through two `Harbor` nodes.
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
  { id: "train", labelZh: "1. 多轮训练循环", labelEn: "1. Multi-Round Train", startTick: 0, endTick: 11 },
  { id: "freeze", labelZh: "2. 产出进化 Agent", labelEn: "2. Evolved Agent", startTick: 12, endTick: 13 },
  { id: "test", labelZh: "3. 多轮隔离测试", labelEn: "3. Isolated Testing", startTick: 14, endTick: 17 },
  { id: "result", labelZh: "4. 离线判分出分", labelEn: "4. Scoreboard", startTick: 18, endTick: 21 },
];

/**
 * 3+2 training task cards inside `1 Shared Docker` (x=8..244, y=92..248):
 * Placed on the LEFT side (x=18..126) so tasks feed into `Target Agent` on the RIGHT (x=148..234, w=86),
 * which then exports directly out the right wall of `1 Shared Docker` into `Evolved Agent (+ SKILL.md)`.
 */
const TRAIN_CARDS = [
  { label: "T1", x: 22, y: 142, w: 30, h: 32 },
  { label: "T2", x: 56, y: 142, w: 30, h: 32 },
  { label: "T3", x: 90, y: 142, w: 30, h: 32 },
  { label: "T4", x: 39, y: 182, w: 30, h: 32 },
  { label: "T5", x: 73, y: 182, w: 30, h: 32 },
] as const;

/** Vertical center Y coordinates for the 5 stacked horizontal Isolated Dockers (centered on CY=170). */
const TEST_ROWS_Y = [106, 138, 170, 202, 234] as const;

/** Per-task verified scores displayed inside the rightmost Offline Verifier Scoreboard column. */
const VERIFIER_SCORES = [
  { label: "E1", score: 74.3, width: 44 },
  { label: "E2", score: 65.8, width: 39 },
  { label: "E3", score: 80.7, width: 48 },
  { label: "E4", score: 63.9, width: 38 },
  { label: "E5", score: 73.7, width: 44 },
] as const;

function tickDelayMs(tick: number): number {
  if (tick === 5 || tick === 11) return 1100;
  if (tick < 12) return 560;
  if (tick === 13) return 1100;
  if (tick >= 14 && tick <= 17) return 800;
  if (tick === 21) return 3600;
  return 850;
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
  const trainRound = tick < 6 ? 1 : 2;
  const activeTaskIdx = tick < 5 ? tick : tick >= 6 && tick < 11 ? tick - 6 : -1;
  const isSkillUpdating = tick === 5 || tick === 11;
  const skillBadge = tick < 5 ? "No Skill" : tick < 11 ? "Skill v1" : "Skill v2";

  const showStage2 = tick >= 12;
  const showStage3 = tick >= 14;
  const completedTestRuns = tick < 15 ? 0 : tick === 15 ? 1 : tick === 16 ? 2 : 3;
  const showStage4 = tick >= 18;
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
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Experiment stages">
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

      {/* Strictly Left-to-Right 4-Column Grid SVG */}
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

        {/* ==================== TOP ORCHESTRATOR: GENERAL AGENT (Centered at x=295, y=26) ==================== */}
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
          {/* Left Symmetric Arm: General Agent (222, 26) -> (125, 26) -> Harbor -> 1 Shared Docker (125, 90) */}
          <path
            d="M222,26 L125,26 L125,90"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="round"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#pg-arrow-brand)"
          />
          <rect
            x="96"
            y="44"
            width="58"
            height="20"
            rx="5"
            strokeWidth="1.25"
            className="fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
          />
          <text
            x="125"
            y="58"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            Harbor
          </text>

          {/* 1 Shared Docker Boundary (x=8..242, y=92..248, h=156, center CY=170) */}
          <rect
            x="8"
            y="92"
            width="234"
            height="156"
            rx="10"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            className={
              tick < 12
                ? "fill-brand-50/25 stroke-brand-500 dark:fill-brand-950/20 dark:stroke-brand-400"
                : "fill-gray-50/50 stroke-gray-300 dark:fill-gray-900/40 dark:stroke-gray-700"
            }
          />
          <text
            x="20"
            y="113"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
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
              tick < 12
                ? "fill-brand-100 dark:fill-brand-900/70"
                : "fill-emerald-100 dark:fill-emerald-900/60"
            }
          />
          <text
            x="197"
            y="113"
            textAnchor="middle"
            className={
              tick < 12
                ? "fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
                : "fill-emerald-800 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-200"
            }
          >
            {tick < 12 ? `Round ${trainRound}/2` : "2/2 Done"}
          </text>

          {/* Clean Bidirectional Loop between 3+2 Task Pool on LEFT (x=16..126) and Target Agent on RIGHT (x=148..234):
              Top Arrow (y=166): Task Pool -> Target Agent
              Bottom Arrow (y=192): Target Agent -> Task Pool */}
          <rect
            x="16"
            y="134"
            width="110"
            height="88"
            rx="8"
            strokeWidth="1"
            className="fill-gray-50/80 stroke-gray-200 dark:fill-gray-800/40 dark:stroke-gray-700"
          />
          <path
            d="M126,166 L146,166"
            fill="none"
            strokeWidth={isSkillUpdating ? "2" : "1.5"}
            className={
              isSkillUpdating
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : activeTaskIdx >= 0
                  ? "stroke-brand-500 dark:stroke-brand-400"
                  : "stroke-gray-400 dark:stroke-gray-500"
            }
            markerEnd={
              isSkillUpdating
                ? "url(#pg-arrow-emerald)"
                : activeTaskIdx >= 0
                  ? "url(#pg-arrow-brand)"
                  : "url(#pg-arrow-gray)"
            }
          />
          <path
            d="M148,192 L128,192"
            fill="none"
            strokeWidth="1.5"
            className={
              activeTaskIdx >= 0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-400 dark:stroke-gray-500"
            }
            markerEnd={activeTaskIdx >= 0 ? "url(#pg-arrow-brand)" : "url(#pg-arrow-gray)"}
          />

          {/* 3+2 Training Task Cards on LEFT (T1..T5 in natural left-to-right reading order) */}
          {TRAIN_CARDS.map((card, i) => {
            const isCurrentTask = i === activeTaskIdx;
            const doneRound2 = tick > 6 + i;
            const doneRound1 = tick > i && tick < 6;
            const cardStyle = isCurrentTask
              ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
              : doneRound2
                ? "fill-emerald-50 stroke-emerald-500 dark:fill-emerald-950/60 dark:stroke-emerald-400"
                : doneRound1
                  ? "fill-brand-50 stroke-brand-400 dark:fill-brand-950/60 dark:stroke-brand-500"
                  : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700";
            const textStyle = isCurrentTask
              ? "fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
              : doneRound2
                ? "fill-emerald-800 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-200"
                : doneRound1
                  ? "fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
                  : "fill-gray-700 font-mono text-xs font-medium tabular-nums dark:fill-gray-300";
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
                <text x={card.x + card.w / 2} y={card.y + 20} textAnchor="middle" className={textStyle}>
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
              tick < 5
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
              tick < 5
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
        {showStage2 && (
          <g className="anim-block">
            <path
              d="M242,170 L260,170"
              fill="none"
              strokeWidth="1.75"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
            <rect
              x="262"
              y="134"
              width="94"
              height="72"
              rx="8"
              strokeWidth="1.5"
              className="fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
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
              className="fill-emerald-700 font-mono text-xs font-semibold dark:fill-emerald-300"
            >
              + SKILL.md
            </text>
          </g>
        )}

        {/* ==================== COL 3: HARBOR -> ISOLATED DOCKERS (x=390..542, CY=170) ==================== */}
        {showStage3 && (
          <g className="anim-block">
            {/* Right Symmetric Arm: General Agent (368, 26) -> (466, 26) -> Harbor -> Isolated Dockers (466, 74) */}
            <path
              d="M368,26 L466,26 L466,74"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#pg-arrow-brand)"
            />
            <rect
              x="437"
              y="44"
              width="58"
              height="20"
              rx="5"
              strokeWidth="1.25"
              className="fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
            />
            <text
              x="466"
              y="58"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
            >
              Harbor
            </text>

            <text
              x="466"
              y="88"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
            >
              Isolated Test Dockers
            </text>

            {/* 1-to-5 Orthogonal Fork Tree (x=356..390, y=106..234, center CY=170) */}
            <path
              d="M356,170 L373,170 M373,106 L373,234"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="stroke-brand-500 dark:stroke-brand-400"
            />
            {TEST_ROWS_Y.map((ry, idx) => (
              <path
                key={`fork-${idx}`}
                d={`M373,${ry} L388,${ry}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-brand-500 dark:stroke-brand-400"
                markerEnd="url(#pg-arrow-brand)"
              />
            ))}

            {/* 5 Vertically Stacked Horizontal Isolated Dockers (x=390..542, h=26, y=93..247) */}
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
                    strokeWidth="1.25"
                    className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                  />
                  <text
                    x="402"
                    y={ry + 4}
                    className="fill-gray-800 font-mono text-xs font-semibold tabular-nums dark:fill-gray-200"
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
                            ? "fill-brand-500 dark:fill-brand-400"
                            : "fill-gray-100 dark:fill-gray-800"
                        }
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        )}

        {/* ==================== COL 4: OFFLINE VERIFIER SCOREBOARD COLUMN (x=576..712, y=92..248, CY=170) ==================== */}
        {showStage4 && (
          <g className="anim-block">
            {/* Symmetric 5-to-1 Collector Tree (x=542..576, y=106..234 -> CY=170) */}
            {TEST_ROWS_Y.map((ry, idx) => (
              <path
                key={`join-${idx}`}
                d={`M542,${ry} L559,${ry}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-emerald-600 dark:stroke-emerald-400"
              />
            ))}
            <path
              d="M559,106 L559,234 M559,170 L574,170"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />

            {/* Full-Height Scoreboard Column (x=576..712, y=92..248, h=156 — matches Col 1 height) */}
            <rect
              x="576"
              y="92"
              width="136"
              height="156"
              rx="10"
              strokeWidth="1.5"
              className="fill-white stroke-emerald-600 dark:fill-gray-900 dark:stroke-emerald-400"
            />
            <text
              x="644"
              y="112"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
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
                    x="588"
                    y={sy + 4}
                    className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
                  >
                    {`T${idx + 1}`}
                  </text>
                  <rect
                    x="610"
                    y={sy - 3}
                    width="54"
                    height="7"
                    rx="3.5"
                    className="fill-gray-100 dark:fill-gray-800"
                  />
                  {shown && (
                    <rect
                      x="610"
                      y={sy - 3}
                      width={item.width}
                      height="7"
                      rx="3.5"
                      className="fill-emerald-500 dark:fill-emerald-400"
                    />
                  )}
                  <text
                    x="700"
                    y={sy + 4}
                    textAnchor="end"
                    className="fill-gray-800 font-mono text-xs font-medium tabular-nums dark:fill-gray-200"
                  >
                    {shown ? item.score.toFixed(1) : "--"}
                  </text>
                </g>
              );
            })}

            {/* Final Aggregated Mean Badge at Bottom of Scoreboard Column (x=586..702, y=206..240) */}
            <rect
              x="586"
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
              x="644"
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
              x="644"
              y="234"
              textAnchor="middle"
              className={
                showFinalMean
                  ? "fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
                  : "fill-gray-400 font-mono text-xs tabular-nums dark:fill-gray-500"
              }
            >
              {showFinalMean ? "68.95 ± 0.74" : "..."}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
