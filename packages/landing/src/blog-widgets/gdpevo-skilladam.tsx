/**
 * Progressive 4-Stage Kinetic Diagram for Section 2 of the GDPEVO blog post (SkillAdam).
 *
 * Stage semantics now match Section 4's orchestration diagram 1-to-1:
 * The 4 top stage tabs correspond directly to the 4 sequential columns from left to right
 * (and the 4 bullet points in Section 2 of the article prose):
 *   Stage 1 (Col 1, x = 8..244):   `1. 题池试跑` / `1. Task Rollout`
 *                                  Inside `1 Shared Docker`: 3+2 `T1..T5` (left) <-> `Target Agent` (right, w=86)
 *   Stage 2 (Col 2, x = 268..400): `2. 问题追踪 (EIT)` / `2. EIT Ledger`
 *                                  Logs error patterns & failed-edit history into the persistent EIT ledger
 *   Stage 3 (Col 3, x = 424..556): `3. 方差预算` / `3. Adam Budget`
 *                                  Computes cross-task variance Vt and locks slots (Bt = 2/4 unlocked)
 *   Stage 4 (Col 4, x = 580..712): `4. 均分门控` / `4. Mean Gate`
 *                                  Verifies Cand (97.3) > Best (74.9) -> ACCEPT, updates SKILL.md v2,
 *                                  and loops back to Target Agent.
 *
 * High-contrast spotlight:
 * - Unreached columns stay ghosted (opacity 0.22, neutral gray);
 * - Completed columns rest in calm neutral slate (stroke-gray-300, muted fills);
 * - ONLY the active stage column lights up in full vibrant Brand Blue / Emerald with a 2px border
 *   and top accent bar, so the active step stands out immediately.
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

interface StageDef {
  readonly id: string;
  readonly tabZh: string;
  readonly tabEn: string;
}

const STAGES: readonly StageDef[] = [
  { id: "rollout", tabZh: "1. 题池试跑诊断", tabEn: "1. Task Rollout" },
  { id: "eit", tabZh: "2. 问题追踪 (EIT)", tabEn: "2. EIT Ledger" },
  { id: "budget", tabZh: "3. 方差自适应预算", tabEn: "3. Adam Budget" },
  { id: "gate", tabZh: "4. 均分门控与更新", tabEn: "4. Mean Gate" },
];

/**
 * 10 ticks per full cycle:
 *   Ticks 0..4 (Stage 0): Sweep T1 -> T2 -> T3 -> T4 -> T5 inside `1 Shared Docker` (500ms each = 2.5s)
 *   Tick 5     (Stage 1): Spotlight Col 2 (`EIT Ledger`) (2000ms)
 *   Tick 6     (Stage 2): Spotlight Col 3 (`Adam Budget`: Vt -> Bt = 2/4) (2000ms)
 *   Ticks 7..9 (Stage 3): Spotlight Col 4 (`Mean Gate & SKILL.md` + return loop to Target Agent) (2600ms)
 */
const TOTAL_TICKS = 10;

function tickDelayMs(tick: number): number {
  if (tick < 5) return 480;
  if (tick === 5 || tick === 6) return 2000;
  if (tick === 9) return 2200;
  return 900;
}

/**
 * 3+2 training task cards on the LEFT side of `1 Shared Docker` (x=8..244, y=24..192),
 * matching the exact left-tasks / right-agent layout of Section 4's diagram.
 */
const TRAIN_CARDS = [
  { label: "T1", x: 22, y: 74, w: 30, h: 32 },
  { label: "T2", x: 56, y: 74, w: 30, h: 32 },
  { label: "T3", x: 90, y: 74, w: 30, h: 32 },
  { label: "T4", x: 39, y: 114, w: 30, h: 32 },
  { label: "T5", x: 73, y: 114, w: 30, h: 32 },
] as const;

export function SkillAdamWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  // SSR / reduced-motion starts at completed tick 9; live view starts at tick 0 when scrolled into view.
  const [tick, setTick] = useState<number>(9);
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

  const stageIdx = tick < 5 ? 0 : tick === 5 ? 1 : tick === 6 ? 2 : 3;

  const selectStage = (idx: number) => {
    if (idx === 0) {
      setTick(0);
      setPaused(false);
    } else if (idx === 1) {
      setTick(5);
      setPaused(true);
    } else if (idx === 2) {
      setTick(6);
      setPaused(true);
    } else {
      setTick(9);
      setPaused(true);
    }
  };

  const activeTaskIdx = tick < 5 ? tick : -1;
  const isS0 = stageIdx === 0;
  const isS1 = stageIdx === 1;
  const isS2 = stageIdx === 2;
  const isS3 = stageIdx === 3;

  const reachedS1 = stageIdx >= 1;
  const reachedS2 = stageIdx >= 2;
  const reachedS3 = stageIdx >= 3;

  const copy = isZh
    ? {
        play: "播放演进流程",
        pause: "暂停演进流程",
        targetAgent: "目标 Agent",
        eitTitle: "EIT 问题账本",
        eitRow1: "失误诊断",
        eitRow2: "历史记录",
        eitRow3: "防重约束",
        budgetTitle: "Adam 预算控制",
        varLabel: "分差方差",
        slotLabel: "编辑预算",
        gateTitle: "均分门控",
        bestLabel: "当前最佳",
        candLabel: "候选均分",
        acceptBadge: "采纳 → 更新 SKILL.md",
      }
    : {
        play: "Play evolution flow",
        pause: "Pause evolution flow",
        targetAgent: "Target Agent",
        eitTitle: "EIT Ledger",
        eitRow1: "Diagnosis",
        eitRow2: "Edit History",
        eitRow3: "Anti-Repeat",
        budgetTitle: "Adam Budget",
        varLabel: "Variance",
        slotLabel: "Budget",
        gateTitle: "Mean Gate",
        bestLabel: "Best",
        candLabel: "Cand",
        acceptBadge: "ACCEPT → SKILL.md",
      };

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      {/* Minimal Frameless Control Strip (4 Sequential Pipeline Stages, Matching Diagram 2) */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="SkillAdam stages">
          {STAGES.map((s, idx) => {
            const isCurrent = idx === stageIdx;
            const isReached = idx <= stageIdx;
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
                {isZh ? s.tabZh : s.tabEn}
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

      {/* 4-Column Progressive Spotlight SVG (viewBox 0 0 720 220) */}
      <svg
        viewBox="0 0 720 220"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label="SkillAdam four-stage in-container evolution pipeline"
      >
        <defs>
          <marker
            id="sa-arrow-brand"
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
            id="sa-arrow-gray"
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
            id="sa-arrow-emerald"
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

        {/* ==================== STAGE 1: 1 SHARED DOCKER (x=8..244, y=20..184, CY=102) ==================== */}
        <g>
          <rect
            x="8"
            y="20"
            width="236"
            height="164"
            rx="10"
            strokeWidth={isS0 ? "2" : "1.5"}
            strokeDasharray="6 4"
            className={
              isS0
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-gray-50/50 stroke-gray-300 dark:fill-gray-900/40 dark:stroke-gray-700"
            }
          />
          {/* Active Top Accent Pill on Stage 1 */}
          <rect
            x="64"
            y="19"
            width="124"
            height="3"
            rx="1.5"
            className={isS0 ? "fill-brand-600 dark:fill-brand-400" : "fill-transparent"}
          />
          <text
            x="20"
            y="42"
            className={
              isS0
                ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 font-mono text-xs font-semibold dark:fill-gray-400"
            }
          >
            1 Shared Docker
          </text>

          {/* 3+2 Task Pool on LEFT (x=16..126, y=66..154) */}
          <rect
            x="16"
            y="66"
            width="110"
            height="88"
            rx="8"
            strokeWidth="1"
            className="fill-white/80 stroke-gray-200 dark:fill-gray-800/40 dark:stroke-gray-700"
          />
          <path
            d="M126,98 L146,98"
            fill="none"
            strokeWidth="1.5"
            className={
              isS0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS0 ? "url(#sa-arrow-brand)" : "url(#sa-arrow-gray)"}
          />
          <path
            d="M148,124 L128,124"
            fill="none"
            strokeWidth="1.5"
            className={
              isS0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS0 ? "url(#sa-arrow-brand)" : "url(#sa-arrow-gray)"}
          />

          {/* 3+2 Training Task Cards (T1..T5 in natural left-to-right reading order) */}
          {TRAIN_CARDS.map((card, i) => {
            const isCurrentTask = isS0 && i === activeTaskIdx;
            const isDone = !isS0 || tick > i;
            const cardStyle = isCurrentTask
              ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
              : isS0 && isDone
                ? "fill-brand-50 stroke-brand-400 dark:fill-brand-950/60 dark:stroke-brand-500"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700";
            const textStyle = isCurrentTask
              ? "fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
              : isS0 && isDone
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
                <text x={card.x + card.w / 2} y={card.y + 20} textAnchor="middle" className={textStyle}>
                  {card.label}
                </text>
              </g>
            );
          })}

          {/* Target Agent on RIGHT inside 1 Shared Docker (x=148..234, w=86, y=74..146, h=72) */}
          <rect
            x="148"
            y="74"
            width="86"
            height="72"
            rx="8"
            strokeWidth="1.5"
            className={
              isS0
                ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="191"
            y="100"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {copy.targetAgent}
          </text>
          <rect
            x="157"
            y="112"
            width="68"
            height="22"
            rx="4"
            className={
              tick >= 8
                ? "fill-emerald-100 dark:fill-emerald-900"
                : isS0
                  ? "fill-brand-100 dark:fill-brand-900"
                  : "fill-gray-100 dark:fill-gray-800"
            }
          />
          <text
            x="191"
            y="127"
            textAnchor="middle"
            className={
              tick >= 8
                ? "fill-emerald-700 font-mono text-xs font-semibold dark:fill-emerald-300"
                : isS0
                  ? "fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
                  : "fill-gray-600 font-mono text-xs font-medium dark:fill-gray-400"
            }
          >
            {tick >= 8 ? "Skill v2" : "Skill v1"}
          </text>
        </g>

        {/* ==================== STAGE 2: EIT ISSUE LEDGER (x=268..400, y=20..184, CY=102) ==================== */}
        <g style={{ opacity: reachedS1 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M244,102 L266,102"
            fill="none"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "stroke-brand-600 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS1 ? "url(#sa-arrow-brand)" : "url(#sa-arrow-gray)"}
          />
          <rect
            x="268"
            y="20"
            width="132"
            height="164"
            rx="10"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <rect
            x="294"
            y="19"
            width="80"
            height="3"
            rx="1.5"
            className={isS1 ? "fill-brand-600 dark:fill-brand-400" : "fill-transparent"}
          />
          <text
            x="334"
            y="42"
            textAnchor="middle"
            className={
              isS1
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.eitTitle}
          </text>

          {/* 3 Clean Issue Ledger Entries inside Col 2 */}
          {[copy.eitRow1, copy.eitRow2, copy.eitRow3].map((rowLabel, ri) => {
            const ry = 60 + ri * 36;
            return (
              <g key={rowLabel}>
                <rect
                  x="280"
                  y={ry}
                  width="108"
                  height="28"
                  rx="6"
                  strokeWidth="1"
                  className={
                    isS1
                      ? "fill-white stroke-brand-300 dark:fill-gray-900 dark:stroke-brand-700"
                      : "fill-gray-50 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
                  }
                />
                <circle
                  cx="292"
                  cy={ry + 14}
                  r="3.5"
                  className={
                    isS1
                      ? "fill-brand-600 dark:fill-brand-400"
                      : "fill-gray-400 dark:fill-gray-500"
                  }
                />
                <text
                  x="304"
                  y={ry + 18}
                  className={
                    isS1
                      ? "fill-gray-900 text-xs font-medium dark:fill-gray-100"
                      : "fill-gray-500 text-xs dark:fill-gray-400"
                  }
                >
                  {rowLabel}
                </text>
              </g>
            );
          })}
        </g>

        {/* ==================== STAGE 3: ADAM VARIANCE BUDGET (x=424..556, y=20..184, CY=102) ==================== */}
        <g style={{ opacity: reachedS2 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M400,102 L422,102"
            fill="none"
            strokeWidth={isS2 ? "2" : "1.5"}
            className={
              isS2
                ? "stroke-brand-600 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS2 ? "url(#sa-arrow-brand)" : "url(#sa-arrow-gray)"}
          />
          <rect
            x="424"
            y="20"
            width="132"
            height="164"
            rx="10"
            strokeWidth={isS2 ? "2" : "1.5"}
            className={
              isS2
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <rect
            x="450"
            y="19"
            width="80"
            height="3"
            rx="1.5"
            className={isS2 ? "fill-brand-600 dark:fill-brand-400" : "fill-transparent"}
          />
          <text
            x="490"
            y="42"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.budgetTitle}
          </text>

          {/* Variance Gauge Bar */}
          <text
            x="436"
            y="68"
            className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
          >
            Vt
          </text>
          <text
            x="544"
            y="68"
            textAnchor="end"
            className={
              isS2
                ? "fill-brand-700 font-mono text-xs font-semibold tabular-nums dark:fill-brand-300"
                : "fill-gray-600 font-mono text-xs tabular-nums dark:fill-gray-400"
            }
          >
            0.06
          </text>
          <rect
            x="436"
            y="74"
            width="108"
            height="8"
            rx="4"
            className="fill-gray-100 dark:fill-gray-800"
          />
          <rect
            x="436"
            y="74"
            width="64"
            height="8"
            rx="4"
            className={
              isS2
                ? "fill-brand-600 dark:fill-brand-400"
                : "fill-gray-400 dark:fill-gray-500"
            }
          />

          {/* 4 Geometric Budget Slots (B1..B4: 2 Unlocked, 2 Locked) */}
          <text
            x="436"
            y="108"
            className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
          >
            Bt
          </text>
          <text
            x="544"
            y="108"
            textAnchor="end"
            className={
              isS2
                ? "fill-brand-700 font-mono text-xs font-semibold tabular-nums dark:fill-brand-300"
                : "fill-gray-700 font-mono text-xs font-semibold tabular-nums dark:fill-gray-300"
            }
          >
            2 / 4
          </text>
          {[0, 1, 2, 3].map((slot) => {
            const unlocked = slot < 2;
            const sx = 436 + slot * 28;
            return (
              <g key={slot}>
                <rect
                  x={sx}
                  y="118"
                  width="24"
                  height="46"
                  rx="5"
                  strokeWidth="1.25"
                  className={
                    unlocked
                      ? isS2
                        ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
                        : "fill-brand-100 stroke-brand-400 dark:fill-brand-950 dark:stroke-brand-600"
                      : "fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
                  }
                />
                <text
                  x={sx + 12}
                  y="145"
                  textAnchor="middle"
                  className={
                    unlocked
                      ? isS2
                        ? "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                        : "fill-brand-800 font-mono text-xs font-semibold dark:fill-brand-200"
                      : "fill-gray-400 font-mono text-xs font-medium dark:fill-gray-500"
                  }
                >
                  {`B${slot + 1}`}
                </text>
              </g>
            );
          })}
        </g>

        {/* ==================== STAGE 4: MEAN GATE & SKILL.MD UPDATE (x=580..712, y=20..184, CY=102) ==================== */}
        <g style={{ opacity: reachedS3 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M556,102 L578,102"
            fill="none"
            strokeWidth={isS3 ? "2" : "1.5"}
            className={
              isS3
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS3 ? "url(#sa-arrow-emerald)" : "url(#sa-arrow-gray)"}
          />
          <rect
            x="580"
            y="20"
            width="132"
            height="164"
            rx="10"
            strokeWidth={isS3 ? "2" : "1.5"}
            className={
              isS3
                ? "fill-emerald-50/40 stroke-emerald-600 dark:fill-emerald-950/30 dark:stroke-emerald-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <rect
            x="606"
            y="19"
            width="80"
            height="3"
            rx="1.5"
            className={isS3 ? "fill-emerald-600 dark:fill-emerald-400" : "fill-transparent"}
          />
          <text
            x="646"
            y="42"
            textAnchor="middle"
            className={
              isS3
                ? "fill-emerald-700 text-xs font-semibold dark:fill-emerald-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.gateTitle}
          </text>

          {/* Best vs Cand Score Bars */}
          <text
            x="592"
            y="66"
            className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
          >
            {copy.bestLabel}
          </text>
          <text
            x="700"
            y="66"
            textAnchor="end"
            className="fill-gray-700 font-mono text-xs font-semibold tabular-nums dark:fill-gray-300"
          >
            74.9
          </text>
          <rect
            x="592"
            y="72"
            width="108"
            height="7"
            rx="3.5"
            className="fill-gray-100 dark:fill-gray-800"
          />
          <rect
            x="592"
            y="72"
            width="80"
            height="7"
            rx="3.5"
            className="fill-gray-400 dark:fill-gray-500"
          />

          <text
            x="592"
            y="98"
            className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
          >
            {copy.candLabel}
          </text>
          <text
            x="700"
            y="98"
            textAnchor="end"
            className={
              isS3
                ? "fill-emerald-700 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-300"
                : "fill-gray-700 font-mono text-xs font-semibold tabular-nums dark:fill-gray-300"
            }
          >
            97.3
          </text>
          <rect
            x="592"
            y="104"
            width="108"
            height="7"
            rx="3.5"
            className="fill-gray-100 dark:fill-gray-800"
          />
          <rect
            x="592"
            y="104"
            width="105"
            height="7"
            rx="3.5"
            className={
              isS3
                ? "fill-emerald-500 dark:fill-emerald-400"
                : "fill-gray-400 dark:fill-gray-500"
            }
          />

          {/* Bottom Accept & SKILL.md Update Badge */}
          <rect
            x="592"
            y="128"
            width="108"
            height="42"
            rx="6"
            className={
              isS3
                ? "fill-emerald-600 dark:fill-emerald-500"
                : "fill-gray-200 dark:fill-gray-800"
            }
          />
          <text
            x="646"
            y="145"
            textAnchor="middle"
            className={
              isS3
                ? "fill-emerald-100 font-mono text-xs font-medium dark:fill-gray-900"
                : "fill-gray-500 font-mono text-xs dark:fill-gray-400"
            }
          >
            Cand &gt; Best
          </text>
          <text
            x="646"
            y="161"
            textAnchor="middle"
            className={
              isS3
                ? "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                : "fill-gray-700 font-mono text-xs font-semibold dark:fill-gray-300"
            }
          >
            SKILL.md v2
          </text>

          {/* Closed-Loop Return Bus from Stage 4 bottom (x=646, y=184) -> Target Agent bottom (x=191, y=148) */}
          <path
            d="M646,184 L646,204 L191,204 L191,148"
            fill="none"
            strokeWidth={isS3 ? "1.75" : "1.5"}
            strokeLinejoin="round"
            className={
              isS3
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-700"
            }
            markerEnd={isS3 ? "url(#sa-arrow-emerald)" : "url(#sa-arrow-gray)"}
          />
        </g>
      </svg>
    </div>
  );
}
