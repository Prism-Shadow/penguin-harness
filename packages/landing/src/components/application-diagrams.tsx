import { useId, type ReactNode } from "react";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { useVisibleActivity } from "../lib/visible-activity";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useWidth } from "../lib/use-width";
import { S } from "../lib/strings";
import { FlowDot } from "./flow-dot";

const blue = "stroke-brand-500 dark:stroke-brand-400";
const blueFill = "fill-brand-500 dark:fill-brand-400";
const role = "fill-gray-900 dark:fill-gray-100 text-sm font-semibold";
const label = "fill-gray-500 dark:fill-gray-400 text-xs";
const accentLabel = "fill-brand-700 dark:fill-brand-300 text-xs font-medium";
const neutralBox = "fill-white stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-700";
const accentBox = "fill-brand-50 stroke-brand-200 dark:fill-brand-950 dark:stroke-brand-800";

function Diagram({
  name,
  children,
}: {
  name: string;
  children: (narrow: boolean, animate: boolean, arrow: string) => ReactNode;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(720);
  const { ref: svg, active } = useVisibleActivity<SVGSVGElement>();
  const reduced = usePrefersReducedMotion();
  const id = useId();
  const narrow = width < 520;
  return (
    <div
      ref={ref}
      className="mx-auto mb-5 max-w-4xl rounded-2xl bg-gray-50 p-3 sm:p-5 dark:bg-gray-900"
    >
      <svg
        ref={svg}
        role="img"
        aria-label={name}
        data-story-diagram=""
        viewBox={narrow ? "0 0 280 316" : "0 0 720 294"}
        className="mx-auto block w-full max-w-[760px]"
      >
        <title>{name}</title>
        <defs>
          <marker
            id={id}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" className={blueFill} />
          </marker>
        </defs>
        {children(narrow, active && !reduced, "url(#" + id + ")")}
      </svg>
    </div>
  );
}

const appGlyphs = [
  "M-12-12H4l5 5v9M-12-12v25H0M3-12v6h6M-8-2H2m-10 5h7 M11 10l5 5",
  "M-13-13v26h29M-9 9V4h4v5m4 0V-3h4V9m4 0V-8h4V9M-10-3l6-5 6 2 8-7",
  "M-12-13H5l6 6v7M-12-13v26H0M4-13v7h7M-8-2h11m-11 5h6m3 5 4 4 9-10",
] as const;

/** The three published workbenches can each support work on the same acquisition file. */
export function AppGenerationDiagram() {
  const { locale } = useSiteLocale();
  const zh = locale === "zh";
  return (
    <Diagram
      name={
        zh
          ? "一句需求经 PenguinHarness OS 生成文档问答、投资分析和法务助手"
          : "One request through PenguinHarness OS produces document, investment, and legal apps"
      }
    >
      {(narrow, animate, arrow) => {
        const boxX = narrow ? 97 : 484;
        const centerX = narrow ? 55 : 293;
        const centerY = narrow ? 122 : 147;
        const ys = narrow ? [149, 208, 267] : [65, 147, 229];
        const source = narrow ? "M55 61V80" : "M182 147H226";
        return (
          <>
            <g transform={narrow ? "translate(9 5)" : "translate(12 118)"}>
              <rect width="170" height="55" rx="10" strokeWidth="1.5" className={neutralBox} />
              <text x="13" y="21" className={label}>
                {zh ? "需求" : "Request"}
              </text>
              <text x="13" y="42" className={role}>
                {zh ? "帮我审阅收购资料" : "Review the acquisition"}
              </text>
            </g>
            <path d={source} className={blue} fill="none" strokeWidth="2.5" markerEnd={arrow} />
            {animate && <FlowDot path={source} dur="2.2s" begin="0s" accent r={2.25} />}
            {S.cases.apps.map((name, i) => {
              const y = ys[i]!;
              const route = narrow
                ? `M${centerX} 134V${y + 8}q0 10 10 10H${boxX - 4}`
                : y === centerY
                  ? `M362 147H${boxX - 4}`
                  : `M362 147H392q12 0 12 ${y < centerY ? -12 : 12}V${y + (y < centerY ? 12 : -12)}q0 ${y < centerY ? -12 : 12} 12 ${y < centerY ? -12 : 12}H${boxX - 4}`;
              const boxY = narrow ? y - 4 : y - 25;
              return (
                <g key={name}>
                  <path
                    d={route}
                    className={blue}
                    fill="none"
                    strokeWidth="1.5"
                    markerEnd={arrow}
                  />
                  {animate && (
                    <FlowDot
                      path={route}
                      dur={["2.2s", "2.4s", "2.6s"][i]!}
                      begin={["0s", "-0.75s", "-1.5s"][i]!}
                      accent
                      r={2.25}
                    />
                  )}
                  <rect
                    x={boxX}
                    y={boxY}
                    width={narrow ? 178 : 206}
                    height="48"
                    rx="10"
                    className={accentBox}
                    strokeWidth="1.5"
                  />
                  <g
                    transform={`translate(${boxX + 23} ${boxY + 24})`}
                    fill="none"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={blue}
                  >
                    <path d={appGlyphs[i]} />
                    {i === 0 && <circle cx="7" cy="7" r="5" />}
                  </g>
                  <text x={boxX + 44} y={boxY + 29} className={role}>
                    {name}
                  </text>
                </g>
              );
            })}
            <g transform={narrow ? "translate(9 82)" : "translate(230 120)"}>
              <rect
                width={narrow ? 138 : 130}
                height="52"
                rx="10"
                strokeWidth="1.5"
                className="fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
              />
              <text x={narrow ? 69 : 65} y="22" textAnchor="middle" className={role}>
                PenguinHarness
              </text>
              <text x={narrow ? 69 : 65} y="40" textAnchor="middle" className={accentLabel}>
                {zh ? "生成应用" : "Generate apps"}
              </text>
            </g>
          </>
        );
      }}
    </Diagram>
  );
}

const agents = [
  { en: "Coverage", zh: "核赔", symbol: "m0-9 8 3v5c0 4-4 7-8 10-4-3-8-6-8-10v-5Zm-4 8 3 3 5-6" },
  { en: "Support", zh: "工单", symbol: "M-9-6H9V5H-1l-5 4V5h-3Zm4 4h9m-9 3h6" },
  { en: "Finance", zh: "财务", symbol: "M-8-7H8V7H-8Zm0 5H8M-3-2v9m4-5h4m-4 3h4" },
  { en: "Filing", zh: "归档", symbol: "M-9-5h7l3 3h8v9H-9Zm2-1v-3H3l4 4" },
] as const;

/** Task families from the published GDPEVO Essential comparison. Positions illustrate phases, not scores. */
export function AgentEvaluationDiagram() {
  const { locale } = useSiteLocale();
  const zh = locale === "zh";
  const stages = zh ? ["评估", "改进", "复测"] : ["Evaluate", "Improve", "Retest"];
  return (
    <Diagram
      name={
        zh
          ? "四个 Agent 经过同一组评估、改进和复测阶段，各自循环更新版本"
          : "Four agents independently revise their versions through shared evaluation, improvement, and retesting"
      }
    >
      {(narrow, animate, arrow) => {
        const left = narrow ? 82 : 159;
        const end = narrow ? 271 : 692;
        const stops = narrow ? [106, 173, 239] : [238, 428, 613];
        const ys = narrow ? [85, 146, 207, 268] : [77, 136, 195, 254];
        return (
          <>
            <rect
              x={narrow ? 81 : 169}
              y="12"
              width={narrow ? 192 : 529}
              height={narrow ? 287 : 272}
              rx="10"
              className={accentBox}
              strokeWidth="1.5"
            />
            <text x={narrow ? 177 : 435} y="33" textAnchor="middle" className={role}>
              {zh ? "统一自进化平台" : "Shared evolution platform"}
            </text>
            {stages.map((stage, i) => (
              <g key={stage}>
                <text x={stops[i]} y="55" textAnchor="middle" className={accentLabel}>
                  {stage}
                </text>
                <path
                  d={`M${stops[i]} 62V${narrow ? 281 : 268}`}
                  className="stroke-brand-200 dark:stroke-brand-800"
                  strokeDasharray="3 4"
                  fill="none"
                />
              </g>
            ))}
            {agents.map((a, i) => {
              const y = ys[i]!;
              const route = `M${left} ${y}H${end - 8}q8 0 8 8t-8 8H${left + 8}q-8 0-8-8Z`;
              const center = narrow ? 12 : 27;
              return (
                <g key={a.en} data-agent-loop={a.en}>
                  <path d={route} className={blue} fill="none" strokeWidth="1.5" />
                  <path
                    d={`M${left + 31} ${y + 16}h-9`}
                    className={blue}
                    fill="none"
                    strokeWidth="1.5"
                    markerEnd={arrow}
                  />
                  {stops.map((x) => (
                    <circle
                      key={x}
                      cx={x}
                      cy={y}
                      r="3"
                      className="fill-white stroke-brand-500 dark:fill-gray-900 dark:stroke-brand-400"
                      strokeWidth="1.5"
                    />
                  ))}
                  {animate ? (
                    <FlowDot
                      path={route}
                      dur={["2.2s", "2.4s", "2.6s", "2.4s"][i]!}
                      begin={["-0.25s", "-0.95s", "-1.6s", "-1.95s"][i]!}
                      accent
                      r={2.25}
                    />
                  ) : (
                    <circle
                      r="2.25"
                      cx={left + (end - left) * [0.21, 0.55, 0.76, 0.35][i]!}
                      cy={y + (i > 1 ? 16 : 0)}
                      className={blueFill}
                    />
                  )}
                  <rect
                    x={narrow ? 0 : 6}
                    y={y - 13}
                    width={left - (narrow ? 0 : 6)}
                    height="38"
                    rx="10"
                    className={neutralBox}
                    strokeWidth="1.5"
                  />
                  <path
                    d={a.symbol}
                    transform={`translate(${center} ${y + 6})`}
                    className={blue}
                    fill="none"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <text
                    x={center + (narrow ? 12 : 18)}
                    y={y + 11}
                    className={
                      narrow && !zh
                        ? "fill-gray-900 text-xs font-semibold dark:fill-gray-100"
                        : role
                    }
                  >
                    {a[locale]}
                  </text>
                </g>
              );
            })}
          </>
        );
      }}
    </Diagram>
  );
}
