/**
 * Button-free 3-Stage Spotlight Diagram for the Super-agent blog post (`data-widget="super-agent-architecture"`).
 *
 * Minimalist three-column architecture diagram with a gentle automatic spotlight across the three parts:
 *   1. 事件驱动 (Event-Driven): 群聊 / GitHub -> 两级过滤与复现
 *   2. 双层架构 (Two-Tier Architecture): Router Agent -> Worker 1 / Worker 2 / Worker 3
 *   3. Watchdog 巡检 (Watchdog Loop): 定时触发 -> Watchdog Agent (inspects Worker layer)
 */
import { useEffect, useState } from "react";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

const TOTAL_STAGES = 3;

function stageDelayMs(stage: number): number {
  if (stage === 2) return 2500;
  return 1500;
}

const WORKERS = [
  { id: "W1", label: "Worker 1", x: 272 },
  { id: "W2", label: "Worker 2", x: 334 },
  { id: "W3", label: "Worker 3", x: 396 },
] as const;

export function SuperAgentArchitectureWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  const [stage, setStage] = useState<number>(2);
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const running = active && !reduced;

  useEffect(() => {
    if (running && !hasStarted) {
      setHasStarted(true);
      setStage(0);
    }
  }, [running, hasStarted]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setStage((prev) => (prev + 1) % TOTAL_STAGES);
    }, stageDelayMs(stage));
    return () => window.clearTimeout(timer);
  }, [running, stage]);

  const copy = isZh
    ? {
        aria: "Super-agent 三部分架构设计：事件驱动、双层架构与 Watchdog 巡检",
        col1: "一、事件驱动",
        col2: "二、双层架构",
        col3: "三、Watchdog 巡检",
        events: "群聊 / GitHub",
        filterRepro: "两级过滤与复现",
        router: "Router Agent",
        timer: "定时触发",
        watchdog: "Watchdog Agent",
      }
    : {
        aria: "Super-agent three-part architecture: Event-Driven, Two-Tier Architecture, and Watchdog Loop",
        col1: "1. Event-Driven",
        col2: "2. Two-Tier",
        col3: "3. Watchdog",
        events: "Chat / GitHub",
        filterRepro: "Filter & Silent Repro",
        router: "Router Agent",
        timer: "Timer Trigger",
        watchdog: "Watchdog Agent",
      };

  const isS0 = stage === 0;
  const isS1 = stage === 1;
  const isS2 = stage === 2;

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      <svg
        viewBox="0 0 720 184"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label={copy.aria}
      >
        <defs>
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
        </defs>

        {/* ==================== COL 1: EVENT-DRIVEN (x=8..216) ==================== */}
        <g style={{ opacity: isS0 ? 1 : 0.45 }} className="transition-opacity duration-500">
          <rect
            x="8"
            y="8"
            width="208"
            height="168"
            rx="10"
            strokeWidth={isS0 ? "2" : "1.5"}
            className={
              isS0
                ? "fill-white stroke-brand-600 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="112"
            y="32"
            textAnchor="middle"
            className={
              isS0
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 text-xs font-medium dark:fill-gray-400"
            }
          >
            {copy.col1}
          </text>

          {/* Upper: Chat / GitHub */}
          <rect
            x="24"
            y="46"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
          />
          <text
            x="112"
            y="74"
            textAnchor="middle"
            className="fill-gray-800 text-sm font-semibold dark:fill-gray-200"
          >
            {copy.events}
          </text>

          {/* Connector Down */}
          <path
            d="M112,92 L112,111"
            fill="none"
            strokeWidth="1.5"
            className={
              isS0
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-400 dark:stroke-gray-500"
            }
            markerEnd={isS0 ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"}
          />

          {/* Lower: Two-Tier Filter & Silent Repro */}
          <rect
            x="24"
            y="114"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-brand-50 stroke-brand-500 dark:fill-brand-950 dark:stroke-brand-400"
          />
          <text
            x="112"
            y="142"
            textAnchor="middle"
            className="fill-brand-700 text-sm font-semibold dark:fill-brand-300"
          >
            {copy.filterRepro}
          </text>
        </g>

        {/* Arrow Col 1 -> Col 2 */}
        <path
          d="M222,92 L248,92"
          fill="none"
          strokeWidth={isS1 ? "2" : "1.5"}
          style={{ opacity: isS1 ? 1 : 0.45 }}
          className={`transition-opacity duration-500 ${
            isS1 ? "stroke-brand-500 dark:stroke-brand-400" : "stroke-gray-400 dark:stroke-gray-500"
          }`}
          markerEnd={isS1 ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"}
        />

        {/* ==================== COL 2: TWO-TIER ARCHITECTURE (x=256..464) ==================== */}
        <g style={{ opacity: isS1 ? 1 : 0.45 }} className="transition-opacity duration-500">
          <rect
            x="256"
            y="8"
            width="208"
            height="168"
            rx="10"
            strokeWidth={isS1 ? "2" : "1.5"}
            className={
              isS1
                ? "fill-white stroke-brand-600 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="360"
            y="32"
            textAnchor="middle"
            className={
              isS1
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 text-xs font-medium dark:fill-gray-400"
            }
          >
            {copy.col2}
          </text>

          {/* Upper: Router Agent */}
          <rect
            x="272"
            y="46"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-brand-100 stroke-brand-600 dark:fill-brand-900/70 dark:stroke-brand-400"
          />
          <text
            x="360"
            y="74"
            textAnchor="middle"
            className="fill-brand-800 text-sm font-semibold dark:fill-brand-200"
          >
            {copy.router}
          </text>

          {/* Lower: 3 Parallel Workers */}
          {WORKERS.map((w) => {
            const cx = w.x + 26;
            return (
              <g key={w.id}>
                <path
                  d={`M${cx},92 L${cx},111`}
                  fill="none"
                  strokeWidth="1.5"
                  className="stroke-brand-500 dark:stroke-brand-400"
                  markerEnd="url(#sa-arch-arrow-brand)"
                />
                <rect
                  x={w.x}
                  y="114"
                  width="52"
                  height="46"
                  rx="7"
                  strokeWidth="1.5"
                  className="fill-brand-50 stroke-brand-500 dark:fill-brand-950 dark:stroke-brand-400"
                />
                <text
                  x={cx}
                  y="141"
                  textAnchor="middle"
                  className="fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                >
                  {w.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* Inspection Arrow Col 3 -> Col 2 Worker Layer */}
        <path
          d="M498,137 L470,137"
          fill="none"
          strokeWidth={isS2 ? "2" : "1.5"}
          strokeDasharray="4 3"
          style={{ opacity: isS2 ? 1 : 0.45 }}
          className={`transition-opacity duration-500 ${
            isS2 ? "stroke-brand-500 dark:stroke-brand-400" : "stroke-gray-400 dark:stroke-gray-500"
          }`}
          markerEnd={isS2 ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"}
        />

        {/* ==================== COL 3: WATCHDOG AGENT (x=504..712) ==================== */}
        <g style={{ opacity: isS2 ? 1 : 0.45 }} className="transition-opacity duration-500">
          <rect
            x="504"
            y="8"
            width="208"
            height="168"
            rx="10"
            strokeWidth={isS2 ? "2" : "1.5"}
            className={
              isS2
                ? "fill-white stroke-brand-600 dark:fill-gray-900 dark:stroke-brand-400"
                : "fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            }
          />
          <text
            x="608"
            y="32"
            textAnchor="middle"
            className={
              isS2
                ? "fill-brand-700 text-xs font-semibold dark:fill-brand-300"
                : "fill-gray-500 text-xs font-medium dark:fill-gray-400"
            }
          >
            {copy.col3}
          </text>

          {/* Upper: Timer Trigger */}
          <rect
            x="520"
            y="46"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
          />
          <text
            x="608"
            y="74"
            textAnchor="middle"
            className="fill-gray-800 text-sm font-semibold dark:fill-gray-200"
          >
            {copy.timer}
          </text>

          {/* Connector Down */}
          <path
            d="M608,92 L608,111"
            fill="none"
            strokeWidth="1.5"
            className={
              isS2
                ? "stroke-brand-500 dark:stroke-brand-400"
                : "stroke-gray-400 dark:stroke-gray-500"
            }
            markerEnd={isS2 ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)"}
          />

          {/* Lower: Watchdog Agent */}
          <rect
            x="520"
            y="114"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-brand-100 stroke-brand-600 dark:fill-brand-900/70 dark:stroke-brand-400"
          />
          <text
            x="608"
            y="142"
            textAnchor="middle"
            className="fill-brand-800 text-sm font-semibold dark:fill-brand-200"
          >
            {copy.watchdog}
          </text>
        </g>
      </svg>
    </div>
  );
}
