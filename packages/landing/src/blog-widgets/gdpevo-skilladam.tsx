/**
 * Progressive 4-Stage Spotlight Diagram for Section 2 of the GDPEVO blog post (SkillAdam).
 *
 * Four equal-height algorithm modules (y = 16..180, h = 164) form a clean left-to-right closed
 * loop with gray (0.24) -> bright spotlight -> calm neutral transitions:
 *   Stage 1 (Col 1, x = 8..196):   `1. 五题试跑测分差` / `1. 5-Task Rollout`
 *                                  Target Agent runs T1..T5, measuring scores and uneven deltas
 *   Stage 2 (Col 2, x = 220..356): `2. 严格均分门控` / `2. Strict Mean Gate`
 *                                  Compares Cand Mean (97.3) vs Best Mean (74.9) -> ACCEPT
 *   Stage 3 (Col 3, x = 380..532): `3. Adam 状态更新` / `3. Adam Controller`
 *                                  1st-moment EIT Ledger (what to fix) + 2nd-moment Edit Quota
 *                                  (high variance shrinks quota from 4 down to Max 2 / 4 edits)
 *   Stage 4 (Col 4, x = 556..712): `4. 局部微调 SKILL.md` / `4. Bounded Skill Edit`
 *                                  Applies only 2 localized diffs (+ Diff 1, + Diff 2) inside
 *                                  SKILL.md while keeping the rest untouched, then loops back.
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
  { id: "rollout", tabZh: "1. 五题试跑测分差", tabEn: "1. 5-Task Rollout" },
  { id: "gate", tabZh: "2. 严格均分门控", tabEn: "2. Strict Mean Gate" },
  { id: "adam", tabZh: "3. Adam 状态更新", tabEn: "3. Adam Controller" },
  { id: "edit", tabZh: "4. 局部微调 SKILL.md", tabEn: "4. Bounded Skill Edit" },
];

const TASK_ROLLOUT = [
  { label: "T1", width: 68, delta: "+24" },
  { label: "T2", width: 72, delta: "+13" },
  { label: "T3", width: 66, delta: "+31" },
  { label: "T4", width: 74, delta: "+12" },
  { label: "T5", width: 70, delta: "+33" },
] as const;

/** 5 document lines representing SKILL.md in Col 4: only 2 lines receive localized diffs. */
const DOC_LINES = [
  { edited: false, width: 62, diffIdx: 0 },
  { edited: true, width: 54, diffIdx: 1 },
  { edited: false, width: 68, diffIdx: 0 },
  { edited: true, width: 58, diffIdx: 2 },
  { edited: false, width: 50, diffIdx: 0 },
] as const;

const TOTAL_TICKS = 10;

function tickDelayMs(tick: number): number {
  if (tick < 5) return 480;
  if (tick === 5 || tick === 6) return 2000;
  if (tick === 9) return 2400;
  return 900;
}

export function SkillAdamWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

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

  const activeTaskIdx = tick < 5 ? tick : 4;
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
        col1Title: "目标 Agent 试跑",
        col2Title: "均分门控",
        bestLabel: "当前最佳",
        candLabel: "本轮均分",
        acceptWord: "采纳晋级",
        col3Title: "Adam 控制器",
        eitLabel: "一阶：EIT 问题账本",
        eitSub: "定方向：记失误与历史",
        quotaLabel: "二阶：修改额度 2/4",
        col4Title: "局部微调 SKILL.md",
        diffLabel: (n: number) => `修改 ${n}`,
        nextSkill: "输出新版 SKILL.md",
      }
    : {
        play: "Play evolution flow",
        pause: "Pause evolution flow",
        col1Title: "Target Agent Rollout",
        col2Title: "Mean Gate",
        bestLabel: "Best",
        candLabel: "Cand",
        acceptWord: "ACCEPT",
        col3Title: "Adam Controller",
        eitLabel: "1st: EIT Ledger",
        eitSub: "What to fix & avoid",
        quotaLabel: "2nd: Edit Quota 2/4",
        col4Title: "SKILL.md (2 Edits)",
        diffLabel: (n: number) => `Diff ${n}`,
        nextSkill: "Updated SKILL.md",
      };

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      {/* Minimal Frameless Control Strip */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="SkillAdam stages"
        >
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

      {/* 4 Peer Equal-Height Columns SVG (No Docker Wrapper Box, Gray -> Bright Spotlight) */}
      <svg
        viewBox="0 0 720 216"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label="SkillAdam four-stage evolution pipeline"
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

        {/* ==================== STAGE 1: 5-TASK ROLLOUT & DELTAS (x=8..196, y=16..180, CY=98) ==================== */}
        <g>
          <rect
            x="8"
            y="16"
            width="188"
            height="164"
            rx="10"
            strokeWidth={isS0 ? "2" : "1.5"}
            className={
              isS0
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="102"
            y="38"
            textAnchor="middle"
            className={
              isS0
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col1Title}
          </text>

          {/* 5 Task Score + Delta Rows (T1..T5) */}
          {TASK_ROLLOUT.map((item, i) => {
            const ry = 54 + i * 24;
            const isCurrent = isS0 && i === activeTaskIdx;
            const isDone = !isS0 || i <= activeTaskIdx;
            return (
              <g key={item.label}>
                <text
                  x="22"
                  y={ry + 9}
                  className={
                    isCurrent
                      ? "fill-brand-700 font-mono text-xs font-semibold tabular-nums dark:fill-brand-300"
                      : "fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
                  }
                >
                  {item.label}
                </text>
                <rect
                  x="46"
                  y={ry + 1}
                  width="92"
                  height="8"
                  rx="4"
                  className="fill-gray-100 dark:fill-gray-800"
                />
                {isDone && (
                  <rect
                    x="46"
                    y={ry + 1}
                    width={item.width}
                    height="8"
                    rx="4"
                    className={
                      isS0
                        ? "fill-brand-600 dark:fill-brand-400"
                        : "fill-gray-400 dark:fill-gray-500"
                    }
                  />
                )}
                <text
                  x="182"
                  y={ry + 9}
                  textAnchor="end"
                  className={
                    isDone
                      ? isS0
                        ? "fill-brand-700 font-mono text-xs font-semibold tabular-nums dark:fill-brand-300"
                        : "fill-gray-600 font-mono text-xs tabular-nums dark:fill-gray-400"
                      : "fill-gray-300 font-mono text-xs tabular-nums dark:fill-gray-600"
                  }
                >
                  {isDone ? item.delta : "--"}
                </text>
              </g>
            );
          })}
        </g>

        {/* ==================== STAGE 2: STRICT MEAN GATE (x=220..356, y=16..180, CY=98) ==================== */}
        <g style={{ opacity: reachedS1 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M196,98 L218,98"
            fill="none"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS1 ? "url(#sa-arrow-emerald)" : "url(#sa-arrow-gray)"}
          />
          <rect
            x="220"
            y="16"
            width="136"
            height="164"
            rx="10"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "fill-emerald-50/40 stroke-emerald-600 dark:fill-emerald-950/30 dark:stroke-emerald-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="288"
            y="38"
            textAnchor="middle"
            className={
              isS1
                ? "fill-emerald-700 text-xs font-semibold dark:fill-emerald-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col2Title}
          </text>

          {/* Best vs Cand Score Bars */}
          <text
            x="234"
            y="64"
            className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
          >
            {copy.bestLabel}
          </text>
          <text
            x="342"
            y="64"
            textAnchor="end"
            className="fill-gray-700 font-mono text-xs font-semibold tabular-nums dark:fill-gray-300"
          >
            74.9
          </text>
          <rect
            x="234"
            y="70"
            width="108"
            height="8"
            rx="4"
            className="fill-gray-100 dark:fill-gray-800"
          />
          <rect
            x="234"
            y="70"
            width="80"
            height="8"
            rx="4"
            className="fill-gray-400 dark:fill-gray-500"
          />

          <text
            x="234"
            y="98"
            className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
          >
            {copy.candLabel}
          </text>
          <text
            x="342"
            y="98"
            textAnchor="end"
            className={
              isS1
                ? "fill-emerald-700 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-300"
                : "fill-gray-700 font-mono text-xs font-semibold tabular-nums dark:fill-gray-300"
            }
          >
            97.3
          </text>
          <rect
            x="234"
            y="104"
            width="108"
            height="8"
            rx="4"
            className="fill-gray-100 dark:fill-gray-800"
          />
          <rect
            x="234"
            y="104"
            width="105"
            height="8"
            rx="4"
            className={
              isS1 ? "fill-emerald-500 dark:fill-emerald-400" : "fill-gray-400 dark:fill-gray-500"
            }
          />

          {/* Gate Verdict Badge */}
          <rect
            x="234"
            y="128"
            width="108"
            height="38"
            rx="6"
            className={
              isS1 ? "fill-emerald-600 dark:fill-emerald-500" : "fill-gray-200 dark:fill-gray-800"
            }
          />
          <text
            x="288"
            y="144"
            textAnchor="middle"
            className={
              isS1
                ? "fill-emerald-100 font-mono text-xs font-medium dark:fill-gray-900"
                : "fill-gray-500 font-mono text-xs dark:fill-gray-400"
            }
          >
            Cand &gt; Best
          </text>
          <text
            x="288"
            y="159"
            textAnchor="middle"
            className={
              isS1
                ? "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                : "fill-gray-700 font-mono text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.acceptWord}
          </text>
        </g>

        {/* ==================== STAGE 3: ADAM CONTROLLER (EIT + EDIT QUOTA) (x=380..532, y=16..180, CY=98) ==================== */}
        <g style={{ opacity: reachedS2 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M356,98 L378,98"
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
            x="380"
            y="16"
            width="152"
            height="164"
            rx="10"
            strokeWidth={isS2 ? "2" : "1.5"}
            className={
              isS2
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="456"
            y="38"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col3Title}
          </text>

          {/* 1st Moment: EIT Issue Ledger (Proportional Font so it fits with generous margin) */}
          <rect
            x="392"
            y="50"
            width="128"
            height="46"
            rx="6"
            strokeWidth="1"
            className={
              isS2
                ? "fill-white stroke-brand-300 dark:fill-gray-900 dark:stroke-brand-700"
                : "fill-gray-50 stroke-gray-200 dark:fill-gray-800/60 dark:stroke-gray-700"
            }
          />
          <text
            x="456"
            y="68"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.eitLabel}
          </text>
          <text
            x="456"
            y="85"
            textAnchor="middle"
            className="fill-gray-500 text-xs dark:fill-gray-400"
          >
            {copy.eitSub}
          </text>

          {/* 2nd Moment: Edit Quota (Single Centered Text — Never Collides) */}
          <text
            x="456"
            y="118"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 text-xs font-semibold tabular-nums dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold tabular-nums dark:fill-gray-300"
            }
          >
            {copy.quotaLabel}
          </text>

          {[0, 1, 2, 3].map((slot) => {
            const allowed = slot < 2;
            const sx = 392 + slot * 33;
            return (
              <g key={slot}>
                <rect
                  x={sx}
                  y="128"
                  width="29"
                  height="38"
                  rx="5"
                  strokeWidth="1.25"
                  className={
                    allowed
                      ? isS2
                        ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
                        : "fill-gray-200 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
                      : "fill-gray-100 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
                  }
                />
                <text
                  x={sx + 14.5}
                  y="151"
                  textAnchor="middle"
                  className={
                    allowed
                      ? isS2
                        ? "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                        : "fill-gray-700 font-mono text-xs font-semibold dark:fill-gray-300"
                      : "fill-gray-400 font-mono text-xs font-medium dark:fill-gray-500"
                  }
                >
                  {allowed ? `#${slot + 1}` : "—"}
                </text>
              </g>
            );
          })}
        </g>

        {/* ==================== STAGE 4: BOUNDED SKILL.MD DIFF VIEW (x=556..712, y=16..180, CY=98) ==================== */}
        <g style={{ opacity: reachedS3 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M532,98 L554,98"
            fill="none"
            strokeWidth={isS3 ? "2" : "1.5"}
            className={
              isS3
                ? "stroke-brand-600 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS3 ? "url(#sa-arrow-brand)" : "url(#sa-arrow-gray)"}
          />
          <rect
            x="556"
            y="16"
            width="156"
            height="164"
            rx="10"
            strokeWidth={isS3 ? "2" : "1.5"}
            className={
              isS3
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="634"
            y="38"
            textAnchor="middle"
            className={
              isS3
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col4Title}
          </text>

          {/* 5 Document Lines of SKILL.md: Only 2 Lines Receive Localized Diffs */}
          {DOC_LINES.map((line, li) => {
            const ly = 50 + li * 17;
            return (
              <g key={li}>
                <rect
                  x="568"
                  y={ly + 3}
                  width={line.width}
                  height="6"
                  rx="3"
                  className={
                    line.edited
                      ? isS3
                        ? "fill-brand-600 dark:fill-brand-400"
                        : "fill-gray-400 dark:fill-gray-500"
                      : "fill-gray-200 dark:fill-gray-800"
                  }
                />
                {line.edited && (
                  <>
                    <rect
                      x="644"
                      y={ly - 1}
                      width="56"
                      height="14"
                      rx="3"
                      className={
                        isS3
                          ? "fill-brand-600 dark:fill-brand-400"
                          : "fill-gray-300 dark:fill-gray-700"
                      }
                    />
                    <text
                      x="672"
                      y={ly + 10}
                      textAnchor="middle"
                      className={
                        isS3
                          ? "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                          : "fill-gray-600 font-mono text-xs font-medium dark:fill-gray-300"
                      }
                    >
                      {copy.diffLabel(line.diffIdx)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Bottom Output Pill (132px wide, Proportional Font so both EN and ZH fit with >16px margin) */}
          <rect
            x="568"
            y="142"
            width="132"
            height="26"
            rx="5"
            className={
              isS3 ? "fill-brand-600 dark:fill-brand-500" : "fill-gray-100 dark:fill-gray-800"
            }
          />
          <text
            x="634"
            y="159"
            textAnchor="middle"
            className={
              isS3
                ? "fill-white text-xs font-semibold dark:fill-gray-950"
                : "fill-gray-500 text-xs font-medium dark:fill-gray-400"
            }
          >
            {copy.nextSkill}
          </text>

          {/* Closed-Loop Return Bus from Stage 4 bottom (x=634, y=180) -> Stage 1 bottom (x=102, y=182) */}
          <path
            d="M634,180 L634,202 L102,202 L102,182"
            fill="none"
            strokeWidth={isS3 ? "1.75" : "1.5"}
            strokeLinejoin="round"
            className={
              isS3
                ? "stroke-brand-600 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-700"
            }
            markerEnd={isS3 ? "url(#sa-arrow-brand)" : "url(#sa-arrow-gray)"}
          />
        </g>
      </svg>
    </div>
  );
}
