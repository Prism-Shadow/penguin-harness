/**
 * Topology diagram for the Super-agent blog post (`data-widget="super-agent-architecture"`).
 *
 * Three connected mechanisms share one drawing, each lit in turn by a gentle automatic spotlight:
 *   1. 事件驱动: 群聊 / GitHub 进入两级过滤，闲聊丢弃，有效事件交给 Router
 *   2. 双层架构: Router Agent 向三个并发 Worker 派发任务
 *   3. Watchdog 巡检: 主系统外的 Watchdog Agent 定时巡检 Worker 层
 *
 * A reader with reduced motion, or one who has not scrolled the figure into view, sees all three
 * parts lit at once: they are concurrent mechanisms, not three steps in a sequence.
 */
import { useEffect, useState } from "react";
import { S, zh } from "../lib/strings";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";

const TOTAL_STAGES = 3;

/** The Router/Worker core holds the spotlight longest; the intake and the loop pass quicker. */
function stageDelayMs(stage: number): number {
  if (stage === 1) return 2600;
  if (stage === 2) return 2200;
  return 1800;
}

/** Worker boxes, centred under the Router at x = 236 / 334 / 432. */
const WORKERS = [
  { cx: 236, x: 192 },
  { cx: 334, x: 290 },
  { cx: 432, x: 388 },
] as const;

const TRANSITION = "transition-colors duration-500";

/** An agent that owns a decision: the Router and the Watchdog. */
function primarySurface(lit: boolean): string {
  return lit
    ? `${TRANSITION} fill-brand-100 stroke-brand-600 dark:fill-brand-900/70 dark:stroke-brand-400`
    : `${TRANSITION} fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700`;
}

/** A component or a worker: it runs its job, the decision is made elsewhere. */
function softSurface(lit: boolean): string {
  return lit
    ? `${TRANSITION} fill-brand-50 stroke-brand-500 dark:fill-brand-950 dark:stroke-brand-400`
    : `${TRANSITION} fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700`;
}

function arrowStroke(lit: boolean): string {
  return `${TRANSITION} ${
    lit ? "stroke-brand-500 dark:stroke-brand-400" : "stroke-gray-400 dark:stroke-gray-500"
  }`;
}

function arrowMarker(lit: boolean): string {
  return lit ? "url(#sa-arch-arrow-brand)" : "url(#sa-arch-arrow-gray)";
}

export function SuperAgentArchitectureWidget() {
  const isZh = S === zh;
  const reduced = usePrefersReducedMotion();
  const { ref, active } = useVisibleActivity<HTMLDivElement>();

  // -1 is the still frame: every part lit, which is the whole architecture at once.
  const [stage, setStage] = useState<number>(-1);
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const running = active && !reduced;

  useEffect(() => {
    if (running && !hasStarted) {
      setHasStarted(true);
      setStage(0);
    }
  }, [running, hasStarted]);

  useEffect(() => {
    if (!running || stage < 0) return;
    const timer = window.setTimeout(() => {
      setStage((prev) => (prev + 1) % TOTAL_STAGES);
    }, stageDelayMs(stage));
    return () => window.clearTimeout(timer);
  }, [running, stage]);

  const copy = isZh
    ? {
        aria: "Super-agent 架构：群聊与 GitHub 事件经代码规则和模型两级过滤，Router 把任务派发给并发 Worker，主系统外的 Watchdog Agent 定时巡检并介入修复",
        part1: "① 事件驱动",
        part2: "② 双层架构",
        part3: "③ Watchdog 巡检",
        events: "群聊 / GitHub",
        filter: "两级过滤",
        filterSub: "代码规则 + 模型",
        noise: "闲聊丢弃",
        router: "Router Agent",
        routerSub: "维护全局上下文，汇总结果",
        workers: [
          { label: "Worker 1", note1: "复现 Bug", note2: "提交 PR" },
          { label: "Worker 2", note1: "前端", note2: "修改界面" },
          { label: "Worker 3", note1: "后端", note2: "修改接口" },
        ],
        watchdog: "Watchdog Agent",
        watchdogCheck: "定期检查 Worker 进展",
        watchdogFix: "识别跑偏并介入修复",
      }
    : {
        aria: "Super-agent architecture: chat and GitHub events pass a code-rule and model two-tier filter, the Router dispatches tasks to concurrent Workers, and a Watchdog Agent outside the main system inspects them on a timer",
        part1: "1. Event-Driven",
        part2: "2. Two-Tier",
        part3: "3. Watchdog",
        events: "Chat / GitHub",
        filter: "Two-Tier Filter",
        filterSub: "code rules + model",
        noise: "chatter dropped",
        router: "Router Agent",
        routerSub: "global context, collects results",
        workers: [
          { label: "Worker 1", note1: "repros bug", note2: "opens PR" },
          { label: "Worker 2", note1: "frontend", note2: "UI changes" },
          { label: "Worker 3", note1: "backend", note2: "API changes" },
        ],
        watchdog: "Watchdog Agent",
        watchdogCheck: "checks Worker progress",
        watchdogFix: "fixes loops and drift",
      };

  const allLit = stage === -1;
  const lit0 = allLit || stage === 0;
  const lit1 = allLit || stage === 1;
  const lit2 = allLit || stage === 2;

  return (
    <div ref={ref} className="my-4 text-gray-900 dark:text-gray-100">
      <svg
        viewBox="0 0 720 302"
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

        {/* ==================== PART 1: EVENT-DRIVEN INTAKE ==================== */}
        <text
          x="70"
          y="18"
          textAnchor="middle"
          className="fill-gray-500 text-xs font-medium dark:fill-gray-400"
        >
          {copy.part1}
        </text>

        {/* The streams the system listens to. */}
        <rect
          x="8"
          y="44"
          width="124"
          height="44"
          rx="8"
          strokeWidth="1.5"
          className={`${TRANSITION} ${
            lit0
              ? "fill-gray-100 stroke-brand-500 dark:fill-gray-800 dark:stroke-brand-400"
              : "fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
          }`}
        />
        <text
          x="70"
          y="71"
          textAnchor="middle"
          className="fill-gray-900 text-sm font-medium dark:fill-gray-100"
        >
          {copy.events}
        </text>

        {/* Trigger -> intake filter. */}
        <path
          d="M70,88 L70,110"
          fill="none"
          strokeWidth="1.5"
          className={arrowStroke(lit0)}
          markerEnd={arrowMarker(lit0)}
        />

        {/* Program rules first, then the model: the two-tier filter. */}
        <rect
          x="8"
          y="110"
          width="124"
          height="64"
          rx="8"
          strokeWidth="1.5"
          className={softSurface(lit0)}
        />
        <text
          x="70"
          y="137"
          textAnchor="middle"
          className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
        >
          {copy.filter}
        </text>
        <text
          x="70"
          y="157"
          textAnchor="middle"
          className="fill-gray-600 text-xs dark:fill-gray-400"
        >
          {copy.filterSub}
        </text>

        {/* Noise leaves the flow here and ends in a muted tag, not a component. */}
        <path
          d="M70,174 L70,220"
          fill="none"
          strokeWidth="1.5"
          className="stroke-gray-400 dark:stroke-gray-500"
          markerEnd="url(#sa-arch-arrow-gray)"
        />
        <rect
          x="16"
          y="220"
          width="108"
          height="28"
          rx="6"
          strokeWidth="1"
          className="fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700"
        />
        <text
          x="70"
          y="238"
          textAnchor="middle"
          className="fill-gray-500 text-xs dark:fill-gray-400"
        >
          {copy.noise}
        </text>

        {/* Valid events leave the filter and join the Router's row. */}
        <path
          d="M132,142 H196"
          fill="none"
          strokeWidth="1.5"
          className={arrowStroke(lit0)}
          markerEnd={arrowMarker(lit0)}
        />

        {/* ==================== PART 2: TWO-TIER ROUTER / WORKERS ==================== */}
        <text
          x="334"
          y="18"
          textAnchor="middle"
          className="fill-gray-500 text-xs font-medium dark:fill-gray-400"
        >
          {copy.part2}
        </text>

        {/* The always-on Router keeps the global context and hands tasks down. */}
        <rect
          x="196"
          y="110"
          width="276"
          height="64"
          rx="10"
          strokeWidth="1.5"
          className={primarySurface(lit1)}
        />
        <text
          x="334"
          y="136"
          textAnchor="middle"
          className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
        >
          {copy.router}
        </text>
        <text
          x="334"
          y="158"
          textAnchor="middle"
          className="fill-gray-600 text-xs dark:fill-gray-400"
        >
          {copy.routerSub}
        </text>

        {/* Router -> one isolated Worker per task. */}
        {WORKERS.map((w, i) => (
          <g key={w.x}>
            <path
              d={`M${w.cx},174 L${w.cx},214`}
              fill="none"
              strokeWidth="1.5"
              className={arrowStroke(lit1)}
              markerEnd={arrowMarker(lit1)}
            />
            <rect
              x={w.x}
              y="214"
              width="88"
              height="80"
              rx="8"
              strokeWidth="1.5"
              className={softSurface(lit1)}
            />
            <text
              x={w.cx}
              y="237"
              textAnchor="middle"
              className="fill-gray-900 text-xs font-semibold dark:fill-gray-100"
            >
              {copy.workers[i]?.label}
            </text>
            <text
              x={w.cx}
              y="258"
              textAnchor="middle"
              className="fill-gray-600 text-xs dark:fill-gray-400"
            >
              {copy.workers[i]?.note1}
            </text>
            <text
              x={w.cx}
              y="276"
              textAnchor="middle"
              className="fill-gray-600 text-xs dark:fill-gray-400"
            >
              {copy.workers[i]?.note2}
            </text>
          </g>
        ))}

        {/* ==================== PART 3: WATCHDOG SIDECAR ==================== */}
        <text
          x="616"
          y="18"
          textAnchor="middle"
          className="fill-gray-500 text-xs font-medium dark:fill-gray-400"
        >
          {copy.part3}
        </text>

        {/* The Watchdog runs outside the main system. */}
        <rect
          x="520"
          y="110"
          width="192"
          height="84"
          rx="10"
          strokeWidth="1.5"
          className={primarySurface(lit2)}
        />
        <text
          x="616"
          y="138"
          textAnchor="middle"
          className="fill-gray-900 text-sm font-semibold dark:fill-gray-100"
        >
          {copy.watchdog}
        </text>
        <text
          x="616"
          y="160"
          textAnchor="middle"
          className="fill-gray-600 text-xs dark:fill-gray-400"
        >
          {copy.watchdogCheck}
        </text>
        <text
          x="616"
          y="180"
          textAnchor="middle"
          className="fill-gray-600 text-xs dark:fill-gray-400"
        >
          {copy.watchdogFix}
        </text>

        {/* The timer-driven inspection loop onto the Worker layer. */}
        <path
          d="M616,194 V254 H480"
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          className={arrowStroke(lit2)}
          markerEnd={arrowMarker(lit2)}
        />
      </svg>
    </div>
  );
}
