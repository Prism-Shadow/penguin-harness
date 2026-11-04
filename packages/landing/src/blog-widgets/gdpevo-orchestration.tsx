/**
 * Interactive kinetic diagram for Section 4 of the GDPEVO blog post:
 * visualizes how the PenguinHarness Controller orchestrates the end-to-end experiment across
 * Harbor Docker containers — contrasting the 1 Shared Container in the Training Phase (with the
 * 3+2 training task pool) against the 1-to-5 fork into 5 vertically stacked Isolated Containers
 * (x3 runs = 15 fresh containers) and 5-to-1 join into the Offline Verifier in the Testing Phase.
 *
 * Self-contained under `src/blog-widgets/` so blog-specific interactive visuals stay modular.
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

interface OrchestrationPhase {
  readonly id: string;
  readonly tagZh: string;
  readonly tagEn: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly detailZh: string;
  readonly detailEn: string;
  readonly activeTrainTasks: number;
  readonly skillState: "evolving" | "frozen";
  readonly completedRuns: 0 | 1 | 3;
  readonly activeRun: 0 | 1 | 2 | 3;
  readonly verified: boolean;
}

const PHASES: readonly OrchestrationPhase[] = [
  {
    id: "p1",
    tagZh: "1. 单容器训练",
    tagEn: "1. Shared Train",
    titleZh: "单容器连续试错与技能演进（1 Shared Container）",
    titleEn: "Continuous rollout & skill evolution inside 1 Shared Container",
    detailZh: "Base Agent 在同一个持久化容器内依次完成 Train 1–5（3+2 题池），多轮迭代改写 SKILL.md。",
    detailEn: "Base Agent runs Train 1-5 (3+2 pool) inside one persistent container, iteratively refining SKILL.md.",
    activeTrainTasks: 5,
    skillState: "evolving",
    completedRuns: 0,
    activeRun: 0,
    verified: false,
  },
  {
    id: "p2",
    tagZh: "2. 冻结导出",
    tagEn: "2. Freeze Skill",
    titleZh: "导出并冻结演化技能（Evolved Agent + SKILL.md）",
    titleEn: "Export and freeze evolved SKILL.md artifact",
    detailZh: "训练结束后关闭写入权限，将最终版 SKILL.md 从共享训练容器导出，作为测试阶段的只读输入。",
    detailEn: "Locks write permissions after training and exports the final SKILL.md as a read-only artifact.",
    activeTrainTasks: 5,
    skillState: "frozen",
    completedRuns: 0,
    activeRun: 0,
    verified: false,
  },
  {
    id: "p3",
    tagZh: "3. 隔离盲测 R1",
    tagEn: "3. Eval Run 1",
    titleZh: "一分五并发注入独立测试容器（Run 1 / 3）",
    titleEn: "1-to-5 fan-out into isolated test containers (Run 1 / 3)",
    detailZh: "针对 Test 1–5 分别拉起全新的 Harbor Docker 容器，挂载只读 SKILL.md 独立作答。",
    detailEn: "Spawns 5 fresh Harbor Docker containers for Test 1-5 with the frozen SKILL.md mounted read-only.",
    activeTrainTasks: 5,
    skillState: "frozen",
    completedRuns: 1,
    activeRun: 1,
    verified: false,
  },
  {
    id: "p4",
    tagZh: "4. 容器重置 R2–R3",
    tagEn: "4. Runs 2-3",
    titleZh: "销毁重建完成 3 轮独立重复盲测（5 × 3 = 15 容器）",
    titleEn: "Container teardown & fresh spawn across Runs 2-3 (15 containers)",
    detailZh: "每道题的每一轮均在全新容器内从零执行，彻底阻断跨题与跨轮状态残留。",
    detailEn: "Every task-run pair executes in a fresh container from scratch, preventing cross-run memory leakage.",
    activeTrainTasks: 5,
    skillState: "frozen",
    completedRuns: 3,
    activeRun: 3,
    verified: false,
  },
  {
    id: "p5",
    tagZh: "5. 五合一判分",
    tagEn: "5. Verifier",
    titleZh: "五合一汇入 Offline Verifier 离线判分汇总",
    titleEn: "5-to-1 convergence into Offline Verifier",
    detailZh: "容器内零评分反馈泄漏；测试产物统一由外部 Offline Verifier 校验，汇总 3 轮均值与标准差。",
    detailEn: "Zero in-container score leakage; outputs converge into the external Offline Verifier for μ ± s scoring.",
    activeTrainTasks: 5,
    skillState: "frozen",
    completedRuns: 3,
    activeRun: 3,
    verified: true,
  },
];

const PHASE_MS = 3600;

/** 3+2 coordinates for the 5 training task cards inside `1 Shared Container`. */
const TRAIN_CARDS = [
  { label: "Train 1", x: 124, y: 88, w: 28, h: 32 },
  { label: "Train 2", x: 155, y: 88, w: 28, h: 32 },
  { label: "Train 3", x: 186, y: 88, w: 28, h: 32 },
  { label: "Train 4", x: 139, y: 128, w: 28, h: 32 },
  { label: "Train 5", x: 171, y: 128, w: 28, h: 32 },
] as const;

/** Vertical center Y coordinates for the 5 stacked horizontal Isolated Containers. */
const TEST_LANES_Y = [62, 102, 142, 182, 222] as const;

export function GdpevoOrchestrationWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  const [phaseIdx, setPhaseIdx] = useState<number>(2);
  const [paused, setPaused] = useState<boolean>(false);

  const phase = PHASES[phaseIdx] ?? PHASES[0]!;
  const running = active && !reduced && !paused;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setPhaseIdx((prev) => (prev + 1) % PHASES.length);
    }, PHASE_MS);
    return () => window.clearTimeout(timer);
  }, [running, phaseIdx]);

  const selectPhase = (next: number) => {
    setPhaseIdx(next);
    setPaused(true);
  };

  const inTrain = phaseIdx === 0;
  const inFreeze = phaseIdx === 1;
  const inEval = phaseIdx >= 2;
  const inVerify = phaseIdx === 4;

  const text = isZh
    ? {
        play: "播放实验编排动画",
        pause: "暂停实验编排动画",
        controllerBadge: "PenguinHarness Controller 自动编排",
        trainHeader: "Training Phase",
        trainSub: "1 Shared Container",
        testHeader: "Testing Phase",
        testSub: "Isolated Containers",
        baseAgent: "Base Agent",
        noSkill: "(No Skill)",
        evolvedAgent: "Evolved Agent",
        plusSkill: "(+ SKILL.md)",
        verifier: "Offline",
        verifierSub: "Verifier",
        card1Title: "训练阶段容器拓扑",
        card1Val: "1 个共享容器",
        card1Note: "Train 1–5 顺序执行，状态与 SKILL.md 在同容器内连续累积",
        card2Title: "技能冻结交接",
        card2Val: "只读 SKILL.md",
        card2Note: "训练结束即锁定写入权限，杜绝测试期隐式自改",
        card3Title: "测试阶段容器拓扑",
        card3Val: "5 题 × 3 轮 = 15 容器",
        card3Note: "每题每轮拉起全新独立容器，零评分泄漏",
      }
    : {
        play: "Play orchestration flow",
        pause: "Pause orchestration flow",
        controllerBadge: "PenguinHarness Controller Orchestration",
        trainHeader: "Training Phase",
        trainSub: "1 Shared Container",
        testHeader: "Testing Phase",
        testSub: "Isolated Containers",
        baseAgent: "Base Agent",
        noSkill: "(No Skill)",
        evolvedAgent: "Evolved Agent",
        plusSkill: "(+ SKILL.md)",
        verifier: "Offline",
        verifierSub: "Verifier",
        card1Title: "Training Topology",
        card1Val: "1 Shared Container",
        card1Note: "Train 1-5 run sequentially; state and SKILL.md accumulate in-place",
        card2Title: "Artifact Handoff",
        card2Val: "Frozen SKILL.md",
        card2Note: "Locked read-only after training; zero test-time self-modification",
        card3Title: "Testing Topology",
        card3Val: "5 Tasks × 3 Runs = 15 Fresh",
        card3Note: "Fresh isolated container per task-run pair; zero score leakage",
      };

  return (
    <div
      ref={ref}
      className="my-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
    >
      {/* Top Bar: Controller Status + 5 Phase Stepper Pills + Playback Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2.5 py-1 font-mono text-xs font-medium text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {text.controllerBadge}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Experiment phases">
            {PHASES.map((p, idx) => {
              const selected = idx === phaseIdx;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectPhase(idx)}
                  className={`rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                    selected
                      ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  }`}
                >
                  {isZh ? p.tagZh : p.tagEn}
                </button>
              );
            })}
          </div>
          <SitePlaybackButton
            paused={paused}
            onPausedChange={setPaused}
            labels={{ play: text.play, pause: text.pause }}
          />
        </div>
      </div>

      {/* Phase Headline Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200/80 px-4 py-2 text-xs dark:border-gray-800/80">
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {isZh ? phase.titleZh : phase.titleEn}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isZh ? phase.detailZh : phase.detailEn}
        </span>
      </div>

      {/* Main Two-Stage Kinetic Topology SVG */}
      <div className="px-2.5 pt-3 pb-1.5 sm:px-4">
        <svg
          viewBox="0 0 680 256"
          className="block w-full select-none"
          role="img"
          aria-label={isZh ? phase.titleZh : phase.titleEn}
        >
          <defs>
            <marker
              id="orch-arrow-gray"
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
              id="orch-arrow-brand"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 Z" className="fill-brand-600 dark:fill-brand-400" />
            </marker>
            <marker
              id="orch-arrow-emerald"
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

          {/* ==================== LEFT PANEL: TRAINING PHASE ==================== */}
          <rect
            x="6"
            y="8"
            width="314"
            height="240"
            rx="12"
            strokeWidth="1.25"
            className={
              inTrain || inFreeze
                ? "fill-brand-50/40 stroke-brand-300 dark:fill-brand-950/20 dark:stroke-brand-800"
                : "fill-white/60 stroke-gray-200 dark:fill-gray-950/40 dark:stroke-gray-800"
            }
          />
          <text
            x="163"
            y="27"
            textAnchor="middle"
            className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
          >
            {text.trainHeader}
          </text>

          {/* 1 Shared Container Box (x=14..226, y=38..236) with clear inner padding */}
          <rect
            x="14"
            y="38"
            width="212"
            height="198"
            rx="10"
            strokeWidth="1.5"
            strokeDasharray="5 3"
            className={
              inTrain
                ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white/90 stroke-gray-300 dark:fill-gray-900/80 dark:stroke-gray-700"
            }
          />
          <text
            x="120"
            y="55"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            {text.trainSub}
          </text>

          {/* Base Agent (No Skill) inside Shared Container (x=22..98, y=94..156) */}
          <rect
            x="22"
            y="94"
            width="76"
            height="62"
            rx="7"
            strokeWidth="1.25"
            className="fill-gray-50 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-600"
          />
          <text
            x="60"
            y="120"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {text.baseAgent}
          </text>
          <text
            x="60"
            y="138"
            textAnchor="middle"
            className="fill-gray-500 font-mono text-xs dark:fill-gray-400"
          >
            {text.noSkill}
          </text>

          {/* Loop Ring between Base Agent and 3+2 Train Pool */}
          <path
            d="M98,116 C108,108 108,108 118,114"
            fill="none"
            strokeWidth="1.25"
            className="stroke-brand-500 dark:stroke-brand-400"
          />
          <path
            d="M118,136 C108,142 108,142 98,134"
            fill="none"
            strokeWidth="1.25"
            className="stroke-brand-500 dark:stroke-brand-400"
          />
          <circle
            cx="108"
            cy="125"
            r="6.5"
            strokeWidth="1.25"
            className={
              inTrain
                ? "fill-brand-50 stroke-brand-600 dark:fill-brand-950 dark:stroke-brand-400"
                : "fill-gray-50 stroke-gray-400 dark:fill-gray-800 dark:stroke-gray-500"
            }
          />
          <path
            d="M105,125 A3,3 0 1,1 111,125"
            fill="none"
            strokeWidth="1.25"
            className="stroke-brand-600 dark:stroke-brand-300"
          />

          {/* 3+2 Train Task Pool Inner Frame (x=118..219, y=72..176) — well inside x=226 container edge */}
          <rect
            x="118"
            y="72"
            width="101"
            height="104"
            rx="7"
            strokeWidth="1"
            className="fill-gray-50/90 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
          />
          {TRAIN_CARDS.map((card, i) => {
            const lit = i < phase.activeTrainTasks;
            return (
              <g key={card.label}>
                <rect
                  x={card.x}
                  y={card.y}
                  width={card.w}
                  height={card.h}
                  rx="4"
                  strokeWidth="1.2"
                  className={
                    lit && inTrain
                      ? "fill-brand-50 stroke-brand-500 dark:fill-brand-950 dark:stroke-brand-400"
                      : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-600"
                  }
                />
                <text
                  x={card.x + card.w / 2}
                  y={card.y + 19}
                  textAnchor="middle"
                  className="fill-gray-800 font-mono text-xs font-semibold tabular-nums dark:fill-gray-200"
                >
                  {`T${i + 1}`}
                </text>
              </g>
            );
          })}
          <text
            x="168"
            y="196"
            textAnchor="middle"
            className="fill-gray-500 font-mono text-xs dark:fill-gray-400"
          >
            Train 1-5 (3+2)
          </text>

          {/* Arrow from 1 Shared Container (x=226) -> Evolved Agent (x=236) */}
          <path
            d="M226,142 L236,142"
            fill="none"
            strokeWidth="1.75"
            className="stroke-brand-600 dark:stroke-brand-400"
          />

          {/* Evolved Agent (+ SKILL.md) Card outside Shared Container (x=236..312, y=94..190) */}
          <rect
            x="236"
            y="94"
            width="76"
            height="96"
            rx="8"
            strokeWidth="1.5"
            className={
              phase.skillState === "frozen"
                ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
                : "fill-brand-50 stroke-brand-500 dark:fill-brand-950 dark:stroke-brand-400"
            }
          />
          <text
            x="274"
            y="120"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            Evolved
          </text>
          <text
            x="274"
            y="136"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            Agent
          </text>
          <text
            x="274"
            y="154"
            textAnchor="middle"
            className="fill-emerald-700 font-mono text-xs font-medium dark:fill-emerald-300"
          >
            SKILL.md
          </text>
          <rect
            x="248"
            y="164"
            width="52"
            height="16"
            rx="3"
            className={
              phase.skillState === "frozen"
                ? "fill-emerald-600 dark:fill-emerald-500"
                : "fill-brand-600 dark:fill-brand-500"
            }
          />
          <text
            x="274"
            y="175"
            textAnchor="middle"
            className="fill-white font-mono text-xs font-semibold"
          >
            {phase.skillState === "frozen" ? "FROZEN" : "ACTIVE"}
          </text>

          {/* ==================== RIGHT PANEL: TESTING PHASE ==================== */}
          <rect
            x="328"
            y="8"
            width="346"
            height="240"
            rx="12"
            strokeWidth="1.25"
            className={
              inEval
                ? "fill-brand-50/30 stroke-brand-300 dark:fill-brand-950/20 dark:stroke-brand-800"
                : "fill-white/60 stroke-gray-200 dark:fill-gray-950/40 dark:stroke-gray-800"
            }
          />
          <text
            x="501"
            y="27"
            textAnchor="middle"
            className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
          >
            {text.testHeader}
          </text>
          <text
            x="456"
            y="42"
            textAnchor="middle"
            className="fill-gray-500 font-mono text-xs dark:fill-gray-400"
          >
            {text.testSub}
          </text>

          {/* 1-to-5 Clean Orthogonal Fork Tree (from x=312, y=142 to x=358, y=62..222) */}
          <path
            d="M312,142 L338,142 M338,62 L338,222"
            fill="none"
            strokeWidth="1.5"
            className={
              inEval
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-400 dark:stroke-gray-600"
            }
          />
          {TEST_LANES_Y.map((ly, idx) => (
            <path
              key={`fork-${idx}`}
              d={`M338,${ly} L356,${ly}`}
              fill="none"
              strokeWidth="1.5"
              className={
                inEval
                  ? "stroke-brand-500 dark:stroke-brand-400"
                  : "stroke-gray-400 dark:stroke-gray-600"
              }
              markerEnd={inEval ? "url(#orch-arrow-brand)" : "url(#orch-arrow-gray)"}
            />
          ))}

          {/* 5 Vertically Stacked Horizontal Isolated Containers (x=358..556, height=28) */}
          {TEST_LANES_Y.map((ly, idx) => {
            const boxY = ly - 14;
            return (
              <g key={`container-${idx}`}>
                <rect
                  x="358"
                  y={boxY}
                  width="198"
                  height="28"
                  rx="6"
                  strokeWidth="1.25"
                  className={
                    inEval
                      ? "fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
                      : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                  }
                />
                {/* Container Agent Label */}
                <text
                  x="368"
                  y={ly + 4}
                  className="fill-gray-800 text-xs font-medium dark:fill-gray-200"
                >
                  Evolved Agent
                </text>
                {/* Divider */}
                <line
                  x1="452"
                  y1={boxY + 5}
                  x2="452"
                  y2={boxY + 23}
                  strokeWidth="1"
                  className="stroke-gray-200 dark:stroke-gray-700"
                />
                {/* Test Task ID */}
                <text
                  x="478"
                  y={ly + 4}
                  textAnchor="middle"
                  className="fill-brand-700 font-mono text-xs font-semibold tabular-nums dark:fill-brand-300"
                >
                  {`Test ${idx + 1}`}
                </text>
                {/* 3 Run Indicator Cells (R1, R2, R3) inside the right end of each row */}
                {[1, 2, 3].map((rNum) => {
                  const done = phase.completedRuns >= rNum;
                  const rx = 506 + (rNum - 1) * 15;
                  return (
                    <rect
                      key={rNum}
                      x={rx}
                      y={ly - 7}
                      width="12"
                      height="14"
                      rx="2.5"
                      className={
                        done
                          ? "fill-emerald-500 dark:fill-emerald-400"
                          : "fill-gray-100 dark:fill-gray-800"
                      }
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 5-to-1 Clean Orthogonal Join Tree (from x=556, y=62..222 to x=590, y=142) */}
          {TEST_LANES_Y.map((ly, idx) => (
            <path
              key={`join-${idx}`}
              d={`M556,${ly} L572,${ly}`}
              fill="none"
              strokeWidth="1.5"
              className={
                inVerify
                  ? "stroke-emerald-600 dark:stroke-emerald-400"
                  : "stroke-gray-400 dark:stroke-gray-600"
              }
            />
          ))}
          <path
            d="M572,62 L572,222 M572,142 L588,142"
            fill="none"
            strokeWidth="1.5"
            className={
              inVerify
                ? "stroke-emerald-600 dark:stroke-emerald-400"
                : "stroke-gray-400 dark:stroke-gray-600"
            }
            markerEnd={inVerify ? "url(#orch-arrow-emerald)" : "url(#orch-arrow-gray)"}
          />

          {/* Offline Verifier Node (x=590..666, y=98..186) */}
          <rect
            x="590"
            y="98"
            width="76"
            height="88"
            rx="8"
            strokeWidth="1.5"
            className={
              inVerify
                ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="628"
            y="124"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {text.verifier}
          </text>
          <text
            x="628"
            y="140"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {text.verifierSub}
          </text>
          <text
            x="628"
            y="164"
            textAnchor="middle"
            className={
              inVerify
                ? "fill-emerald-700 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-300"
                : "fill-gray-400 font-mono text-xs tabular-nums dark:fill-gray-500"
            }
          >
            {inVerify ? "68.95±0.74" : "μ ± s"}
          </text>

          {/* Animated Pulses */}
          {running && inTrain && (
            <circle r="3" className="fill-brand-500 dark:fill-brand-400">
              <animateMotion
                dur="1.8s"
                repeatCount="indefinite"
                path="M98,116 L118,114 L118,136 L98,134 Z"
              />
            </circle>
          )}
          {running && inFreeze && (
            <circle r="3.2" className="fill-emerald-500 dark:fill-emerald-400">
              <animateMotion dur="1.2s" repeatCount="indefinite" path="M218,142 L236,142" />
            </circle>
          )}
          {running && inEval && !inVerify && (
            <>
              {TEST_LANES_Y.map((ly, idx) => (
                <circle
                  key={`pulse-fork-${idx}`}
                  r="2.75"
                  className="fill-brand-500 dark:fill-brand-400"
                >
                  <animateMotion
                    dur="1.6s"
                    begin={`${idx * 0.12}s`}
                    repeatCount="indefinite"
                    path={`M312,142 L338,142 L338,${ly} L356,${ly}`}
                  />
                </circle>
              ))}
            </>
          )}
          {running && inVerify && (
            <>
              {TEST_LANES_Y.map((ly, idx) => (
                <circle
                  key={`pulse-join-${idx}`}
                  r="2.75"
                  className="fill-emerald-500 dark:fill-emerald-400"
                >
                  <animateMotion
                    dur="1.5s"
                    begin={`${idx * 0.1}s`}
                    repeatCount="indefinite"
                    path={`M556,${ly} L572,${ly} L572,142 L588,142`}
                  />
                </circle>
              ))}
            </>
          )}
        </svg>
      </div>

      {/* Compact 1-Line Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200/80 bg-white px-4 py-2 text-xs dark:border-gray-800/80 dark:bg-gray-950">
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {text.card1Title}: <strong className="font-semibold text-brand-700 dark:text-brand-300">{text.card1Val}</strong>
        </span>
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {text.card2Title}: <strong className="font-semibold text-emerald-700 dark:text-emerald-300">{text.card2Val}</strong>
        </span>
        <span className="font-mono text-xs text-gray-600 tabular-nums dark:text-gray-400">
          {text.card3Title}: <strong className="font-semibold text-gray-900 dark:text-gray-100">{text.card3Val}</strong>
        </span>
      </div>
    </div>
  );
}
