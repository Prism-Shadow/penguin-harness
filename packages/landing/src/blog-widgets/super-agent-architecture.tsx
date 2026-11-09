/**
 * Progressive 3-Stage Spotlight Diagram for the Super-agent blog post (`data-widget="super-agent-architecture"`).
 *
 * Follows the exact visual and motion language of PR #1455 (`blog-widgets/`):
 * Three columns stay in place on a 720x252 horizontal canvas, transitioning smoothly from dimmed
 * ghost (opacity 0.24) -> bright active spotlight -> calm completed state:
 *   Stage 1 (Col 1, x = 8..224):   `1. 事件驱动` / `1. Event-Driven`
 *                                  Group chat & GitHub triggers -> 2-tier filter (Code Fast Path +
 *                                  LLM Slow Path) -> silent bug reproduction & PR submission
 *   Stage 2 (Col 2, x = 252..492): `2. 双层架构` / `2. Two-Tier Router`
 *                                  Resident Router Agent (global context & dispatch) -> isolated
 *                                  concurrent Worker Sessions (`Worker 1..3`)
 *   Stage 3 (Col 3, x = 520..712): `3. Watchdog 巡检` / `3. Watchdog Loop`
 *                                  External Watchdog Agent (timer control loop) inspects progress,
 *                                  detects dead loops / drift, and auto-recovers
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
    id: "event",
    labelZh: "1. 事件驱动",
    labelEn: "1. Event-Driven",
    startTick: 0,
    endTick: 4,
  },
  {
    id: "router",
    labelZh: "2. 双层架构",
    labelEn: "2. Two-Tier Router",
    startTick: 5,
    endTick: 9,
  },
  {
    id: "watchdog",
    labelZh: "3. Watchdog 巡检",
    labelEn: "3. Watchdog Loop",
    startTick: 10,
    endTick: 13,
  },
];

const TOTAL_TICKS = 14;

function tickDelayMs(tick: number): number {
  if (tick === 4 || tick === 9) return 1300;
  if (tick === 13) return 2600;
  return 720;
}

const EVENT_STREAM = [
  { kind: "chat", zh: "群聊日常闲聊", en: "Daily chat noise", pass: false },
  { kind: "bug", zh: "群聊反馈报错", en: "Bug report in chat", pass: true },
  { kind: "pr", zh: "GitHub 提 Issue", en: "New GitHub Issue", pass: true },
] as const;

const WORKERS = [
  { id: "W1", zh: "Worker 1 / 前端修复", en: "Worker 1 / Frontend", y: 122 },
  { id: "W2", zh: "Worker 2 / 后端排障", en: "Worker 2 / Backend", y: 162 },
  { id: "W3", zh: "Worker 3 / 复现提 PR", en: "Worker 3 / Repro & PR", y: 202 },
] as const;

export function SuperAgentArchitectureWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  const [tick, setTick] = useState<number>(13);
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

  const reachedS1 = tick >= 5;
  const reachedS2 = tick >= 10;

  const activeEventIdx = tick < 3 ? tick : 2;
  const silentPrReady = tick >= 4;
  const activeWorkerIdx = tick >= 5 && tick <= 7 ? tick - 5 : 2;
  const routerUnifiedReply = tick >= 8;
  const watchdogHealing = tick === 11 || tick === 12;
  const watchdogHealthy = tick >= 13;

  const copy = isZh
    ? {
        play: "播放架构演进",
        pause: "暂停架构演进",
        col1Title: "事件驱动：替代反馈分诊",
        streamTitle: "群聊 / GitHub 事件流",
        filterTitle: "两级过滤（代码规则 + 模型）",
        dropBadge: "滤除",
        passBadge: "触发",
        reproBox: "后台静默复现，成功即提 PR",
        col2Title: "双层架构：替代多窗口调度",
        routerTitle: "常驻 Router 层（轻量模型）",
        routerSub: "维护全局记忆、分派任务、统一回复",
        workerPool: "隔离 Worker 层（并发执行）",
        col3Title: "Watchdog：替代盯盘救火",
        wdTitle: "Watchdog Agent",
        wdSub: "定时消息驱动的独立控制回路",
        check1: "1. 探测接口报错与状态恢复",
        check2: "2. 语义判断任务进展与跑偏",
        statusLoop: "检测到死循环，介入纠正",
        statusOk: "各 Worker 进展正常",
      }
    : {
        play: "Play architecture flow",
        pause: "Pause architecture flow",
        col1Title: "Event-Driven: Replace Triage",
        streamTitle: "IM Chat & GitHub Triggers",
        filterTitle: "2-Tier Filter (Code + LLM)",
        dropBadge: "Drop",
        passBadge: "Pass",
        reproBox: "Silent Repro & Auto PR",
        col2Title: "Two-Tier: Replace Window Switching",
        routerTitle: "Resident Router (Light LLM)",
        routerSub: "Global Context & Task Dispatch",
        workerPool: "Isolated Workers (Concurrent)",
        col3Title: "Watchdog: Replace Babysitting",
        wdTitle: "Watchdog Agent",
        wdSub: "Timer-Driven Control Loop",
        check1: "1. Infra & state health check",
        check2: "2. Semantic progress & drift audit",
        statusLoop: "Loop Detected, Auto-Repair",
        statusOk: "All Workers Healthy",
      };

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Super-agent architecture stages"
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
        viewBox="0 0 720 248"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label="Super-agent three-part architecture diagram"
      >
        <defs>
          <marker
            id="sa-arch-arrow-brand"
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
            id="sa-arch-arrow-gray"
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
            id="sa-arch-arrow-emerald"
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

        {/* ==================== COL 1: EVENT-DRIVEN (x=8..224, y=12..236) ==================== */}
        <g>
          <rect
            x="8"
            y="12"
            width="216"
            height="224"
            rx="10"
            strokeWidth={isS0 ? "2" : "1.5"}
            className={
              isS0
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="116"
            y="34"
            textAnchor="middle"
            className={
              isS0
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col1Title}
          </text>

          {EVENT_STREAM.map((ev, i) => {
            const ry = 48 + i * 32;
            const visible = !isS0 || i <= activeEventIdx;
            const isCurrent = isS0 && i === activeEventIdx;
            return (
              <g key={ev.kind} style={{ opacity: visible ? 1 : 0.3 }}>
                <rect
                  x="20"
                  y={ry}
                  width="192"
                  height="26"
                  rx="5"
                  strokeWidth={isCurrent ? "1.5" : "1"}
                  className={
                    isCurrent
                      ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                      : "fill-gray-50 stroke-gray-200 dark:fill-gray-800/60 dark:stroke-gray-700"
                  }
                />
                <text
                  x="30"
                  y={ry + 17}
                  className="fill-gray-700 text-xs font-medium dark:fill-gray-300"
                >
                  {isZh ? ev.zh : ev.en}
                </text>
                <rect
                  x="164"
                  y={ry + 4}
                  width="40"
                  height="18"
                  rx="4"
                  className={
                    ev.pass
                      ? isS0
                        ? "fill-brand-600 dark:fill-brand-500"
                        : "fill-gray-200 dark:fill-gray-700"
                      : "fill-gray-200 dark:fill-gray-800"
                  }
                />
                <text
                  x="184"
                  y={ry + 17}
                  textAnchor="middle"
                  className={
                    ev.pass
                      ? isS0
                        ? "fill-white text-xs font-semibold dark:fill-gray-950"
                        : "fill-gray-700 text-xs font-medium dark:fill-gray-300"
                      : "fill-gray-500 text-xs dark:fill-gray-400"
                  }
                >
                  {ev.pass ? copy.passBadge : copy.dropBadge}
                </text>
              </g>
            );
          })}

          <rect
            x="20"
            y="150"
            width="192"
            height="30"
            rx="6"
            strokeWidth="1.25"
            className={
              isS0
                ? "fill-white stroke-brand-400 dark:fill-gray-900 dark:stroke-brand-600"
                : "fill-gray-50 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
            }
          />
          <text
            x="116"
            y="169"
            textAnchor="middle"
            className="fill-gray-700 text-xs font-medium dark:fill-gray-300"
          >
            {copy.filterTitle}
          </text>

          <rect
            x="20"
            y="192"
            width="192"
            height="32"
            rx="6"
            className={
              silentPrReady && isS0
                ? "fill-emerald-600 dark:fill-emerald-500"
                : "fill-gray-100 dark:fill-gray-800"
            }
          />
          <text
            x="116"
            y="212"
            textAnchor="middle"
            className={
              silentPrReady && isS0
                ? "fill-white text-xs font-semibold dark:fill-gray-950"
                : "fill-gray-600 text-xs font-medium dark:fill-gray-400"
            }
          >
            {copy.reproBox}
          </text>
        </g>

        {/* ==================== COL 2: TWO-TIER ARCHITECTURE (x=252..492, y=12..236) ==================== */}
        <g style={{ opacity: reachedS1 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M224,124 L250,124"
            fill="none"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "stroke-brand-600 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS1 ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"}
          />
          <rect
            x="252"
            y="12"
            width="240"
            height="224"
            rx="10"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="372"
            y="34"
            textAnchor="middle"
            className={
              isS1
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col2Title}
          </text>

          {/* Upper Layer: Resident Router */}
          <rect
            x="266"
            y="46"
            width="212"
            height="48"
            rx="7"
            strokeWidth="1.5"
            className={
              routerUnifiedReply && isS1
                ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/50 dark:stroke-emerald-400"
                : isS1
                  ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                  : "fill-gray-50 stroke-gray-300 dark:fill-gray-800/60 dark:stroke-gray-700"
            }
          />
          <text
            x="372"
            y="66"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {copy.routerTitle}
          </text>
          <text
            x="372"
            y="84"
            textAnchor="middle"
            className="fill-gray-500 text-xs dark:fill-gray-400"
          >
            {copy.routerSub}
          </text>

          {/* Lower Layer: Isolated Worker Sessions */}
          {WORKERS.map((w, idx) => {
            const isHighlighted = isS1 && idx <= activeWorkerIdx;
            const isTargetBeingHealed = isS2 && watchdogHealing && idx === 1;
            return (
              <g key={w.id}>
                <path
                  d={`M290,94 L290,${w.y + 14} L304,${w.y + 14}`}
                  fill="none"
                  strokeWidth="1.25"
                  className={
                    isHighlighted
                      ? "stroke-brand-500 dark:stroke-brand-400"
                      : "stroke-gray-300 dark:stroke-gray-600"
                  }
                  markerEnd={
                    isHighlighted ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"
                  }
                />
                <rect
                  x="306"
                  y={w.y}
                  width="172"
                  height="28"
                  rx="6"
                  strokeWidth={isHighlighted || isTargetBeingHealed ? "1.5" : "1.25"}
                  className={
                    isTargetBeingHealed
                      ? "fill-emerald-50 stroke-emerald-600 dark:fill-emerald-950/60 dark:stroke-emerald-400"
                      : isHighlighted
                        ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                        : "fill-gray-50 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
                  }
                />
                <text
                  x="392"
                  y={w.y + 18}
                  textAnchor="middle"
                  className="fill-gray-800 text-xs font-medium dark:fill-gray-200"
                >
                  {isZh ? w.zh : w.en}
                </text>
              </g>
            );
          })}
        </g>

        {/* ==================== COL 3: WATCHDOG AGENT (x=520..712, y=12..236) ==================== */}
        <g style={{ opacity: reachedS2 ? 1 : 0.24 }} className="transition-opacity duration-200">
          <path
            d="M492,124 L518,124"
            fill="none"
            strokeWidth={isS2 ? "2" : "1.5"}
            strokeDasharray="4 3"
            className={
              isS2
                ? "stroke-brand-600 dark:stroke-brand-400"
                : "stroke-gray-300 dark:stroke-gray-600"
            }
            markerEnd={isS2 ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"}
          />
          <rect
            x="520"
            y="12"
            width="192"
            height="224"
            rx="10"
            strokeWidth={isS2 ? "2" : "1.5"}
            className={
              isS2
                ? "fill-brand-50/40 stroke-brand-600 dark:fill-brand-950/30 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="616"
            y="34"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-700 text-xs font-semibold dark:fill-gray-300"
            }
          >
            {copy.col3Title}
          </text>

          <rect
            x="532"
            y="48"
            width="168"
            height="50"
            rx="7"
            strokeWidth="1.5"
            className={
              isS2
                ? "fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-gray-50 stroke-gray-300 dark:fill-gray-800/60 dark:stroke-gray-700"
            }
          />
          <text
            x="616"
            y="69"
            textAnchor="middle"
            className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
          >
            {copy.wdTitle}
          </text>
          <text
            x="616"
            y="87"
            textAnchor="middle"
            className="fill-gray-500 text-xs dark:fill-gray-400"
          >
            {copy.wdSub}
          </text>

          <rect
            x="532"
            y="110"
            width="168"
            height="32"
            rx="5"
            className="fill-gray-50 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
            strokeWidth="1"
          />
          <text
            x="616"
            y="130"
            textAnchor="middle"
            className="fill-gray-700 text-xs dark:fill-gray-300"
          >
            {copy.check1}
          </text>

          <rect
            x="532"
            y="150"
            width="168"
            height="32"
            rx="5"
            className="fill-gray-50 stroke-gray-200 dark:fill-gray-800/50 dark:stroke-gray-700"
            strokeWidth="1"
          />
          <text
            x="616"
            y="170"
            textAnchor="middle"
            className="fill-gray-700 text-xs dark:fill-gray-300"
          >
            {copy.check2}
          </text>

          <rect
            x="532"
            y="192"
            width="168"
            height="32"
            rx="6"
            className={
              watchdogHealthy && isS2
                ? "fill-emerald-600 dark:fill-emerald-500"
                : watchdogHealing && isS2
                  ? "fill-brand-600 dark:fill-brand-500"
                  : "fill-gray-100 dark:fill-gray-800"
            }
          />
          <text
            x="616"
            y="212"
            textAnchor="middle"
            className={
              (watchdogHealthy || watchdogHealing) && isS2
                ? "fill-white text-xs font-semibold dark:fill-gray-950"
                : "fill-gray-600 text-xs font-medium dark:fill-gray-400"
            }
          >
            {watchdogHealing ? copy.statusLoop : copy.statusOk}
          </text>
        </g>
      </svg>
    </div>
  );
}
