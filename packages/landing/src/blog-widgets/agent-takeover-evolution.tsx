/**
 * Static 3-Stage Evolution Diagram for the Super-agent blog post (`data-widget="agent-takeover-evolution"`).
 *
 * Minimalist three-column progression showing how Agent systems progressively absorb the human role:
 *   Stage 1: 人主导 (Human-Led)
 *   Stage 2: 人主导 + Agent 辅助 (Human-Led, Agent-Assisted)
 *   Stage 3: Agent 主导 + Agent 辅助 (Agent-Led, Agent-Assisted)
 */
import { S, zh } from "../lib/strings";

export function AgentTakeoverEvolutionWidget() {
  const isZh = S === zh;

  const copy = isZh
    ? {
        aria: "三阶段演进：从人主导，到人主导、Agent 辅助，再到 Agent 主导、Agent 辅助",
        s1: "阶段一",
        s2: "阶段二",
        s3: "阶段三",
        humanLed: "人主导",
        agentAssisted: "Agent 辅助",
        agentLed: "Agent 主导",
      }
    : {
        aria: "Three-stage evolution: from Human-Led, to Human-Led + Agent-Assisted, to Agent-Led + Agent-Assisted",
        s1: "Stage 1",
        s2: "Stage 2",
        s3: "Stage 3",
        humanLed: "Human-Led",
        agentAssisted: "Agent-Assisted",
        agentLed: "Agent-Led",
      };

  return (
    <div className="my-4 text-gray-900 dark:text-gray-100">
      <svg
        viewBox="0 0 720 184"
        className="block w-full select-none overflow-visible"
        role="img"
        aria-label={copy.aria}
      >
        <defs>
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
        </defs>

        {/* ==================== STAGE 1: HUMAN-LED (x=8..216) ==================== */}
        <g>
          <rect
            x="8"
            y="8"
            width="208"
            height="168"
            rx="10"
            strokeWidth="1.5"
            className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
          />
          <text
            x="112"
            y="32"
            textAnchor="middle"
            className="fill-gray-500 text-xs font-medium dark:fill-gray-400"
          >
            {copy.s1}
          </text>
          <rect
            x="24"
            y="46"
            width="176"
            height="114"
            rx="8"
            strokeWidth="1.5"
            className="fill-gray-100 stroke-gray-300 dark:fill-gray-800/80 dark:stroke-gray-700"
          />
          <text
            x="112"
            y="108"
            textAnchor="middle"
            className="fill-gray-800 text-sm font-semibold dark:fill-gray-200"
          >
            {copy.humanLed}
          </text>
        </g>

        {/* Arrow Stage 1 -> Stage 2 */}
        <path
          d="M222,92 L248,92"
          fill="none"
          strokeWidth="1.5"
          className="stroke-gray-400 dark:stroke-gray-500"
          markerEnd="url(#sa-evo-arrow-gray)"
        />

        {/* ==================== STAGE 2: HUMAN-LED + AGENT-ASSISTED (x=256..464) ==================== */}
        <g>
          <rect
            x="256"
            y="8"
            width="208"
            height="168"
            rx="10"
            strokeWidth="1.5"
            className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
          />
          <text
            x="360"
            y="32"
            textAnchor="middle"
            className="fill-gray-500 text-xs font-medium dark:fill-gray-400"
          >
            {copy.s2}
          </text>

          {/* Upper: Human-Led */}
          <rect
            x="272"
            y="46"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-gray-100 stroke-gray-300 dark:fill-gray-800/80 dark:stroke-gray-700"
          />
          <text
            x="360"
            y="74"
            textAnchor="middle"
            className="fill-gray-800 text-sm font-semibold dark:fill-gray-200"
          >
            {copy.humanLed}
          </text>

          {/* Connector Down */}
          <path
            d="M360,92 L360,111"
            fill="none"
            strokeWidth="1.5"
            className="stroke-gray-400 dark:stroke-gray-500"
            markerEnd="url(#sa-evo-arrow-gray)"
          />

          {/* Lower: Agent-Assisted */}
          <rect
            x="272"
            y="114"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-brand-50 stroke-brand-500 dark:fill-brand-950/60 dark:stroke-brand-400"
          />
          <text
            x="360"
            y="142"
            textAnchor="middle"
            className="fill-brand-700 text-sm font-semibold dark:fill-brand-300"
          >
            {copy.agentAssisted}
          </text>
        </g>

        {/* Arrow Stage 2 -> Stage 3 */}
        <path
          d="M470,92 L496,92"
          fill="none"
          strokeWidth="1.5"
          className="stroke-brand-500 dark:stroke-brand-400"
          markerEnd="url(#sa-evo-arrow-brand)"
        />

        {/* ==================== STAGE 3: AGENT-LED + AGENT-ASSISTED (x=504..712) ==================== */}
        <g>
          <rect
            x="504"
            y="8"
            width="208"
            height="168"
            rx="10"
            strokeWidth="1.75"
            className="fill-brand-50/30 stroke-brand-600 dark:fill-brand-950/25 dark:stroke-brand-400"
          />
          <text
            x="608"
            y="32"
            textAnchor="middle"
            className="fill-brand-700 text-xs font-semibold dark:fill-brand-300"
          >
            {copy.s3}
          </text>

          {/* Upper: Agent-Led */}
          <rect
            x="520"
            y="46"
            width="176"
            height="46"
            rx="8"
            className="fill-brand-600 dark:fill-brand-500"
          />
          <text
            x="608"
            y="74"
            textAnchor="middle"
            className="fill-white text-sm font-semibold dark:fill-gray-950"
          >
            {copy.agentLed}
          </text>

          {/* Connector Down */}
          <path
            d="M608,92 L608,111"
            fill="none"
            strokeWidth="1.5"
            className="stroke-brand-500 dark:stroke-brand-400"
            markerEnd="url(#sa-evo-arrow-brand)"
          />

          {/* Lower: Agent-Assisted */}
          <rect
            x="520"
            y="114"
            width="176"
            height="46"
            rx="8"
            strokeWidth="1.5"
            className="fill-brand-50 stroke-brand-500 dark:fill-brand-950/60 dark:stroke-brand-400"
          />
          <text
            x="608"
            y="142"
            textAnchor="middle"
            className="fill-brand-700 text-sm font-semibold dark:fill-brand-300"
          >
            {copy.agentAssisted}
          </text>
        </g>
      </svg>
    </div>
  );
}
