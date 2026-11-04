/**
 * Progressive, open-canvas orchestration diagram for Section 4 of the GDPEVO blog post.
 *
 * Starts with the top-level General Agent on a clean canvas and progressively builds the
 * experiment topology step by step:
 *   Stage 1: General Agent spawns the 1 Shared Container for continuous training (3+2 Train pool)
 *   Stage 2: Training finishes and exports the frozen Evolved Agent (+ SKILL.md)
 *   Stage 3: 1-to-5 fan-out spawns 5 isolated test containers (x3 runs = 15 fresh containers)
 *   Stage 4: 5-to-1 convergence into Offline Verifier, reporting scores back to General Agent
 *   Stage 5: General Agent aggregates all runs and generates the Final Result report
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

interface BuildStage {
  readonly id: string;
  readonly stepZh: string;
  readonly stepEn: string;
  readonly captionZh: string;
  readonly captionEn: string;
}

const STAGES: readonly BuildStage[] = [
  {
    id: "s1",
    stepZh: "1. 构建训练",
    stepEn: "1. Train",
    captionZh: "General Agent 拉起单个共享训练容器，Target Agent 在 5 道训练题（3+2）上连续演进 SKILL.md",
    captionEn: "General Agent spawns 1 shared container; Target Agent evolves SKILL.md across Train 1-5 (3+2)",
  },
  {
    id: "s2",
    stepZh: "2. 冻结技能",
    stepEn: "2. Freeze",
    captionZh: "训练完成并锁定 SKILL.md 写入权限，导出挂载只读技能的 Evolved Agent",
    captionEn: "Training completes; SKILL.md is locked read-only to form the frozen Evolved Agent",
  },
  {
    id: "s3",
    stepZh: "3. 隔离测试",
    stepEn: "3. Test (×3)",
    captionZh: "General Agent 调度一分五并发盲测，为 Test 1–5 各自独立拉起 3 轮全新容器（共 15 个容器）",
    captionEn: "General Agent dispatches 1-to-5 isolated evaluation across Test 1-5 (3 runs each = 15 containers)",
  },
  {
    id: "s4",
    stepZh: "4. 判分汇总",
    stepEn: "4. Verify",
    captionZh: "五合一汇入 Offline Verifier 完成离线判分，并将全部测试得分回传给顶层 General Agent",
    captionEn: "5-to-1 convergence into Offline Verifier, reporting all test scores back to General Agent",
  },
  {
    id: "s5",
    stepZh: "5. 生成结果",
    stepEn: "5. Result",
    captionZh: "General Agent 汇总跨轮次均值与标准差，产出最终实验报告（68.95 ± 0.74）",
    captionEn: "General Agent aggregates multi-run mean and standard deviation into the Final Result (68.95 ± 0.74)",
  },
];

/** 3+2 coordinates for the 5 training task pills inside `1 Shared Container` (x=12..240, y=104..294). */
const TRAIN_PILLS = [
  { label: "Train 1", x: 30, y: 208, w: 58, h: 28 },
  { label: "Train 2", x: 97, y: 208, w: 58, h: 28 },
  { label: "Train 3", x: 164, y: 208, w: 58, h: 28 },
  { label: "Train 4", x: 63, y: 246, w: 58, h: 28 },
  { label: "Train 5", x: 131, y: 246, w: 58, h: 28 },
] as const;

/** Vertical center Y coordinates for the 5 stacked horizontal Isolated Containers. */
const TEST_ROWS_Y = [120, 160, 200, 240, 280] as const;

export function GdpevoOrchestrationWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  // SSR / reduced-motion starts at the completed Stage 5 view; live view starts growing from Stage 1.
  const [stageIdx, setStageIdx] = useState<number>(4);
  const [paused, setPaused] = useState<boolean>(false);
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const running = active && !reduced && !paused;

  useEffect(() => {
    if (active && !reduced && !hasStarted) {
      setHasStarted(true);
      setStageIdx(0);
    }
  }, [active, reduced, hasStarted]);

  useEffect(() => {
    if (!running) return;
    const delay = stageIdx === 4 ? 4000 : 2200;
    const timer = window.setTimeout(() => {
      setStageIdx((prev) => (prev + 1) % STAGES.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [running, stageIdx]);

  const selectStage = (idx: number) => {
    setStageIdx(idx);
    setPaused(true);
  };

  const stage = STAGES[stageIdx] ?? STAGES[4]!;
  const showStage2 = stageIdx >= 1;
  const showStage3 = stageIdx >= 2;
  const showStage4 = stageIdx >= 3;
  const showStage5 = stageIdx >= 4;

  const copy = isZh
    ? {
        play: "播放动态构建过程",
        pause: "暂停动态构建过程",
        mainAgent: "General Agent",
        mainSub: "主控编排 Agent",
        sharedContainer: "1 Shared Container",
        targetAgent: "Target Agent",
        skillDoc: "SKILL.md",
        evolvedAgent: "Evolved Agent",
        frozenBadge: "+ SKILL.md",
        isolatedLabel: "Isolated Containers",
        verifier: "Offline",
        verifierSub: "Verifier",
        resultTitle: "Final Result",
        resultSub: "68.95 ± 0.74 (+12.63)",
      }
    : {
        play: "Play progressive build",
        pause: "Pause progressive build",
        mainAgent: "General Agent",
        mainSub: "Experiment Controller",
        sharedContainer: "1 Shared Container",
        targetAgent: "Target Agent",
        skillDoc: "SKILL.md",
        evolvedAgent: "Evolved Agent",
        frozenBadge: "+ SKILL.md",
        isolatedLabel: "Isolated Containers",
        verifier: "Offline",
        verifierSub: "Verifier",
        resultTitle: "Final Result",
        resultSub: "68.95 ± 0.74 (+12.63)",
      };

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      {/* Minimal Frameless Control Strip */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Progressive stages">
          {STAGES.map((s, idx) => {
            const isCurrent = idx === stageIdx;
            const isBuilt = idx <= stageIdx;
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
                    : isBuilt
                      ? "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/70 dark:text-brand-300 dark:hover:bg-brand-900/60"
                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                }`}
              >
                {isZh ? s.stepZh : s.stepEn}
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

      {/* Live Stage Caption */}
      <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
        {isZh ? stage.captionZh : stage.captionEn}
      </p>

      {/* Open-Canvas Progressive SVG (No Outer Box, No Nested Wrapper Frames) */}
      <svg
        viewBox="0 0 720 312"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label={isZh ? stage.captionZh : stage.captionEn}
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
            x="264"
            y="8"
            width="172"
            height="48"
            rx="10"
            strokeWidth="1.5"
            className="fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
          />
          <text
            x="350"
            y="29"
            textAnchor="middle"
            className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
          >
            {copy.mainAgent}
          </text>
          <text
            x="350"
            y="45"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs dark:fill-brand-300"
          >
            {copy.mainSub}
          </text>
        </g>

        {/* ==================== STAGE 1: SHARED TRAINING CONTAINER ==================== */}
        <g>
          {/* Dispatch line from General Agent (x=296, y=56) -> 1 Shared Container (x=126, y=98) */}
          <path
            d="M296,56 L296,76 L126,76 L126,98"
            fill="none"
            strokeWidth="1.5"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#pg-arrow-brand)"
          />
          {running && stageIdx === 0 && (
            <circle r="3" className="fill-brand-500 dark:fill-brand-400">
              <animateMotion
                dur="1.4s"
                repeatCount="indefinite"
                path="M296,56 L296,76 L126,76 L126,98"
              />
            </circle>
          )}

          {/* 1 Shared Container Boundary (x=12..240, y=104..294) */}
          <rect
            x="12"
            y="104"
            width="228"
            height="190"
            rx="12"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            className={
              stageIdx === 0
                ? "fill-brand-50/30 stroke-brand-500 dark:fill-brand-950/20 dark:stroke-brand-400"
                : "fill-gray-50/60 stroke-gray-300 dark:fill-gray-900/40 dark:stroke-gray-700"
            }
          />
          <text
            x="126"
            y="124"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs font-semibold dark:fill-brand-300"
          >
            {copy.sharedContainer}
          </text>

          {/* Target Agent Node inside Shared Container (x=26..114, y=138..184) */}
          <rect
            x="26"
            y="138"
            width="88"
            height="46"
            rx="8"
            strokeWidth="1.25"
            className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
          />
          <text
            x="70"
            y="159"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {copy.targetAgent}
          </text>
          <text
            x="70"
            y="175"
            textAnchor="middle"
            className="fill-gray-500 font-mono text-xs dark:fill-gray-400"
          >
            Learner
          </text>

          {/* Clean Bidirectional Evolution Link (x=116..148) — 36px gap, zero overlap */}
          <path
            d="M116,155 L148,155"
            fill="none"
            strokeWidth="1.5"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#pg-arrow-brand)"
          />
          <path
            d="M148,168 L116,168"
            fill="none"
            strokeWidth="1.5"
            className="stroke-gray-400 dark:stroke-gray-500"
            markerEnd="url(#pg-arrow-gray)"
          />
          {running && stageIdx === 0 && (
            <circle r="2.5" className="fill-brand-500 dark:fill-brand-400">
              <animateMotion dur="1.1s" repeatCount="indefinite" path="M116,155 L148,155" />
            </circle>
          )}

          {/* Evolving SKILL.md Node inside Shared Container (x=150..226, y=138..184) */}
          <rect
            x="150"
            y="138"
            width="76"
            height="46"
            rx="8"
            strokeWidth="1.25"
            className="fill-brand-50 stroke-brand-400 dark:fill-brand-950 dark:stroke-brand-500"
          />
          <text
            x="188"
            y="159"
            textAnchor="middle"
            className="fill-brand-800 font-mono text-xs font-semibold dark:fill-brand-200"
          >
            {copy.skillDoc}
          </text>
          <text
            x="188"
            y="175"
            textAnchor="middle"
            className="fill-brand-700 font-mono text-xs tabular-nums dark:fill-brand-300"
          >
            v0 → v2
          </text>

          {/* 3+2 Training Task Pills directly on container floor (no extra wrapper box) */}
          {TRAIN_PILLS.map((pill, i) => (
            <g key={pill.label}>
              <rect
                x={pill.x}
                y={pill.y}
                width={pill.w}
                height={pill.h}
                rx="6"
                strokeWidth="1.25"
                className={
                  stageIdx === 0
                    ? "fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-500"
                    : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                }
              />
              <text
                x={pill.x + pill.w / 2}
                y={pill.y + 18}
                textAnchor="middle"
                className="fill-gray-800 font-mono text-xs font-medium tabular-nums dark:fill-gray-200"
              >
                {`Train ${i + 1}`}
              </text>
            </g>
          ))}
        </g>

        {/* ==================== STAGE 2: FROZEN EVOLVED AGENT ==================== */}
        {showStage2 && (
          <g className="anim-block">
            {/* Export arrow from 1 Shared Container (x=240, y=200) -> Evolved Agent (x=268, y=200) */}
            <path
              d="M240,200 L266,200"
              fill="none"
              strokeWidth="1.75"
              className="stroke-brand-500 dark:stroke-brand-400"
              markerEnd="url(#pg-arrow-brand)"
            />
            {running && stageIdx === 1 && (
              <circle r="3" className="fill-brand-500 dark:fill-brand-400">
                <animateMotion dur="1s" repeatCount="indefinite" path="M240,200 L266,200" />
              </circle>
            )}

            {/* Evolved Agent (+ Frozen SKILL.md) Node (x=268..384, y=160..240) */}
            <rect
              x="268"
              y="160"
              width="116"
              height="80"
              rx="10"
              strokeWidth="1.5"
              className="fill-brand-50 stroke-brand-500 dark:fill-brand-950 dark:stroke-brand-400"
            />
            <text
              x="326"
              y="188"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {copy.evolvedAgent}
            </text>
            <text
              x="326"
              y="207"
              textAnchor="middle"
              className="fill-brand-700 font-mono text-xs font-medium dark:fill-brand-300"
            >
              {copy.frozenBadge}
            </text>
            <rect
              x="294"
              y="216"
              width="64"
              height="16"
              rx="4"
              className="fill-brand-600 dark:fill-brand-500"
            />
            <text
              x="326"
              y="227"
              textAnchor="middle"
              className="fill-white font-mono text-xs font-semibold"
            >
              FROZEN
            </text>
          </g>
        )}

        {/* ==================== STAGE 3: 1-TO-5 ISOLATED TEST CONTAINERS ==================== */}
        {showStage3 && (
          <g className="anim-block">
            {/* Dispatch line from General Agent (x=350, y=56) -> Test Cluster header (x=504, y=86) */}
            <path
              d="M350,56 L350,78 L504,78 L504,88"
              fill="none"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              className="stroke-brand-400 dark:stroke-brand-500"
              markerEnd="url(#pg-arrow-brand)"
            />

            <text
              x="504"
              y="100"
              textAnchor="middle"
              className="fill-gray-600 font-mono text-xs font-medium dark:fill-gray-400"
            >
              {copy.isolatedLabel}
            </text>

            {/* 1-to-5 Orthogonal Fork Tree (x=384..424, y=120..280) */}
            <path
              d="M384,200 L404,200 M404,120 L404,280"
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

            {running && stageIdx === 2 && (
              <>
                {TEST_ROWS_Y.map((ry, idx) => (
                  <circle
                    key={`p-fork-${idx}`}
                    r="2.75"
                    className="fill-brand-500 dark:fill-brand-400"
                  >
                    <animateMotion
                      dur="1.5s"
                      begin={`${idx * 0.12}s`}
                      repeatCount="indefinite"
                      path={`M384,200 L404,200 L404,${ry} L422,${ry}`}
                    />
                  </circle>
                ))}
              </>
            )}

            {/* 5 Vertically Stacked Horizontal Isolated Containers (x=424..584, h=28) */}
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
                  {/* 3 Fresh Container Run Pills */}
                  {[0, 1, 2].map((r) => (
                    <rect
                      key={r}
                      x={526 + r * 16}
                      y={ry - 6}
                      width="12"
                      height="12"
                      rx="2.5"
                      className="fill-brand-500 dark:fill-brand-400"
                    />
                  ))}
                </g>
              );
            })}
          </g>
        )}

        {/* ==================== STAGE 4: OFFLINE VERIFIER -> GENERAL AGENT ==================== */}
        {showStage4 && (
          <g className="anim-block">
            {/* 5-to-1 Collector Tree (x=584..622, y=120..280 -> y=200) */}
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
              d="M602,120 L602,280 M602,200 L620,200"
              fill="none"
              strokeWidth="1.5"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />

            {/* Offline Verifier Node (x=622..712, y=168..232) */}
            <rect
              x="622"
              y="168"
              width="90"
              height="64"
              rx="8"
              strokeWidth="1.5"
              className="fill-white stroke-emerald-600 dark:fill-gray-900 dark:stroke-emerald-400"
            />
            <text
              x="667"
              y="195"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {copy.verifier}
            </text>
            <text
              x="667"
              y="213"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {copy.verifierSub}
            </text>

            {/* Zero-crossing Return Path: Offline Verifier (667,168) -> up to y=66 -> left to (412,66) -> General Agent (412,56) */}
            <path
              d="M667,168 L667,66 L412,66 L412,58"
              fill="none"
              strokeWidth="1.5"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />

            {running && stageIdx === 3 && (
              <>
                {TEST_ROWS_Y.map((ry, idx) => (
                  <circle
                    key={`p-join-${idx}`}
                    r="2.75"
                    className="fill-emerald-500 dark:fill-emerald-400"
                  >
                    <animateMotion
                      dur="1.4s"
                      begin={`${idx * 0.1}s`}
                      repeatCount="indefinite"
                      path={`M584,${ry} L602,${ry} L602,200 L620,200`}
                    />
                  </circle>
                ))}
                <circle r="3" className="fill-emerald-500 dark:fill-emerald-400">
                  <animateMotion
                    dur="1.6s"
                    repeatCount="indefinite"
                    path="M667,168 L667,66 L412,66 L412,58"
                  />
                </circle>
              </>
            )}
          </g>
        )}

        {/* ==================== STAGE 5: GENERAL AGENT -> FINAL RESULT ==================== */}
        {showStage5 && (
          <g className="anim-block">
            <path
              d="M436,32 L546,32"
              fill="none"
              strokeWidth="1.75"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              markerEnd="url(#pg-arrow-emerald)"
            />
            {running && stageIdx === 4 && (
              <circle r="3" className="fill-emerald-500 dark:fill-emerald-400">
                <animateMotion dur="1.2s" repeatCount="indefinite" path="M436,32 L546,32" />
              </circle>
            )}

            {/* Final Result Node at Top Right (x=548..712, y=8..56) */}
            <rect
              x="548"
              y="8"
              width="164"
              height="48"
              rx="10"
              strokeWidth="1.5"
              className="fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/70 dark:stroke-emerald-400"
            />
            <text
              x="630"
              y="28"
              textAnchor="middle"
              className="fill-emerald-900 text-xs font-semibold dark:fill-emerald-100"
            >
              {copy.resultTitle}
            </text>
            <text
              x="630"
              y="45"
              textAnchor="middle"
              className="fill-emerald-700 font-mono text-xs font-semibold tabular-nums dark:fill-emerald-300"
            >
              {copy.resultSub}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
