/**
 * Interactive kinetic diagram for Section 2 of the GDPEVO blog post:
 * visualizes how SkillAdam evolves `SKILL.md` inside one shared training container across
 * iterations using variance-scaled edit budgets (V_t -> B_{t+1}) and a strict mean gate.
 *
 * Self-contained under `src/blog-widgets/` so blog-specific interactive visuals stay modular.
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

interface RoundStep {
  readonly id: string;
  readonly tagZh: string;
  readonly tagEn: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly summaryZh: string;
  readonly summaryEn: string;
  readonly scores: readonly [number, number, number, number, number];
  readonly deltas: readonly [number, number, number, number, number];
  readonly mean: number;
  readonly bestBefore: number;
  readonly bestAfter: number;
  readonly variance: number;
  readonly budget: 1 | 2 | 3 | 4;
  readonly gate: "init" | "accept" | "reject";
  readonly skillVersion: string;
  /** Status of each of the 4 abstract SKILL.md blocks: idle, updated, locked, or reverted. */
  readonly blocks: readonly [
    "empty" | "updated" | "kept" | "locked" | "reverted",
    "empty" | "updated" | "kept" | "locked" | "reverted",
    "empty" | "updated" | "kept" | "locked" | "reverted",
    "empty" | "updated" | "kept" | "locked" | "reverted",
  ];
}

interface TrackPreset {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly subZh: string;
  readonly subEn: string;
  readonly rounds: readonly [RoundStep, RoundStep, RoundStep, RoundStep];
}

const BLOCK_NAMES = {
  zh: ["B1 结构契约", "B2 审计流程", "B3 边界规则", "B4 校验清单"] as const,
  en: ["B1 Schema", "B2 Workflow", "B3 Edge Rules", "B4 Checklist"] as const,
};

const TRACKS: readonly [TrackPreset, TrackPreset] = [
  {
    id: "convergent",
    nameZh: "轨迹 A：稳步收敛（工程项目分析）",
    nameEn: "Track A: Monotonic Convergence",
    subZh: "方差增大时自动收紧编辑槽位，保护高分块",
    subEn: "Variance tightens edit slots from 4 to 1 as score nears 100",
    rounds: [
      {
        id: "r0",
        tagZh: "R0 初测",
        tagEn: "R0 Zero-shot",
        titleZh: "无技能基线试跑（5 题同容器）",
        titleEn: "Zero-shot baseline rollout across 5 training tasks",
        summaryZh: "记录 5 道题初始得分与轨迹，开放全部 4 个技能编辑槽位。",
        summaryEn: "Records initial 5-task scores and trajectories; all 4 edit slots open.",
        scores: [38, 52, 45, 61, 50],
        deltas: [0, 0, 0, 0, 0],
        mean: 49.24,
        bestBefore: 49.24,
        bestAfter: 49.24,
        variance: 0.012,
        budget: 4,
        gate: "init",
        skillVersion: "v0 (None)",
        blocks: ["empty", "empty", "empty", "empty"],
      },
      {
        id: "r1",
        tagZh: "R1 初版提炼",
        tagEn: "R1 Init Skill",
        titleZh: "生成初版 SKILL.md（均分 +25.62）",
        titleEn: "Distills initial SKILL.md (Mean +25.62)",
        summaryZh: "均分升至 74.86 通过门控；但各题涨幅分歧较大，下一轮预算收缩至 2 槽。",
        summaryEn: "Mean rises to 74.86 (Gate Accept); task gain divergence shrinks next budget to 2 slots.",
        scores: [72, 85, 64, 88, 65],
        deltas: [34, 33, 19, 27, 15],
        mean: 74.86,
        bestBefore: 49.24,
        bestAfter: 74.86,
        variance: 0.052,
        budget: 2,
        gate: "accept",
        skillVersion: "v1 (Accepted)",
        blocks: ["updated", "updated", "updated", "updated"],
      },
      {
        id: "r2",
        tagZh: "R2 受限精修",
        tagEn: "R2 Bounded Edit",
        titleZh: "仅允许修改 2 个槽位（均分 +22.47）",
        titleEn: "Refines only 2 unlocked slots (Mean +22.47)",
        summaryZh: "锁定 B3/B4，仅精修 B1/B2，均分跃升至 97.33；预算进一步收紧至 1 槽。",
        summaryEn: "Locks B3/B4 and refines B1/B2; mean reaches 97.33 and budget tightens to 1 slot.",
        scores: [96, 98, 95, 100, 98],
        deltas: [24, 13, 31, 12, 33],
        mean: 97.33,
        bestBefore: 74.86,
        bestAfter: 97.33,
        variance: 0.068,
        budget: 1,
        gate: "accept",
        skillVersion: "v2 (Accepted)",
        blocks: ["updated", "updated", "locked", "locked"],
      },
      {
        id: "r3",
        tagZh: "R3 收敛冻结",
        tagEn: "R3 Freeze",
        titleZh: "单槽位微调满分收敛（均分 100.00）",
        titleEn: "Single-slot surgical polish reaches 100.00",
        summaryZh: "仅对 B3 边界规则做单点修补，5 题全部满分，冻结导出最终 SKILL.md。",
        summaryEn: "Touches only B3 Edge Rules; all 5 tasks hit 100.00 and SKILL.md is frozen.",
        scores: [100, 100, 100, 100, 100],
        deltas: [4, 2, 5, 0, 2],
        mean: 100.0,
        bestBefore: 97.33,
        bestAfter: 100.0,
        variance: 0.038,
        budget: 1,
        gate: "accept",
        skillVersion: "v3 (Frozen)",
        blocks: ["locked", "locked", "updated", "locked"],
      },
    ],
  },
  {
    id: "rollback",
    nameZh: "轨迹 B：退化拦截与回滚演示",
    nameEn: "Track B: Gate Reject & Rollback",
    subZh: "当修改导致部分题目退化拉低均分时，当场拦截并回滚",
    subEn: "Discards regressive edits and shrinks budget after cross-task conflict",
    rounds: [
      {
        id: "r0",
        tagZh: "R0 初测",
        tagEn: "R0 Zero-shot",
        titleZh: "无技能基线试跑（均分 69.54）",
        titleEn: "Zero-shot baseline rollout (Mean 69.54)",
        summaryZh: "5 道训练题初始表现均衡，开放 4 个编辑槽位生成初版技能。",
        summaryEn: "Balanced initial rollout across 5 tasks; all 4 edit slots open.",
        scores: [65, 72, 68, 74, 69],
        deltas: [0, 0, 0, 0, 0],
        mean: 69.54,
        bestBefore: 69.54,
        bestAfter: 69.54,
        variance: 0.015,
        budget: 4,
        gate: "init",
        skillVersion: "v0 (None)",
        blocks: ["empty", "empty", "empty", "empty"],
      },
      {
        id: "r1",
        tagZh: "R1 初版提炼",
        tagEn: "R1 Init Skill",
        titleZh: "提炼初版 SKILL.md（均分 79.67）",
        titleEn: "Initial SKILL.md accepted (Mean 79.67)",
        summaryZh: "5 题同步提分，均分升至 79.67 通过门控，保留 3 个可编辑槽位。",
        summaryEn: "All 5 tasks improve; mean reaches 79.67 (Gate Accept), keeping 3 edit slots.",
        scores: [78, 84, 76, 82, 78],
        deltas: [13, 12, 8, 8, 9],
        mean: 79.67,
        bestBefore: 69.54,
        bestAfter: 79.67,
        variance: 0.028,
        budget: 3,
        gate: "accept",
        skillVersion: "v1 (Accepted)",
        blocks: ["updated", "updated", "updated", "updated"],
      },
      {
        id: "r2",
        tagZh: "R2 门控拦截",
        tagEn: "R2 Gate Reject",
        titleZh: "过度修改引发退化（74.20 < 79.67，触发回滚）",
        titleEn: "Over-edit causes regression (74.20 < 79.67 -> Rollback)",
        summaryZh: "草稿 v2* 虽提升了 T2 (+6)，但破坏了 T4 (-18) 与 T5 (-14)；门控当场回滚至 v1，并将预算锁至 1 槽。",
        summaryEn: "Draft v2* helps T2 (+6) but breaks T4 (-18) and T5 (-14); Gate rejects v2*, restores v1, and locks budget to 1 slot.",
        scores: [78, 90, 75, 64, 64],
        deltas: [0, 6, -1, -18, -14],
        mean: 74.2,
        bestBefore: 79.67,
        bestAfter: 79.67,
        variance: 0.086,
        budget: 1,
        gate: "reject",
        skillVersion: "v1 (Restored)",
        blocks: ["reverted", "reverted", "reverted", "kept"],
      },
      {
        id: "r3",
        tagZh: "R3 单槽恢复",
        tagEn: "R3 Recovery",
        titleZh: "单槽位靶向修复通过门控（均分 85.42）",
        titleEn: "Single-slot targeted fix passes gate (Mean 85.42)",
        summaryZh: "在 B=1 严格约束下仅修正 B4 校验清单，消除跨题冲突，均分升至 85.42 冻结导出。",
        summaryEn: "Under B=1 constraint, edits only B4 Checklist; mean rises to 85.42 and freezes v2.",
        scores: [84, 88, 83, 86, 86],
        deltas: [6, 4, 7, 4, 8],
        mean: 85.42,
        bestBefore: 79.67,
        bestAfter: 85.42,
        variance: 0.042,
        budget: 1,
        gate: "accept",
        skillVersion: "v2 (Frozen)",
        blocks: ["locked", "locked", "locked", "updated"],
      },
    ],
  },
];

const STEP_MS = 3800;

export function SkillAdamWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  const [trackIdx, setTrackIdx] = useState<0 | 1>(0);
  const [stepIdx, setStepIdx] = useState<number>(1);
  const [paused, setPaused] = useState<boolean>(false);

  const track = TRACKS[trackIdx];
  const step = track.rounds[stepIdx] ?? track.rounds[0];
  const running = active && !reduced && !paused;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setStepIdx((prev) => (prev + 1) % track.rounds.length);
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [running, stepIdx, track.rounds.length]);

  const selectTrack = (next: 0 | 1) => {
    setTrackIdx(next);
    setStepIdx(next === 1 ? 2 : 1);
  };

  const selectStep = (next: number) => {
    setStepIdx(next);
    setPaused(true);
  };

  const isReject = step.gate === "reject";
  const isAccept = step.gate === "accept";

  const labels = isZh
    ? {
        play: "播放演进动画",
        pause: "暂停演进动画",
        containerBadge: "1 个共享训练容器 / 状态连续驻留",
        rolloutTitle: "1. 五题试跑",
        controllerTitle: "2. Adam 控制器",
        gateTitle: "3. 均值门控",
        skillTitle: "SKILL.md 块状态",
        meanLabel: "五题均分 μ",
        bestLabel: "历史最佳",
        varLabel: "分歧方差 Vt",
        budgetLabel: "本轮编辑预算 Bt",
        slotsUnit: (n: number) => `${n} 个槽位可改`,
        gateAccept: "ACCEPT 晋级",
        gateReject: "REJECT 回滚",
        gateInit: "INIT 初测",
      }
    : {
        play: "Play evolution loop",
        pause: "Pause evolution loop",
        containerBadge: "1 Shared Training Container / Persistent State",
        rolloutTitle: "1. 5-Task Rollout",
        controllerTitle: "2. Adam Controller",
        gateTitle: "3. Mean Gate",
        skillTitle: "SKILL.md Blocks",
        meanLabel: "5-Task Mean μ",
        bestLabel: "Prior Best",
        varLabel: "Variance Vt",
        budgetLabel: "Edit Budget Bt",
        slotsUnit: (n: number) => (n === 1 ? "1 slot unlocked" : `${n} slots unlocked`),
        gateAccept: "ACCEPT",
        gateReject: "ROLLBACK",
        gateInit: "BASELINE",
      };

  const blockNames = isZh ? BLOCK_NAMES.zh : BLOCK_NAMES.en;

  return (
    <div
      ref={ref}
      className="my-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
    >
      {/* Top Bar: Track Switcher + Round Stepper + Playback Control */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="SkillAdam tracks">
          {TRACKS.map((t, idx) => {
            const selected = idx === trackIdx;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectTrack(idx as 0 | 1)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                }`}
              >
                {isZh ? t.nameZh : t.nameEn}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1" role="tablist" aria-label="Iteration rounds">
            {track.rounds.map((r, idx) => {
              const activeStep = idx === stepIdx;
              const rejectStep = r.gate === "reject";
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={activeStep}
                  onClick={() => selectStep(idx)}
                  className={`rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                    activeStep
                      ? rejectStep
                        ? "bg-rose-100 text-rose-800 ring-1 ring-rose-300 ring-inset dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800"
                        : "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  }`}
                >
                  {isZh ? r.tagZh : r.tagEn}
                </button>
              );
            })}
          </div>
          <SitePlaybackButton
            paused={paused}
            onPausedChange={setPaused}
            labels={{ play: labels.play, pause: labels.pause }}
          />
        </div>
      </div>

      {/* Stage Banner: Container Identity + Round Headline */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200/80 px-4 py-2 text-xs dark:border-gray-800/80">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-medium text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {labels.containerBadge}
          </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {isZh ? step.titleZh : step.titleEn}
          </span>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isZh ? step.summaryZh : step.summaryEn}
        </span>
      </div>

      {/* Kinetic SVG Schematic: 4 Stations inside 1 Shared Container */}
      <div className="px-3 pt-3 pb-1 sm:px-4">
        <svg
          viewBox="0 0 680 176"
          className="block w-full select-none"
          role="img"
          aria-label={isZh ? step.titleZh : step.titleEn}
        >
          <defs>
            <marker
              id="sa-arrow-neutral"
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
            <marker
              id="sa-arrow-rose"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 Z" className="fill-rose-500 dark:fill-rose-400" />
            </marker>
          </defs>

          {/* Outer Shared Container Boundary */}
          <rect
            x="6"
            y="8"
            width="668"
            height="160"
            rx="12"
            strokeDasharray="5 4"
            strokeWidth="1.25"
            className="fill-white/70 stroke-brand-300 dark:fill-gray-950/60 dark:stroke-brand-800"
          />

          {/* Connector 1: Rollout (x=154) -> Adam Controller (x=196) */}
          <path
            id="sa-edge-1"
            d="M154,84 L194,84"
            fill="none"
            strokeWidth="1.75"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#sa-arrow-brand)"
          />

          {/* Connector 2: Adam Controller (x=344) -> Mean Gate (x=384) */}
          <path
            id="sa-edge-2"
            d="M344,84 L384,84"
            fill="none"
            strokeWidth="1.75"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#sa-arrow-brand)"
          />

          {/* Connector 3: Mean Gate (x=504) -> SKILL.md (x=540) */}
          <path
            id="sa-edge-3"
            d="M504,84 L538,84"
            fill="none"
            strokeWidth="1.75"
            strokeDasharray={isReject ? "3 3" : undefined}
            className={
              isReject
                ? "stroke-rose-400 dark:stroke-rose-500"
                : isAccept
                  ? "stroke-emerald-600 dark:stroke-emerald-400"
                  : "stroke-gray-400 dark:stroke-gray-500"
            }
            markerEnd={
              isReject
                ? "url(#sa-arrow-rose)"
                : isAccept
                  ? "url(#sa-arrow-emerald)"
                  : "url(#sa-arrow-neutral)"
            }
          />

          {/* Feedback Loop Arc: Bottom Accept Loop (SKILL.md -> Next Rollout) */}
          <path
            id="sa-loop-accept"
            d="M600,136 L600,154 Q600,160 594,160 L92,160 Q86,160 86,154 L86,138"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray={isReject ? "3 3" : undefined}
            className={
              isAccept
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-300 dark:stroke-gray-700"
            }
            markerEnd={isAccept ? "url(#sa-arrow-emerald)" : "url(#sa-arrow-neutral)"}
          />

          {/* Reject Rollback Arc: Top Gate -> Controller/Restore when gate === 'reject' */}
          <path
            id="sa-loop-reject"
            d="M444,34 L444,24 Q444,20 438,20 L274,20 Q268,20 268,24 L268,32"
            fill="none"
            strokeWidth={isReject ? "1.75" : "1"}
            strokeDasharray="4 3"
            className={
              isReject
                ? "stroke-rose-500 dark:stroke-rose-400"
                : "stroke-gray-200 dark:stroke-gray-800"
            }
            markerEnd={isReject ? "url(#sa-arrow-rose)" : undefined}
          />
          {isReject && (
            <rect
              x="284"
              y="10"
              width="144"
              height="16"
              rx="4"
              className="fill-white dark:fill-gray-950"
            />
          )}
          {isReject && (
            <text
              x="356"
              y="22"
              textAnchor="middle"
              className="fill-rose-600 font-mono text-xs font-semibold dark:fill-rose-400"
            >
              {isZh ? "丢弃 v2* 并锁紧预算" : "Rollback v2* & lock Bt"}
            </text>
          )}

          {/* Animated Flow Pulses when active */}
          {running && (
            <>
              <circle r="3" className="fill-brand-500 dark:fill-brand-400">
                <animateMotion dur="1.4s" repeatCount="indefinite" path="M154,84 L190,84" />
              </circle>
              <circle r="3" className="fill-brand-500 dark:fill-brand-400">
                <animateMotion dur="1.4s" begin="0.4s" repeatCount="indefinite" path="M344,84 L380,84" />
              </circle>
              {isAccept && (
                <>
                  <circle r="3" className="fill-emerald-500 dark:fill-emerald-400">
                    <animateMotion dur="1.2s" begin="0.7s" repeatCount="indefinite" path="M504,84 L536,84" />
                  </circle>
                  <circle r="2.75" className="fill-emerald-500 dark:fill-emerald-400">
                    <animateMotion
                      dur="2.8s"
                      repeatCount="indefinite"
                      path="M600,136 L600,154 L92,154 L86,138"
                    />
                  </circle>
                </>
              )}
              {isReject && (
                <circle r="3" className="fill-rose-500 dark:fill-rose-400">
                  <animateMotion
                    dur="1.6s"
                    repeatCount="indefinite"
                    path="M444,34 L444,16 L268,16 L268,32"
                  />
                </circle>
              )}
            </>
          )}

          {/* Station 1: 5-Task Rollout Box (x=20..154, y=34..134) */}
          <g>
            <rect
              x="20"
              y="34"
              width="134"
              height="100"
              rx="8"
              strokeWidth="1.25"
              className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            />
            <text
              x="87"
              y="52"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {labels.rolloutTitle}
            </text>
            {/* 5 Mini Vertical Score Bars for Train 1..5 */}
            {step.scores.map((s, i) => {
              const bx = 33 + i * 23;
              const maxH = 44;
              const h = Math.max(6, Math.round((s / 100) * maxH));
              const by = 108 - h;
              const d = step.deltas[i] ?? 0;
              const barTone =
                d < 0
                  ? "fill-rose-500 dark:fill-rose-400"
                  : d > 0
                    ? "fill-brand-500 dark:fill-brand-400"
                    : "fill-gray-400 dark:fill-gray-500";
              return (
                <g key={i}>
                  <rect
                    x={bx}
                    y={64}
                    width="15"
                    height={maxH}
                    rx="2"
                    className="fill-gray-100 dark:fill-gray-800"
                  />
                  <rect x={bx} y={by} width="15" height={h} rx="2" className={barTone} />
                  <text
                    x={bx + 7.5}
                    y="122"
                    textAnchor="middle"
                    className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
                  >
                    {`T${i + 1}`}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Station 2: Adam Variance & Budget Controller (x=196..344, y=34..134) */}
          <g>
            <rect
              x="196"
              y="34"
              width="148"
              height="100"
              rx="8"
              strokeWidth="1.25"
              className="fill-white stroke-brand-300 dark:fill-gray-900 dark:stroke-brand-700"
            />
            <text
              x="270"
              y="52"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {labels.controllerTitle}
            </text>
            {/* Variance Meter Bar */}
            <text
              x="210"
              y="72"
              className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
            >
              {`Vt ${step.variance.toFixed(3)}`}
            </text>
            <rect
              x="274"
              y="63"
              width="56"
              height="9"
              rx="4.5"
              className="fill-gray-100 dark:fill-gray-800"
            />
            <rect
              x="274"
              y="63"
              width={Math.min(56, Math.max(8, Math.round((step.variance / 0.1) * 56)))}
              height="9"
              rx="4.5"
              className={
                step.variance > 0.06
                  ? "fill-amber-500 dark:fill-amber-400"
                  : "fill-brand-500 dark:fill-brand-400"
              }
            />

            {/* 4 Geometric Budget Slots B1..B4 */}
            <text
              x="210"
              y="96"
              className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
            >
              {`Bt ${step.budget}/4`}
            </text>
            {[0, 1, 2, 3].map((slot) => {
              const unlocked = slot < step.budget;
              const sx = 262 + slot * 18;
              return (
                <rect
                  key={slot}
                  x={sx}
                  y="85"
                  width="14"
                  height="14"
                  rx="3"
                  strokeWidth="1.25"
                  strokeDasharray={unlocked ? undefined : "2 2"}
                  className={
                    unlocked
                      ? "fill-brand-500 stroke-brand-600 dark:fill-brand-400 dark:stroke-brand-300"
                      : "fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-600"
                  }
                />
              );
            })}
            <text
              x="270"
              y="120"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-medium tabular-nums dark:fill-brand-300"
            >
              {labels.slotsUnit(step.budget)}
            </text>
          </g>

          {/* Station 3: Strict Mean Gate (x=386..504, y=34..134) */}
          <g>
            <rect
              x="386"
              y="34"
              width="118"
              height="100"
              rx="8"
              strokeWidth="1.5"
              className={
                isReject
                  ? "fill-rose-50/70 stroke-rose-400 dark:fill-rose-950/40 dark:stroke-rose-600"
                  : isAccept
                    ? "fill-emerald-50/70 stroke-emerald-500 dark:fill-emerald-950/40 dark:stroke-emerald-500"
                    : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
              }
            />
            <text
              x="445"
              y="52"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {labels.gateTitle}
            </text>
            <text
              x="445"
              y="76"
              textAnchor="middle"
              className="fill-gray-900 font-mono text-xs font-semibold tabular-nums dark:fill-gray-100"
            >
              {`μ = ${step.mean.toFixed(2)}`}
            </text>
            <text
              x="445"
              y="94"
              textAnchor="middle"
              className="fill-gray-500 font-mono text-xs tabular-nums dark:fill-gray-400"
            >
              {step.gate === "init"
                ? `ref = ${step.bestBefore.toFixed(2)}`
                : isReject
                  ? `< ${step.bestBefore.toFixed(2)}`
                  : `> ${step.bestBefore.toFixed(2)}`}
            </text>
            <rect
              x="398"
              y="104"
              width="94"
              height="20"
              rx="4"
              className={
                isReject
                  ? "fill-rose-600 dark:fill-rose-500"
                  : isAccept
                    ? "fill-emerald-600 dark:fill-emerald-500"
                    : "fill-gray-200 dark:fill-gray-800"
              }
            />
            <text
              x="445"
              y="118"
              textAnchor="middle"
              className={
                step.gate === "init"
                  ? "fill-gray-700 font-mono text-xs font-semibold dark:fill-gray-300"
                  : "fill-white font-mono text-xs font-semibold"
              }
            >
              {isReject ? "REJECT" : isAccept ? "ACCEPT" : "BASELINE"}
            </text>
          </g>

          {/* Station 4: SKILL.md 4-Block Matrix (x=540..660, y=34..134) */}
          <g>
            <rect
              x="540"
              y="34"
              width="120"
              height="100"
              rx="8"
              strokeWidth="1.25"
              className="fill-white stroke-brand-300 dark:fill-gray-900 dark:stroke-brand-700"
            />
            <text
              x="600"
              y="52"
              textAnchor="middle"
              className="fill-gray-900 font-mono text-xs font-semibold dark:fill-gray-100"
            >
              {step.skillVersion}
            </text>
            {step.blocks.map((status, bi) => {
              const by = 60 + bi * 16;
              const blockClass =
                status === "updated"
                  ? "fill-brand-500 stroke-brand-600 dark:fill-brand-400 dark:stroke-brand-300"
                  : status === "kept"
                    ? "fill-brand-100 stroke-brand-400 dark:fill-brand-900 dark:stroke-brand-600"
                    : status === "locked"
                      ? "fill-gray-200 stroke-gray-400 dark:fill-gray-800 dark:stroke-gray-600"
                      : status === "reverted"
                        ? "fill-rose-100 stroke-rose-400 dark:fill-rose-950 dark:stroke-rose-600"
                        : "fill-gray-50 stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700";
              return (
                <g key={bi}>
                  <rect
                    x="552"
                    y={by}
                    width="96"
                    height="12"
                    rx="2.5"
                    strokeWidth="1"
                    strokeDasharray={status === "empty" || status === "reverted" ? "2 2" : undefined}
                    className={blockClass}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Bottom Synchronized Telemetry Cards */}
      <div className="grid gap-2.5 border-t border-gray-200/80 bg-white/60 p-3.5 sm:grid-cols-3 dark:border-gray-800/80 dark:bg-gray-950/40">
        {/* Card 1: 5-Task Score Bars */}
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {labels.meanLabel}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">
              {step.mean.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {step.scores.map((score, i) => {
              const delta = step.deltas[i] ?? 0;
              return (
                <div key={i} className="grid grid-cols-[2rem_minmax(0,1fr)_4.2rem] items-center gap-1.5 text-xs">
                  <span className="font-mono text-xs text-gray-500 tabular-nums dark:text-gray-400">
                    {`T${i + 1}`}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className={`h-full rounded-full transition-[width] duration-150 ${
                        delta < 0
                          ? "bg-rose-500 dark:bg-rose-400"
                          : "bg-brand-600 dark:bg-brand-400"
                      }`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="text-right font-mono text-xs tabular-nums text-gray-700 dark:text-gray-300">
                    {score}
                    {delta !== 0 && (
                      <span
                        className={
                          delta > 0
                            ? "ml-1 text-emerald-600 dark:text-emerald-400"
                            : "ml-1 text-rose-600 dark:text-rose-400"
                        }
                      >
                        {delta > 0 ? `+${delta}` : `${delta}`}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 2: Adam Variance & 4-Slot Edit Budget */}
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {labels.budgetLabel}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {`${step.budget} / 4`}
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{labels.varLabel}</span>
              <span className="font-mono tabular-nums">{`${step.variance.toFixed(3)} / 0.100`}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className={`h-full rounded-full transition-[width] duration-150 ${
                  step.variance > 0.06
                    ? "bg-amber-500 dark:bg-amber-400"
                    : "bg-brand-500 dark:bg-brand-400"
                }`}
                style={{ width: `${Math.min(100, Math.round((step.variance / 0.1) * 100))}%` }}
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((slot) => {
              const unlocked = slot < step.budget;
              return (
                <div
                  key={slot}
                  className={`rounded-md border px-1.5 py-1 text-center font-mono text-xs tabular-nums ${
                    unlocked
                      ? "border-brand-300 bg-brand-50 font-semibold text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-300"
                      : "border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500"
                  }`}
                >
                  {`B${slot + 1}`}
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 3: Mean Gate & SKILL.md Block States */}
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {labels.skillTitle}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${
                isReject
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                  : isAccept
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {isReject ? labels.gateReject : isAccept ? labels.gateAccept : labels.gateInit}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {step.blocks.map((status, bi) => {
              const badgeText = isZh
                ? status === "updated"
                  ? "本轮更新"
                  : status === "locked"
                    ? "预算锁定"
                    : status === "reverted"
                      ? "回滚丢弃"
                      : status === "kept"
                        ? "保持不变"
                        : "待生成"
                : status === "updated"
                  ? "Updated"
                  : status === "locked"
                    ? "Locked"
                    : status === "reverted"
                      ? "Reverted"
                      : status === "kept"
                        ? "Kept"
                        : "Empty";
              const rowClass =
                status === "updated"
                  ? "text-brand-700 font-medium dark:text-brand-300"
                  : status === "reverted"
                    ? "text-rose-600 font-medium dark:text-rose-400"
                    : "text-gray-500 dark:text-gray-400";
              return (
                <div key={bi} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                    {blockNames[bi]}
                  </span>
                  <span className={`font-mono text-xs ${rowClass}`}>{badgeText}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
