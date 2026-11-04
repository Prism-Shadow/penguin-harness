/**
 * Progressive, grid-aligned orchestration diagram for Section 4 of the GDPEVO blog post.
 *
 * Geometry is locked to two horizontal axes:
 * - Top Orchestration Axis (y = 28): `General Agent` sits at the exact midpoint (x = 313) between
 *   `1 Shared Docker` (x = 133) and `Isolated Dockers` (x = 492), dispatching symmetrically
 *   through two vertical `Harbor` nodes. `Final Result` sits at x = 658 directly above `Offline Verifier`.
 * - Main Execution Axis (CY = 172): `Base Agent`, `T1..T5` (3+2 closed loop), `Evolved Agent`,
 *   the 5 stacked `Test 1..5` containers, and `Offline Verifier` all center on y = 172.
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
  { id: "test", labelZh: "3. 隔离容器盲测", labelEn: "3. Isolated Dockers", startTick: 14, endTick: 17 },
  { id: "result", labelZh: "4. 判分汇总结果", labelEn: "4. Final Result", startTick: 18, endTick: 21 },
];

/**
 * 3+2 training task cards inside `1 Shared Docker` (x=12..254, y=92..248, CY=172):
 * Top row (T1, T2, T3) centers on y = 149; Bottom row (T4, T5) centers on y = 195.
 * Clockwise loop runs: Base Agent (102,149) -> T1 -> T2 -> T3 -> (225,195) -> T5 -> T4 -> Base Agent (102,195).
 * Note: T4 is at left (136..170) and T5 is at right (178..212), so the clockwise flow visits
 * T1 -> T2 -> T3 on top, then steps down into the bottom row and returns straight into Base Agent.
 */
const TRAIN_CARDS = [
  { label: "T1", x: 124, y: 132, w: 34, h: 34 },
  { label: "T2", x: 166, y: 132, w: 34, h: 34 },
  { label: "T3", x: 208, y: 132, w: 34, h: 34 },
  { label: "T4", x: 136, y: 178, w: 34, h: 34 },
  { label: "T5", x: 178, y: 178, w: 34, h: 34 },
] as const;

/** Vertical center Y coordinates for the 5 stacked horizontal Isolated Dockers (centered on CY=172). */
const TEST_ROWS_Y = [108, 140, 172, 204, 236] as const;

function tickDelayMs(tick: number): number {
  if (tick === 5 || tick === 11) return 850;
  if (tick < 12) return 440;
  if (tick === 13) return 850;
  if (tick >= 14 && tick <= 17) return 620;
  if (tick === 21) return 2800;
  return 680;
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
  const showVerifier = tick >= 18;
  const showFinalResult = tick >= 20;

  const copy = isZh
    ? {
        play: "播放实验动态演进",
        pause: "暂停实验动态演进",
      }
    : {
        play: "Play experiment flow",
        pause: "Pause experiment flow",
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

      {/* Compact, Strictly Grid-Aligned Open-Canvas SVG */}
      <svg
        viewBox="0 0 720 258"
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

        {/* ==================== TOP ORCHESTRATOR: GENERAL AGENT (Centered at x=313, y=26) ==================== */}
        <g>
          <rect
            x="240"
            y="6"
            width="146"
            height="40"
            rx="8"
            strokeWidth="1.5"
            className="fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
          />
          <text
            x="313"
            y="31"
            textAnchor="middle"
            className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
          >
            General Agent
          </text>
        </g>

        {/* ==================== PHASE 1: HARBOR -> 1 SHARED DOCKER (CENTER X1=133, CY=172) ==================== */}
        <g>
          {/* Left Symmetric Arm: General Agent (240, 26) -> (133, 26) -> Harbor -> 1 Shared Docker (133, 90) */}
          <path
            d="M240,26 L133,26 L133,90"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="round"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#pg-arrow-brand)"
          />
          <rect
            x="104"
            y="44"
            width="58"
            height="20"
            rx="5"
            strokeWidth="1.25"
            className="fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
          />
          <text
            x="133"
            y="58"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            Harbor
          </text>

          {/* 1 Shared Docker Boundary (x=12..254, y=92..232, h=140) */}
          <rect
            x="12"
            y="92"
            width="242"
            height="140"
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
            x="24"
            y="113"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            1 Shared Docker
          </text>
          {/* Live Round Pill in top-right of 1 Shared Docker */}
          <rect
            x="174"
            y="100"
            width="68"
            height="18"
            rx="4"
            className={
              tick < 12
                ? "fill-brand-100 dark:fill-brand-900/70"
                : "fill-emerald-100 dark:fill-emerald-900/60"
            }
          />
          <text
            x="208"
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

          {/* Clean Clockwise Stadium Training Loop (All Solid Lines, Rounded Corners):
              Top Rail (y=149): Base Agent (102,149) -> T1 -> T2 -> T3
              Right Link (x=225): T3 bottom (225,166) -> (225,195) -> T5 right (212,195)
              Bottom Return Rail (y=195): T5 -> T4 -> Base Agent (104,195) */}
          <path
            d="M102,149 L124,149 M158,149 L166,149 M200,149 L208,149 M225,166 L225,195 L212,195 M178,195 L170,195"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="round"
            className={
              activeTaskIdx >= 0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
          />
          {/* Straight 32px Horizontal Return Arrow from T4 (136,195) -> Base Agent (104,195) */}
          <path
            d="M136,195 L104,195"
            fill="none"
            strokeWidth={isSkillUpdating ? "2" : "1.5"}
            className={
              isSkillUpdating
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : activeTaskIdx >= 0
                  ? "stroke-brand-500 dark:stroke-brand-400"
                  : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={
              isSkillUpdating
                ? "url(#pg-arrow-emerald)"
                : activeTaskIdx >= 0
                  ? "url(#pg-arrow-brand)"
                  : "url(#pg-arrow-gray)"
            }
          />
          {running && tick < 12 && (
            <circle
              r="3"
              className={
                isSkillUpdating
                  ? "fill-emerald-500 dark:fill-emerald-400"
                  : "fill-brand-600 dark:fill-brand-300"
              }
            >
              <animateMotion
                dur="1.4s"
                repeatCount="indefinite"
                path="M102,149 L225,149 L225,195 L104,195"
              />
            </circle>
          )}

          {/* Base Agent Node inside 1 Shared Docker (x=24..102, y=136..208, h=72, center CY=172) */}
          <rect
            x="24"
            y="136"
            width="78"
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
            x="63"
            y="162"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            Base Agent
          </text>
          <rect
            x="31"
            y="174"
            width="64"
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
            x="63"
            y="189"
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

          {/* 3+2 Training Task Cards (T1..T5) */}
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
                <text x={card.x + card.w / 2} y={card.y + 21} textAnchor="middle" className={textStyle}>
                  {card.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* ==================== PHASE 2: EVOLVED AGENT (+ SKILL.MD) (CENTER X2=325, CY=172) ==================== */}
        {showStage2 && (
          <g className="anim-block">
            <path
              d="M254,172 L274,172"
              fill="none"
              strokeWidth="1.75"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
            <rect
              x="276"
              y="136"
              width="98"
              height="72"
              rx="8"
              strokeWidth="1.5"
              className="fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
            />
            <text
              x="325"
              y="166"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Evolved Agent
            </text>
            <text
              x="325"
              y="188"
              textAnchor="middle"
              className="fill-emerald-700 font-mono text-xs font-semibold dark:fill-emerald-300"
            >
              + SKILL.md
            </text>
          </g>
        )}

        {/* ==================== PHASE 3: HARBOR -> ISOLATED DOCKERS (CENTER X3=492, CY=172) ==================== */}
        {showStage3 && (
          <g className="anim-block">
            {/* Right Symmetric Arm: General Agent (386, 26) -> (492, 26) -> Harbor -> Isolated Dockers (492, 76) */}
            <path
              d="M386,26 L492,26 L492,76"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#pg-arrow-brand)"
            />
            <rect
              x="463"
              y="44"
              width="58"
              height="20"
              rx="5"
              strokeWidth="1.25"
              className="fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
            />
            <text
              x="492"
              y="58"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
            >
              Harbor
            </text>

            <text
              x="492"
              y="90"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
            >
              Isolated Dockers
            </text>

            {/* 1-to-5 Orthogonal Fork Tree (x=374..410, y=108..236, center CY=172) */}
            <path
              d="M374,172 L392,172 M392,108 L392,236"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="stroke-brand-500 dark:stroke-brand-400"
            />
            {TEST_ROWS_Y.map((ry, idx) => (
              <path
                key={`fork-${idx}`}
                d={`M392,${ry} L408,${ry}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-brand-500 dark:stroke-brand-400"
                markerEnd="url(#pg-arrow-brand)"
              />
            ))}

            {/* 5 Vertically Stacked Horizontal Isolated Dockers (x=410..574, h=26, spanning y=95..249) */}
            {TEST_ROWS_Y.map((ry, idx) => {
              const topY = ry - 13;
              return (
                <g key={`test-row-${idx}`}>
                  <rect
                    x="410"
                    y={topY}
                    width="164"
                    height="26"
                    rx="6"
                    strokeWidth="1.25"
                    className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                  />
                  <text
                    x="424"
                    y={ry + 4}
                    className="fill-gray-800 font-mono text-xs font-semibold tabular-nums dark:fill-gray-200"
                  >
                    {`Test ${idx + 1}`}
                  </text>
                  <line
                    x1="478"
                    y1={topY + 5}
                    x2="478"
                    y2={topY + 21}
                    strokeWidth="1"
                    className="stroke-gray-200 dark:stroke-gray-700"
                  />
                  <text
                    x="490"
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
                        x={516 + (rNum - 1) * 16}
                        y={ry - 6}
                        width="12"
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

        {/* ==================== PHASE 4: OFFLINE VERIFIER -> FINAL RESULT (CENTER X4=658) ==================== */}
        {showVerifier && (
          <g className="anim-block">
            {/* 5-to-1 Collector Tree (x=574..610, y=108..236 -> CY=172) */}
            {TEST_ROWS_Y.map((ry, idx) => (
              <path
                key={`join-${idx}`}
                d={`M574,${ry} L592,${ry}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-emerald-600 dark:stroke-emerald-400"
              />
            ))}
            <path
              d="M592,108 L592,236 M592,172 L608,172"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />

            {/* Offline Verifier Node (x=610..706, y=136..208, h=72, center X4=658, CY=172) */}
            <rect
              x="610"
              y="136"
              width="96"
              height="72"
              rx="8"
              strokeWidth="1.5"
              className="fill-white stroke-emerald-600 dark:fill-gray-900 dark:stroke-emerald-400"
            />
            <text
              x="658"
              y="166"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Offline
            </text>
            <text
              x="658"
              y="186"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Verifier
            </text>
          </g>
        )}

        {showFinalResult && (
          <g className="anim-block">
            {/* Straight Vertical Arrow from Offline Verifier (658, 136) -> Final Result (658, 48) */}
            <path
              d="M658,136 L658,48"
              fill="none"
              strokeWidth="1.75"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
            {/* Final Result Node at Top Right (x=598..718, y=6..46, h=40, center X4=658, TY=26) */}
            <rect
              x="598"
              y="6"
              width="120"
              height="40"
              rx="8"
              strokeWidth="1.5"
              className="fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
            />
            <text
              x="658"
              y="23"
              textAnchor="middle"
              className="fill-emerald-900 text-xs font-semibold dark:fill-emerald-100"
            >
              Final Result
            </text>
            <text
              x="658"
              y="39"
              textAnchor="middle"
              className="fill-emerald-700 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-300"
            >
              68.95 ± 0.74
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
