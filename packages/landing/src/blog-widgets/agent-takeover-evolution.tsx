/**
 * Progressive 3-Stage Evolution Diagram for the Super-agent blog post (`data-widget="agent-takeover-evolution"`).
 *
 * Illustrates how successive layers of Agent systems progressively absorb human responsibilities:
 *   Stage 1 (Col 1, x = 8..224):   `1. 传统单任务 Agent` / `1. Manual Workbench`
 *                                  Agent only writes code & runs tests; human still handles
 *                                  feedback triage, multi-window dispatch, runtime babysitting,
 *                                  and evaluation/tuning.
 *   Stage 2 (Col 2, x = 252..468): `2. Super-agent 运行时接管` / `2. Runtime Takeover`
 *                                  Event-driven triggers, Two-Tier Router, and Watchdog Agent
 *                                  take over runtime triage, window dispatch, and babysitting.
 *   Stage 3 (Col 3, x = 496..712): `3. PenguinHarness 自进化` / `3. Self-Evolution`
 *                                  Autonomous benchmark execution, trace diagnosis, and prompt/Skill
 *                                  refinement absorb the evaluation and tuning loop too.
 */
import { useEffect, useState } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

interface StageTab {
  readonly id: string;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly startTick: number;
  readonly endTick: number;
}

const STAGE_TABS: readonly StageTab[] = [
  {
    id: "manual",
    labelZh: "1. 传统单任务 Agent",
    labelEn: "1. Manual Workbench",
    startTick: 0,
    endTick: 3,
  },
  {
    id: "runtime",
    labelZh: "2. Super-agent 接管运行",
    labelEn: "2. Runtime Takeover",
    startTick: 4,
    endTick: 8,
  },
  {
    id: "evolve",
    labelZh: "3. PenguinHarness 自进化",
    labelEn: "3. Self-Evolution",
    startTick: 9,
    endTick: 12,
  },
];

const TOTAL_TICKS = 13;

function tickDelayMs(tick: number): number {
  if (tick === 3 || tick === 8) return 1300;
  if (tick === 12) return 2600;
  return 720;
}

interface LayerRow {
  readonly key: string;
  readonly zh: string;
  readonly en: string;
  readonly agentByZh: readonly [string, string, string];
  readonly agentByEn: readonly [string, string, string];
  readonly isAgent: readonly [boolean, boolean, boolean];
}

const LAYER_ROWS: readonly LayerRow[] = [
  {
    key: "eval",
    zh: "评测与调优迭代",
    en: "Eval & Prompt/Skill Tuning",
    agentByZh: ["人工跑分改提示词", "人工评测调优", "PenguinHarness"],
    agentByEn: ["Human Manual Tuning", "Human Manual Tuning", "PenguinHarness"],
    isAgent: [false, false, true],
  },
  {
    key: "watchdog",
    zh: "异常排查与死循环恢复",
    en: "Loop & Drift Recovery",
    agentByZh: ["开发盯日志叫停", "Watchdog Agent", "Watchdog Agent"],
    agentByEn: ["Dev Log Babysitting", "Watchdog Agent", "Watchdog Agent"],
    isAgent: [false, true, true],
  },
  {
    key: "router",
    zh: "多窗口上下文与分派",
    en: "Multi-Session Dispatch",
    agentByZh: ["人工切窗口发指令", "双层架构 Router", "双层架构 Router"],
    agentByEn: ["Human Window Switching", "Two-Tier Router", "Two-Tier Router"],
    isAgent: [false, true, true],
  },
  {
    key: "event",
    zh: "群聊反馈过滤与复现",
    en: "Feedback Triage & Repro",
    agentByZh: ["产品测试人工筛选", "事件驱动静默复现", "事件驱动静默复现"],
    agentByEn: ["PM & QA Manual Triage", "Event-Driven Trigger", "Event-Driven Trigger"],
    isAgent: [false, true, true],
  },
  {
    key: "worker",
    zh: "单任务写代码与跑测试",
    en: "Single-Task Code & Test",
    agentByZh: ["Coding Agent", "Worker Agent", "Worker Agent"],
    agentByEn: ["Coding Agent", "Worker Agent", "Worker Agent"],
    isAgent: [true, true, true],
  },
];

export function AgentTakeoverEvolutionWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  const [tick, setTick] = useState<number>(12);
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

  const isS0 = activeStageIdx === 0;
  const isS1 = activeStageIdx === 1;
  const isS2 = activeStageIdx === 2;

  const reachedS1 = tick >= 4;
  const reachedS2 = tick >= 9;

  const copy = isZh
    ? {
        play: "播放接管演进",
        pause: "暂停接管演进",
        colTitles: [
          "阶段一：单任务辅助工具",
          "阶段二：Super-agent 运行接管",
          "阶段三：PenguinHarness 自进化",
        ] as const,
        colFooters: [
          "人类负责 4 层调度与维护",
          "接管运行期发指令、管窗口与盯异常",
          "进一步接管评测、看日志与改提示词",
        ] as const,
        humanTag: "人负责",
        agentTag: "Agent 接管",
      }
    : {
        play: "Play takeover evolution",
        pause: "Pause takeover evolution",
        colTitles: [
          "Stage 1: Single-Task Tool",
          "Stage 2: Super-agent Runtime",
          "Stage 3: PenguinHarness Evolution",
        ] as const,
        colFooters: [
          "Humans still handle 4 upper layers",
          "Takes over runtime triage, routing & ops",
          "Takes over evaluation, trace audit & tuning",
        ] as const,
        humanTag: "Human",
        agentTag: "Agent",
      };

  const cols = [
    { idx: 0 as const, x: 8, active: isS0, reached: true },
    { idx: 1 as const, x: 252, active: isS1, reached: reachedS1 },
    { idx: 2 as const, x: 496, active: isS2, reached: reachedS2 },
  ];

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Agent takeover evolution stages"
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

      <svg
        viewBox="0 0 720 264"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label="Progressive takeover of human workflow layers by Agent systems"
      >
        <defs>
          <marker
            id="sa-evo-arrow-brand"
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
            id="sa-evo-arrow-gray"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 Z" className="fill-gray-400 dark:fill-gray-500" />
          </marker>
        </defs>

        {cols.map((col) => {
          const cx = col.x + 108;
          return (
            <g
              key={col.idx}
              style={{ opacity: col.reached ? 1 : 0.24 }}
              className="transition-opacity duration-200"
            >
              {col.idx > 0 && (
                <path
                  d={`M${col.x - 28},132 L${col.x - 2},132`}
                  fill="none"
                  strokeWidth={col.active ? "2" : "1.5"}
                  className={
                    col.active
                      ? "stroke-brand-600 dark:stroke-brand-400"
                      : "stroke-gray-300 dark:stroke-gray-600"
                  }
                  markerEnd={col.active ? "url(#sa-evo-arrow-brand)" : "url(#sa-evo-arrow-gray)"}
                />
              )}

              <rect
                x={col.x}
                y="10"
                width="216"
                height="244"
                rx="10"
                strokeWidth={col.active ? "2" : "1.5"}
                className={
                  col.active
                    ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                    : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
                }
              />

              <text
                x={cx}
                y="31"
                textAnchor="middle"
                className={
                  col.active
                    ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                    : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
                }
              >
                {copy.colTitles[col.idx]}
              </text>

              {LAYER_ROWS.map((row, rIdx) => {
                const ry = 44 + rIdx * 36;
                const takenOver = row.isAgent[col.idx];
                const newlyTakenOver =
                  (col.idx === 1 && rIdx >= 1 && rIdx <= 3) || (col.idx === 2 && rIdx === 0);
                const roleLabel = isZh ? row.agentByZh[col.idx] : row.agentByEn[col.idx];

                return (
                  <g key={row.key}>
                    <rect
                      x={col.x + 12}
                      y={ry}
                      width="192"
                      height="30"
                      rx="6"
                      strokeWidth={newlyTakenOver && col.active ? "1.5" : "1"}
                      className={
                        takenOver
                          ? newlyTakenOver && col.active
                            ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/60 dark:stroke-emerald-400"
                            : "fill-brand-50/80 stroke-brand-300 dark:fill-brand-950/50 dark:stroke-brand-700"
                          : "fill-gray-50 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
                      }
                    />
                    <text
                      x={col.x + 20}
                      y={ry + 19}
                      className={
                        takenOver
                          ? "fill-gray-900 text-xs font-medium dark:fill-gray-100"
                          : "fill-gray-500 text-xs dark:fill-gray-400"
                      }
                    >
                      {isZh ? row.zh : row.en}
                    </text>
                    <rect
                      x={col.x + 126}
                      y={ry + 5}
                      width="72"
                      height="20"
                      rx="4"
                      className={
                        takenOver
                          ? newlyTakenOver && col.active
                            ? "fill-emerald-600 dark:fill-emerald-500"
                            : "fill-brand-600 dark:fill-brand-500"
                          : "fill-gray-200 dark:fill-gray-700"
                      }
                    />
                    <text
                      x={col.x + 162}
                      y={ry + 19}
                      textAnchor="middle"
                      className={
                        takenOver
                          ? "fill-white text-xs font-semibold dark:fill-gray-950"
                          : "fill-gray-600 text-xs dark:fill-gray-300"
                      }
                    >
                      {takenOver ? copy.agentTag : copy.humanTag}
                    </text>
                    <title>{roleLabel}</title>
                  </g>
                );
              })}

              <text
                x={cx}
                y="240"
                textAnchor="middle"
                className="fill-gray-500 text-xs dark:fill-gray-400"
              >
                {copy.colFooters[col.idx]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
