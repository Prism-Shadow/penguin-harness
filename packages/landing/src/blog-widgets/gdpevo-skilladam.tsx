/**
 * Progressive, grid-aligned kinetic diagram for Section 2 of the GDPEVO blog post (SkillAdam).
 *
 * Matches the open-canvas, 4-column left-to-right architectural aesthetic of Section 4:
 * - Zero outer card chrome or text-heavy bottom panels.
 * - Strictly locked to a 4-column horizontal grid (all columns spanning y = 42..218, h = 176,
 *   centered on CY = 130, connected by crisp solid lines):
 *     Col 1 (x = 8..236):   `1 Shared Docker` — Agent + 3+2 `T1..T5` rollout loop in natural order
 *     Col 2 (x = 264..404): `Adam Controller` — EIT ledger + Variance `Vt` -> 4-Slot Budget `Bt`
 *     Col 3 (x = 432..552): `Mean Gate` — compares `Cand μ` vs `Best μ` (ACCEPT or ROLLBACK)
 *     Col 4 (x = 580..712): `SKILL.md` — 4 structural rule blocks (`B1..B4`) + Retained Mean Score
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

interface RoundData {
  readonly id: string;
  readonly tabZh: string;
  readonly tabEn: string;
  readonly roundBadge: string;
  readonly agentSkill: string;
  readonly bestMean: number;
  readonly candMean: number;
  readonly retainedMean: number;
  readonly variance: number;
  readonly budget: 1 | 2 | 3 | 4;
  readonly gate: "accept" | "reject";
  readonly outVersion: string;
  readonly blocks: readonly [
    "updated" | "locked" | "reverted",
    "updated" | "locked" | "reverted",
    "updated" | "locked" | "reverted",
    "updated" | "locked" | "reverted",
  ];
}

const ROUNDS: readonly RoundData[] = [
  {
    id: "r1",
    tabZh: "1. 初版提炼 (4/4 槽)",
    tabEn: "1. Init Skill (4/4)",
    roundBadge: "Iter 1",
    agentSkill: "No Skill",
    bestMean: 49.2,
    candMean: 74.9,
    retainedMean: 74.86,
    variance: 0.024,
    budget: 4,
    gate: "accept",
    outVersion: "SKILL.md v1",
    blocks: ["updated", "updated", "updated", "updated"],
  },
  {
    id: "r2",
    tabZh: "2. 预算收缩 (2/4 槽)",
    tabEn: "2. Tighten Budget (2/4)",
    roundBadge: "Iter 2",
    agentSkill: "Skill v1",
    bestMean: 74.9,
    candMean: 97.3,
    retainedMean: 97.33,
    variance: 0.058,
    budget: 2,
    gate: "accept",
    outVersion: "SKILL.md v2",
    blocks: ["updated", "updated", "locked", "locked"],
  },
  {
    id: "r3",
    tabZh: "3. 退化回滚 (拦截)",
    tabEn: "3. Gate Rollback",
    roundBadge: "Iter 3*",
    agentSkill: "Skill v2",
    bestMean: 97.3,
    candMean: 88.4,
    retainedMean: 97.33,
    variance: 0.086,
    budget: 2,
    gate: "reject",
    outVersion: "Keep v2",
    blocks: ["reverted", "reverted", "locked", "locked"],
  },
  {
    id: "r4",
    tabZh: "4. 单槽精修 (1/4 槽)",
    tabEn: "4. Surgical Fix (1/4)",
    roundBadge: "Iter 4",
    agentSkill: "Skill v2",
    bestMean: 97.3,
    candMean: 100.0,
    retainedMean: 100.0,
    variance: 0.082,
    budget: 1,
    gate: "accept",
    outVersion: "SKILL.md v3",
    blocks: ["updated", "locked", "locked", "locked"],
  },
];

/**
 * Within each round, 9 sub-ticks drive the progressive left-to-right build & task sweep:
 *   sub 0..4: Sweep T1 -> T2 -> T3 -> T4 -> T5 inside `1 Shared Docker`
 *   sub 5:    Materialize Col 2 (`Adam Controller`: EIT + Variance Vt + Budget Bt)
 *   sub 6:    Materialize Col 3 (`Mean Gate`: Cand μ vs Best μ)
 *   sub 7..8: Materialize Col 4 (`SKILL.md` blocks B1..B4 + Retained Score) or Rollback arc
 */
const SUB_TICKS = 9;
const TOTAL_TICKS = ROUNDS.length * SUB_TICKS;

/** 3+2 training task cards inside `1 Shared Docker` (natural left-to-right reading order). */
const TRAIN_CARDS = [
  { label: "T1", x: 120, y: 92, w: 32, h: 32 },
  { label: "T2", x: 157, y: 92, w: 32, h: 32 },
  { label: "T3", x: 194, y: 92, w: 32, h: 32 },
  { label: "T4", x: 138, y: 132, w: 32, h: 32 },
  { label: "T5", x: 176, y: 132, w: 32, h: 32 },
] as const;

const BLOCK_LABELS = ["B1 Schema", "B2 Flow", "B3 Rules", "B4 Check"] as const;

function tickDelay(sub: number): number {
  if (sub < 5) return 360;
  if (sub === 8) return 1800;
  return 620;
}

export function SkillAdamWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  // SSR / reduced-motion starts at completed frame of Round 2 (tick 17, showing 2/4 budget & 97.33);
  // live view starts at tick 0 when scrolled into view.
  const [tick, setTick] = useState<number>(17);
  const [paused, setPaused] = useState<boolean>(false);
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const running = active && !reduced && !paused;
  const roundIdx = Math.floor(tick / SUB_TICKS) % ROUNDS.length;
  const sub = tick % SUB_TICKS;
  const round = ROUNDS[roundIdx] ?? ROUNDS[0]!;

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
    }, tickDelay(sub));
    return () => window.clearTimeout(timer);
  }, [running, sub]);

  const selectRound = (idx: number) => {
    // Jump to the completed state (sub = 8) of the clicked round so all 4 columns are visible immediately.
    setTick(idx * SUB_TICKS + 8);
    setPaused(true);
  };

  const activeTaskIdx = sub < 5 ? sub : -1;
  const showCol2 = sub >= 5;
  const showCol3 = sub >= 6;
  const showCol4 = sub >= 7;
  const isReject = round.gate === "reject";

  const copy = isZh
    ? {
        play: "播放演进循环",
        pause: "暂停演进循环",
      }
    : {
        play: "Play evolution loop",
        pause: "Pause evolution loop",
      };

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      {/* Minimal Frameless Control Strip */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="SkillAdam rounds">
          {ROUNDS.map((r, idx) => {
            const isCurrent = idx === roundIdx;
            const rejectTab = r.gate === "reject";
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => selectRound(idx)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  isCurrent
                    ? rejectTab
                      ? "bg-rose-600 text-white dark:bg-rose-500 dark:text-gray-950"
                      : "bg-brand-600 text-white dark:bg-brand-500 dark:text-gray-950"
                    : "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/70 dark:text-brand-300 dark:hover:bg-brand-900/60"
                }`}
              >
                {isZh ? r.tabZh : r.tabEn}
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

      {/* Strictly Aligned 4-Column Open-Canvas SVG (y = 36..204, CY = 120) */}
      <svg
        viewBox="0 0 720 214"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label="SkillAdam in-container evolution loop"
      >
        <defs>
          <marker
            id="sa-solid-brand"
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
            id="sa-solid-gray"
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
            id="sa-solid-emerald"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 Z" className="fill-emerald-600 dark:fill-emerald-400" />
          </marker>
          <marker
            id="sa-solid-rose"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 Z" className="fill-rose-600 dark:fill-rose-400" />
          </marker>
        </defs>

        {/* ==================== COL 1: 1 SHARED DOCKER (x=8..238, y=36..200, CY=118) ==================== */}
        <g>
          <rect
            x="8"
            y="36"
            width="230"
            height="164"
            rx="10"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            className="fill-brand-50/25 stroke-brand-500 dark:fill-brand-950/20 dark:stroke-brand-400"
          />
          <text
            x="20"
            y="57"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            1 Shared Docker
          </text>
          <rect
            x="174"
            y="44"
            width="54"
            height="18"
            rx="4"
            className="fill-brand-100 dark:fill-brand-900/70"
          />
          <text
            x="201"
            y="57"
            textAnchor="middle"
            className="fill-brand-800 font-mono text-xs font-semibold tabular-nums dark:fill-brand-200"
          >
            {round.roundBadge}
          </text>

          {/* 3+2 Task Pool Frame (x=114..230, y=84..172, center CY=128) */}
          <rect
            x="114"
            y="84"
            width="116"
            height="88"
            rx="8"
            strokeWidth="1"
            className="fill-gray-50/80 stroke-gray-200 dark:fill-gray-800/40 dark:stroke-gray-700"
          />
          <path
            d="M92,116 L112,116"
            fill="none"
            strokeWidth="1.5"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#sa-solid-brand)"
          />
          <path
            d="M114,140 L94,140"
            fill="none"
            strokeWidth="1.5"
            className="stroke-gray-400 dark:stroke-gray-500"
            markerEnd="url(#sa-solid-gray)"
          />

          {/* Base Agent Node inside 1 Shared Docker (x=18..94, y=92..164, h=72, center CY=128) */}
          <rect
            x="18"
            y="92"
            width="76"
            height="72"
            rx="8"
            strokeWidth="1.5"
            className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
          />
          <text
            x="56"
            y="118"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            Base Agent
          </text>
          <rect
            x="24"
            y="130"
            width="64"
            height="22"
            rx="4"
            className="fill-brand-50 dark:fill-brand-950"
          />
          <text
            x="56"
            y="145"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            {round.agentSkill}
          </text>

          {/* 3+2 Training Task Cards (T1..T5 in natural left-to-right reading order) */}
          {TRAIN_CARDS.map((card, i) => {
            const isCurrentTask = i === activeTaskIdx;
            const isDone = sub > i;
            const regressionTask = isReject && (i === 3 || i === 4) && isDone;
            const cardStyle = isCurrentTask
              ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
              : regressionTask
                ? "fill-rose-50 stroke-rose-500 dark:fill-rose-950/60 dark:stroke-rose-400"
                : isDone
                  ? "fill-brand-50 stroke-brand-400 dark:fill-brand-950/60 dark:stroke-brand-500"
                  : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700";
            const textStyle = isCurrentTask
              ? "fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
              : regressionTask
                ? "fill-rose-700 font-mono text-xs font-semibold tabular-nums dark:fill-rose-300"
                : isDone
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
        </g>

        {/* ==================== COL 2: ADAM CONTROLLER (EIT + BUDGET Bt) (x=262..406, y=36..200) ==================== */}
        {showCol2 && (
          <g className="anim-block">
            <path
              d="M238,118 L260,118"
              fill="none"
              strokeWidth="1.75"
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#sa-solid-brand)"
            />
            <rect
              x="262"
              y="36"
              width="144"
              height="164"
              rx="10"
              strokeWidth="1.5"
              className="fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
            />
            <text
              x="334"
              y="57"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Adam Controller
            </text>

            {/* Module A: EIT Issue Ledger */}
            <rect
              x="274"
              y="70"
              width="120"
              height="40"
              rx="6"
              strokeWidth="1"
              className="fill-gray-50 stroke-gray-200 dark:fill-gray-800/60 dark:stroke-gray-700"
            />
            <text
              x="334"
              y="87"
              textAnchor="middle"
              className="fill-gray-700 font-mono text-xs font-semibold dark:fill-gray-300"
            >
              EIT Ledger
            </text>
            <rect
              x="286"
              y="96"
              width="96"
              height="5"
              rx="2.5"
              className="fill-brand-500 dark:fill-brand-400"
            />

            {/* Module B: Variance Vt -> 4-Slot Edit Budget Bt */}
            <text
              x="274"
              y="134"
              className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
            >
              {`Vt ${round.variance.toFixed(2)}`}
            </text>
            <text
              x="394"
              y="134"
              textAnchor="end"
              className="fill-gray-900 font-mono text-xs font-semibold tabular-nums dark:fill-gray-100"
            >
              {`Bt ${round.budget}/4`}
            </text>

            {/* 4 Geometric Budget Slots (B1..B4) */}
            {[0, 1, 2, 3].map((slot) => {
              const unlocked = slot < round.budget;
              const sx = 274 + slot * 31;
              return (
                <g key={slot}>
                  <rect
                    x={sx}
                    y="146"
                    width="27"
                    height="32"
                    rx="5"
                    strokeWidth="1.25"
                    className={
                      unlocked
                        ? "fill-brand-600 stroke-brand-700 dark:fill-brand-500 dark:stroke-brand-300"
                        : "fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
                    }
                  />
                  <text
                    x={sx + 13.5}
                    y="166"
                    textAnchor="middle"
                    className={
                      unlocked
                        ? "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                        : "fill-gray-400 font-mono text-xs font-medium dark:fill-gray-500"
                    }
                  >
                    {`B${slot + 1}`}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* ==================== COL 3: STRICT MEAN GATE (x=430..552, y=36..200) ==================== */}
        {showCol3 && (
          <g className="anim-block">
            <path
              d="M406,118 L428,118"
              fill="none"
              strokeWidth="1.75"
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#sa-solid-brand)"
            />
            <rect
              x="430"
              y="36"
              width="122"
              height="164"
              rx="10"
              strokeWidth="1.5"
              className={
                isReject
                  ? "fill-white stroke-rose-500 dark:fill-gray-900 dark:stroke-rose-400"
                  : "fill-white stroke-emerald-600 dark:fill-gray-900 dark:stroke-emerald-400"
              }
            />
            <text
              x="491"
              y="57"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              Mean Gate
            </text>

            {/* Prior Best Bar */}
            <text
              x="442"
              y="82"
              className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
            >
              Best
            </text>
            <text
              x="540"
              y="82"
              textAnchor="end"
              className="fill-gray-700 font-mono text-xs font-semibold tabular-nums dark:fill-gray-300"
            >
              {round.bestMean.toFixed(1)}
            </text>
            <rect
              x="442"
              y="88"
              width="98"
              height="8"
              rx="4"
              className="fill-gray-100 dark:fill-gray-800"
            />
            <rect
              x="442"
              y="88"
              width={Math.round((round.bestMean / 100) * 98)}
              height="8"
              rx="4"
              className="fill-gray-400 dark:fill-gray-500"
            />

            {/* Candidate Mean Bar */}
            <text
              x="442"
              y="118"
              className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
            >
              Cand
            </text>
            <text
              x="540"
              y="118"
              textAnchor="end"
              className={
                isReject
                  ? "fill-rose-600 font-mono text-xs font-semibold tabular-nums dark:fill-rose-400"
                  : "fill-emerald-700 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-300"
              }
            >
              {round.candMean.toFixed(1)}
            </text>
            <rect
              x="442"
              y="124"
              width="98"
              height="8"
              rx="4"
              className="fill-gray-100 dark:fill-gray-800"
            />
            <rect
              x="442"
              y="124"
              width={Math.round((round.candMean / 100) * 98)}
              height="8"
              rx="4"
              className={
                isReject
                  ? "fill-rose-500 dark:fill-rose-400"
                  : "fill-emerald-500 dark:fill-emerald-400"
              }
            />

            {/* Gate Verdict Badge */}
            <rect
              x="442"
              y="152"
              width="98"
              height="34"
              rx="6"
              className={
                isReject
                  ? "fill-rose-600 dark:fill-rose-500"
                  : "fill-emerald-600 dark:fill-emerald-500"
              }
            />
            <text
              x="491"
              y="167"
              textAnchor="middle"
              className="fill-white/90 font-mono text-xs font-medium dark:fill-gray-900"
            >
              {isReject ? "Cand < Best" : "Cand > Best"}
            </text>
            <text
              x="491"
              y="181"
              textAnchor="middle"
              className="fill-white font-mono text-xs font-semibold dark:fill-gray-950"
            >
              {isReject ? "ROLLBACK" : "ACCEPT"}
            </text>
          </g>
        )}

        {/* ==================== COL 4: SKILL.MD SCOREBOARD COLUMN (x=576..712, y=36..200) ==================== */}
        {showCol4 && (
          <g className="anim-block">
            {/* Solid Forward Connector (Mean Gate -> SKILL.md) */}
            <path
              d="M552,118 L574,118"
              fill="none"
              strokeWidth="1.75"
              className={
                isReject
                  ? "stroke-rose-500 dark:stroke-rose-400"
                  : "stroke-emerald-600 dark:stroke-emerald-400"
              }
              markerEnd={isReject ? "url(#sa-solid-rose)" : "url(#sa-solid-emerald)"}
            />

            {/* Clean Orthogonal Rollback Return Path above Col 2 & Col 3 when rejected */}
            {isReject && (
              <path
                d="M491,36 L491,16 L334,16 L334,34"
                fill="none"
                strokeWidth="1.5"
                strokeLinejoin="round"
                className="stroke-rose-500 dark:stroke-rose-400"
                markerEnd="url(#sa-solid-rose)"
              />
            )}

            <rect
              x="576"
              y="36"
              width="136"
              height="164"
              rx="10"
              strokeWidth="1.5"
              className={
                isReject
                  ? "fill-white stroke-rose-500 dark:fill-gray-900 dark:stroke-rose-400"
                  : "fill-white stroke-emerald-600 dark:fill-gray-900 dark:stroke-emerald-400"
              }
            />
            <text
              x="644"
              y="57"
              textAnchor="middle"
              className="fill-gray-900 font-mono text-xs font-semibold dark:fill-gray-100"
            >
              {round.outVersion}
            </text>

            {/* 4 Structural Rule Blocks inside SKILL.md (B1..B4) */}
            {BLOCK_LABELS.map((bLabel, bi) => {
              const status = round.blocks[bi] ?? "locked";
              const by = 68 + bi * 20;
              const barStyle =
                status === "updated"
                  ? "fill-brand-500 dark:fill-brand-400"
                  : status === "reverted"
                    ? "fill-rose-500 dark:fill-rose-400"
                    : "fill-gray-300 dark:fill-gray-700";
              const pillStyle =
                status === "updated"
                  ? "fill-brand-500 dark:fill-brand-400"
                  : status === "reverted"
                    ? "fill-rose-500 dark:fill-rose-400"
                    : "fill-gray-200 dark:fill-gray-800";
              const tagText =
                status === "updated" ? "Edit" : status === "reverted" ? "Drop" : "Lock";
              return (
                <g key={bLabel}>
                  <text
                    x="588"
                    y={by + 11}
                    className="fill-gray-700 font-mono text-xs font-medium dark:fill-gray-300"
                  >
                    {`B${bi + 1}`}
                  </text>
                  <rect x="610" y={by + 4} width="44" height="7" rx="3.5" className={barStyle} />
                  <rect x="662" y={by + 1} width="38" height="14" rx="3" className={pillStyle} />
                  <text
                    x="681"
                    y={by + 11}
                    textAnchor="middle"
                    className={
                      status === "locked"
                        ? "fill-gray-600 font-mono text-xs font-medium dark:fill-gray-400"
                        : "fill-white font-mono text-xs font-semibold dark:fill-gray-950"
                    }
                  >
                    {tagText}
                  </text>
                </g>
              );
            })}

            {/* Bottom Retained Mean Score Badge (Matches Col 4 of Workflow Diagram) */}
            <rect
              x="586"
              y="154"
              width="116"
              height="36"
              rx="6"
              className="fill-emerald-600 dark:fill-emerald-500"
            />
            <text
              x="644"
              y="169"
              textAnchor="middle"
              className="fill-emerald-100 font-mono text-xs font-medium dark:fill-gray-900"
            >
              Retained Mean
            </text>
            <text
              x="644"
              y="184"
              textAnchor="middle"
              className="fill-white font-mono text-xs font-semibold tabular-nums dark:fill-gray-950"
            >
              {round.retainedMean.toFixed(2)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
