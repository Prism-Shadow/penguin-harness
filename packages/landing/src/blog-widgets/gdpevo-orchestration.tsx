/**
 * Progressive, open-canvas orchestration diagram for Section 4 of the GDPEVO blog post.
 *
 * Driven by a fine-grained tick clock (22 ticks per cycle):
 * - Phase 1 (Ticks 0..11, "1. Train"): General Agent dispatches via Harbor into `1 Shared Docker`.
 *   Inside `1 Shared Docker`, Base Agent actively cycles through all 5 training tasks (`T1..T5` in
 *   a 3+2 closed circuit) over 2 full rounds:
 *     Round 1 (Ticks 0..4): Base Agent (No Skill) steps through T1 -> T2 -> T3 -> T4 -> T5;
 *       at Tick 5 the return bus feeds back into Base Agent to distill `Skill v1`.
 *     Round 2 (Ticks 6..10): Base Agent (Skill v1) sweeps T1 -> T2 -> T3 -> T4 -> T5 again;
 *       at Tick 11 the return bus feeds back into Base Agent to refine `Skill v2`.
 * - Phase 2 (Ticks 12..13, "2. Freeze"): Exports the evolved skill out of `1 Shared Docker` to
 *   materialize `Evolved Agent (+ SKILL.md)`.
 * - Phase 3 (Ticks 14..17, "3. Test"): General Agent dispatches via Harbor and `Evolved Agent`
 *   fans out 1-to-5 into 5 stacked horizontal `Isolated Dockers` (`Test 1..5`), lighting up the
 *   3 independent evaluation runs (`R1 -> R2 -> R3`) column by column.
 * - Phase 4 (Ticks 18..21, "4. Result"): 5-to-1 convergence into `Offline Verifier`, which reports
 *   back to `General Agent` to emit `Final Result (68.95 ± 0.74)`.
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

/** 3+2 coordinates for the 5 training task cards inside `1 Shared Docker` (x=10..252, y=102..288). */
const TRAIN_CARDS = [
  { label: "T1", x: 122, y: 146, w: 36, h: 34 },
  { label: "T2", x: 164, y: 146, w: 36, h: 34 },
  { label: "T3", x: 206, y: 146, w: 36, h: 34 },
  { label: "T4", x: 142, y: 200, w: 36, h: 34 },
  { label: "T5", x: 186, y: 200, w: 36, h: 34 },
] as const;

/** Vertical center Y coordinates for the 5 stacked horizontal Isolated Dockers. */
const TEST_ROWS_Y = [122, 160, 198, 236, 274] as const;

function tickDelayMs(tick: number): number {
  if (tick === 5 || tick === 11) return 900;
  if (tick < 12) return 450;
  if (tick === 13) return 900;
  if (tick >= 14 && tick <= 17) return 650;
  if (tick === 21) return 2800;
  return 700;
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
  const skillBadge =
    tick < 5 ? "No Skill" : tick < 11 ? "Skill v1" : "Skill v2";

  const showStage2 = tick >= 12;
  const showStage3 = tick >= 14;
  const completedTestRuns = tick < 15 ? 0 : tick === 15 ? 1 : tick === 16 ? 2 : 3;
  const showVerifier = tick >= 18;
  const showReturnToMain = tick >= 19;
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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

      {/* Open-Canvas Progressive SVG */}
      <svg
        viewBox="0 0 720 300"
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

        {/* ==================== TOP ORCHESTRATOR: GENERAL AGENT ==================== */}
        <g>
          <rect
            x="268"
            y="6"
            width="148"
            height="42"
            rx="9"
            strokeWidth="1.5"
            className="fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
          />
          <text
            x="342"
            y="32"
            textAnchor="middle"
            className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
          >
            General Agent
          </text>
        </g>

        {/* ==================== PHASE 1: HARBOR -> 1 SHARED DOCKER (MULTI-ROUND TRAIN) ==================== */}
        <g>
          {/* Dispatch line from General Agent (x=302, y=48) -> Harbor -> 1 Shared Docker (x=130, y=98) */}
          <path
            d="M302,48 L302,76 L130,76 L130,98"
            fill="none"
            strokeWidth="1.5"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#pg-arrow-brand)"
          />
          {/* Harbor badge on the left dispatch spine */}
          <rect
            x="184"
            y="66"
            width="58"
            height="20"
            rx="5"
            strokeWidth="1"
            className="fill-brand-50 stroke-brand-300 dark:fill-brand-950 dark:stroke-brand-700"
          />
          <text
            x="213"
            y="80"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            Harbor
          </text>

          {/* 1 Shared Docker Boundary (x=10..252, y=102..288) */}
          <rect
            x="10"
            y="102"
            width="242"
            height="186"
            rx="12"
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
            y="124"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            1 Shared Docker
          </text>
          {/* Live Round Pill in top-right of 1 Shared Docker */}
          <rect
            x="172"
            y="111"
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
            x="206"
            y="124"
            textAnchor="middle"
            className={
              tick < 12
                ? "fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
                : "fill-emerald-800 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-200"
            }
          >
            {tick < 12 ? `Round ${trainRound}/2` : "2/2 Done"}
          </text>

          {/* Unobstructed Closed Training Circuit:
              1) Entry: Base Agent (98, 163) -> T1 (122, 163) -> T2 (164, 163) -> T3 (206, 163)
              2) Row Step: T3 bottom (224, 180) -> gap y=190 -> T4 left (130, 190 -> 130, 217 -> 142, 217) -> T5 (186, 217)
              3) Feedback Return: T5 bottom (204, 234) -> bottom bus y=254 -> Base Agent bottom (60, 254 -> 60, 230) */}
          <path
            d="M98,163 L122,163 M158,163 L164,163 M200,163 L206,163 M224,180 L224,190 L130,190 L130,217 L142,217 M178,217 L186,217"
            fill="none"
            strokeWidth="1.5"
            className={
              activeTaskIdx >= 0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
          />
          <path
            d="M204,234 L204,254 L60,254 L60,230"
            fill="none"
            strokeWidth={isSkillUpdating ? "2" : "1.5"}
            strokeDasharray={isSkillUpdating ? undefined : "4 3"}
            className={
              isSkillUpdating
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isSkillUpdating ? "url(#pg-arrow-emerald)" : "url(#pg-arrow-gray)"}
          />
          {running && isSkillUpdating && (
            <circle r="3.25" className="fill-emerald-500 dark:fill-emerald-400">
              <animateMotion
                dur="0.75s"
                repeatCount="indefinite"
                path="M204,234 L204,254 L60,254 L60,230"
              />
            </circle>
          )}

          {/* Base Agent Node inside 1 Shared Docker (x=22..98, y=148..228) */}
          <rect
            x="22"
            y="148"
            width="76"
            height="80"
            rx="8"
            strokeWidth="1.5"
            className={
              isSkillUpdating
                ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950 dark:stroke-emerald-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="60"
            y="175"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            Base Agent
          </text>
          {/* Dynamic Skill Badge inside Base Agent */}
          <rect
            x="28"
            y="188"
            width="64"
            height="24"
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
            x="60"
            y="204"
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

        {/* ==================== PHASE 2: EVOLVED AGENT (+ SKILL.MD) ==================== */}
        {showStage2 && (
          <g className="anim-block">
            <path
              d="M252,198 L276,198"
              fill="none"
              strokeWidth="1.75"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
            <rect
              x="278"
              y="160"
              width="106"
              height="76"
              rx="10"
              strokeWidth="1.5"
              className="fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
            />
            <text
              x="331"
              y="192"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Evolved Agent
            </text>
            <text
              x="331"
              y="214"
              textAnchor="middle"
              className="fill-emerald-700 font-mono text-xs font-semibold dark:fill-emerald-300"
            >
              + SKILL.md
            </text>
          </g>
        )}

        {/* ==================== PHASE 3: HARBOR -> 5 ISOLATED DOCKERS (TEST 1..5 x 3) ==================== */}
        {showStage3 && (
          <g className="anim-block">
            {/* Dispatch line from General Agent (x=342, y=48) -> Harbor -> Isolated Dockers (x=504, y=90) */}
            <path
              d="M342,48 L342,76 L504,76 L504,90"
              fill="none"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#pg-arrow-brand)"
            />
            {/* Harbor badge on the right dispatch spine */}
            <rect
              x="398"
              y="66"
              width="58"
              height="20"
              rx="5"
              strokeWidth="1"
              className="fill-brand-50 stroke-brand-300 dark:fill-brand-950 dark:stroke-brand-700"
            />
            <text
              x="427"
              y="80"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
            >
              Harbor
            </text>

            <text
              x="504"
              y="102"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
            >
              Isolated Dockers
            </text>

            {/* 1-to-5 Orthogonal Fork Tree (x=384..424, y=122..274) */}
            <path
              d="M384,198 L404,198 M404,122 L404,274"
              fill="none"
              strokeWidth="1.5"
              className="stroke-brand-500 dark:stroke-brand-400"
            />
            {TEST_ROWS_Y.map((ry, idx) => (
              <path
                key={`fork-${idx}`}
                d={`M404,${ry} L422,${ry}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-brand-500 dark:stroke-brand-400"
                markerEnd="url(#pg-arrow-brand)"
              />
            ))}

            {/* 5 Vertically Stacked Horizontal Isolated Dockers (x=424..584, h=28) */}
            {TEST_ROWS_Y.map((ry, idx) => {
              const topY = ry - 14;
              return (
                <g key={`test-row-${idx}`}>
                  <rect
                    x="424"
                    y={topY}
                    width="160"
                    height="28"
                    rx="6"
                    strokeWidth="1.25"
                    className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                  />
                  <text
                    x="436"
                    y={ry + 4}
                    className="fill-gray-800 font-mono text-xs font-semibold tabular-nums dark:fill-gray-200"
                  >
                    {`Test ${idx + 1}`}
                  </text>
                  <line
                    x1="488"
                    y1={topY + 5}
                    x2="488"
                    y2={topY + 23}
                    strokeWidth="1"
                    className="stroke-gray-200 dark:stroke-gray-700"
                  />
                  <text
                    x="500"
                    y={ry + 4}
                    className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
                  >
                    ×3
                  </text>
                  {/* 3 Independent Run Cells (light up column by column as runs 1, 2, 3 complete) */}
                  {[1, 2, 3].map((rNum) => {
                    const done = completedTestRuns >= rNum;
                    return (
                      <rect
                        key={rNum}
                        x={526 + (rNum - 1) * 16}
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

        {/* ==================== PHASE 4: OFFLINE VERIFIER -> GENERAL AGENT -> FINAL RESULT ==================== */}
        {showVerifier && (
          <g className="anim-block">
            {/* 5-to-1 Collector Tree (x=584..622, y=122..274 -> y=198) */}
            {TEST_ROWS_Y.map((ry, idx) => (
              <path
                key={`join-${idx}`}
                d={`M584,${ry} L602,${ry}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-emerald-600 dark:stroke-emerald-400"
              />
            ))}
            <path
              d="M602,122 L602,274 M602,198 L620,198"
              fill="none"
              strokeWidth="1.5"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />

            {/* Offline Verifier Node (x=622..712, y=166..230) */}
            <rect
              x="622"
              y="166"
              width="90"
              height="64"
              rx="8"
              strokeWidth="1.5"
              className="fill-white stroke-emerald-600 dark:fill-gray-900 dark:stroke-emerald-400"
            />
            <text
              x="667"
              y="194"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Offline
            </text>
            <text
              x="667"
              y="212"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Verifier
            </text>
          </g>
        )}

        {showReturnToMain && (
          <g className="anim-block">
            {/* Zero-crossing Return Path: Offline Verifier (667,166) -> up to y=56 -> left to (388,56) -> General Agent (388,48) */}
            <path
              d="M667,166 L667,56 L388,56 L388,50"
              fill="none"
              strokeWidth="1.5"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
          </g>
        )}

        {showFinalResult && (
          <g className="anim-block">
            <path
              d="M416,27 L556,27"
              fill="none"
              strokeWidth="1.75"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
            {/* Final Result Node at Top Right (x=558..712, y=6..48) */}
            <rect
              x="558"
              y="6"
              width="154"
              height="42"
              rx="9"
              strokeWidth="1.5"
              className="fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
            />
            <text
              x="635"
              y="24"
              textAnchor="middle"
              className="fill-emerald-900 text-xs font-semibold dark:fill-emerald-100"
            >
              Final Result
            </text>
            <text
              x="635"
              y="40"
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
