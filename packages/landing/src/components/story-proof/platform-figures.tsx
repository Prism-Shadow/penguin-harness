import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

const mobileQuery = "(max-width: 640px)";
function observeWidth(notify: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

function Diagram({ name, children }: { name: string; children: (mobile: boolean) => ReactNode }) {
  const mobile = useSyncExternalStore(
    observeWidth,
    () => window.matchMedia(mobileQuery).matches,
    () => false,
  );
  const root = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const watcher = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting === true),
      { threshold: 0.15 },
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);
  return (
    <svg
      ref={root}
      className="proof-diagram"
      viewBox={mobile ? "0 0 280 275" : "0 0 600 258"}
      data-visible={visible}
      role="group"
      aria-label={name}
    >
      {children(mobile)}
    </svg>
  );
}

function Choice({
  x,
  y,
  active,
  title,
  onClick,
  children,
}: {
  x: number;
  y: number;
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      className="diagram-choice"
      data-active={active}
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <title>{title}</title>
      {children}
    </g>
  );
}

function Output({ kind }: { kind: number }) {
  if (kind === 0)
    return (
      <g>
        <path d="M-15 -15h32v31h-32z" className="sample-paper" />
        <path d="m-11 -6 2.5 2.5 4-5M0 -6h11M0 2h9M0 10h6" />
        <path d="M-11 0h5v5h-5zm0 8h5v5h-5z" strokeWidth="1.2" />
      </g>
    );
  if (kind === 1)
    return (
      <g>
        <path d="M-17 -14v29h36" />
        <path d="M-12 12V5h6v7m4 0V-2h6v14m4 0V-9h6v21" className="sample-fill" />
        <path d="m-13 -3 9-8 7 4 11-11" />
      </g>
    );
  return (
    <g>
      <path d="M-16 -16H5l6 6v13M-16 -16v32H3M5 -16v7h6M-11 -5h14m-14 6h9m-9 6h7" />
      <circle cx="8" cy="7" r="7" className="sample-paper" />
      <path d="m13 12 7 7" />
    </g>
  );
}

const appNames = {
  en: ["Launch checklist", "Run scores", "Document questions"],
  zh: ["上线清单", "评估结果", "文档问答"],
} as const;

export function ApplicationFigure({
  selected,
  onSelect,
  lang,
}: {
  selected: number;
  onSelect: (i: number) => void;
  lang: "en" | "zh";
}) {
  const zh = lang === "zh";
  return (
    <Diagram
      name={
        zh
          ? "从需求到同一操作系统里的应用"
          : "From a request to applications on one operating system"
      }
    >
      {(mobile) => {
        const x = mobile ? 114 : 361;
        const ys = mobile ? [60, 140, 220] : [50, 129, 208];
        const inputY = mobile ? 140 : 129;
        const fork = mobile ? 45 : 167;
        const radius = mobile ? 15 : 30;
        return (
          <>
            <g className="diagram-label">
              <text x={mobile ? 2 : 22} y={mobile ? 115 : inputY - 23}>
                {zh ? "需求" : "Input"}
              </text>
              <path
                d={`M${mobile ? 6 : 25} ${inputY - 5}l5 5-5 5m10 0h7`}
                className="diagram-prompt-mark"
              />
            </g>
            <path className="diagram-rail" d={`M${mobile ? 34 : 66} ${inputY}H${fork}`} />
            {ys.map((y, i) => {
              const d =
                y === inputY
                  ? `M${fork} ${y}H${x - 24}`
                  : `M${fork} ${inputY}Q${fork + radius} ${inputY} ${fork + radius} ${inputY + Math.sign(y - inputY) * radius}V${y - Math.sign(y - inputY) * radius}Q${fork + radius} ${y} ${fork + 2 * radius} ${y}H${x - 24}`;
              const name = appNames[lang][i]!;
              return (
                <g
                  key={i}
                  className="output-route"
                  data-current={selected === i}
                  style={{ "--order": i } as React.CSSProperties}
                >
                  <path d={d} className="diagram-rail" />
                  <path key={selected} d={d} pathLength={1} className="diagram-signal" />
                  <Choice
                    x={x}
                    y={y}
                    active={i === selected}
                    title={name}
                    onClick={() => onSelect(i)}
                  >
                    <rect
                      className="choice-hit"
                      x={-24}
                      y={-28}
                      width={mobile ? 185 : 220}
                      height={56}
                      rx={3}
                    />
                    <g className="output-symbol">
                      <Output kind={i} />
                    </g>
                    <text className="diagram-name" x={mobile ? 28 : 34} y={4}>
                      {name}
                    </text>
                  </Choice>
                </g>
              );
            })}
            <circle cx={fork} cy={inputY} r="3.5" className="diagram-junction" />
            <text x={mobile ? 2 : 67} y={mobile ? 265 : 228} className="diagram-caption">
              PenguinHarness OS
            </text>
          </>
        );
      }}
    </Diagram>
  );
}

type Task = "coverage" | "filing" | "support" | "finance";
const agents = [
  {
    id: "coverage",
    en: "Coverage",
    zh: "核赔",
    symbol: "m0-10 9 3v6c0 5-4 8-9 11-5-3-9-6-9-11v-6Zm-4 9 3 3 5-6",
    phase: 14,
  },
  {
    id: "support",
    en: "Support",
    zh: "工单",
    symbol: "M-10-6h20v12H-2l-5 4V6h-3Zm5 5h9m-9 3h5",
    phase: 38,
  },
  {
    id: "finance",
    en: "Finance",
    zh: "财务",
    symbol: "M-9-7h18v15H-9Zm0 5H9M-4-1v9m5-6h4m-4 4h4",
    phase: 64,
  },
  {
    id: "filing",
    en: "Court filings",
    zh: "归档",
    symbol: "M-10-6h8l3 3h9V8h-20Zm2-1v-3H3l4 4v2",
    phase: 83,
  },
] as const;

export function EvolutionFigure({
  selected,
  onSelect,
  lang,
  decision,
}: {
  selected: Task;
  onSelect: (id: Task) => void;
  lang: "en" | "zh";
  decision: "baseline" | "candidate" | null;
}) {
  const zh = lang === "zh";
  const stages = zh ? ["评估", "改进", "复测"] : ["Evaluate", "Improve", "Retest"];
  return (
    <Diagram
      name={
        zh
          ? "四种任务的 Agent 在同一个平台各自循环评估和修订"
          : "Four task agents independently evaluate and revise on one platform"
      }
    >
      {(mobile) => {
        const steps = mobile ? [103, 166, 230] : [246, 350, 455];
        const rows = mobile ? [66, 120, 174, 228] : [61, 111, 161, 211];
        const left = mobile ? 25 : 68,
          right = mobile ? 269 : 543;
        const returnY = mobile ? 15 : 17;
        return (
          <>
            {stages.map((label, i) => (
              <g className="shared-gate" key={label}>
                <path d={`M${steps[i]} 31V${mobile ? 248 : 235}`} />
                <text x={steps[i]} y="19" textAnchor="middle" className="diagram-step">
                  {label}
                </text>
              </g>
            ))}
            {agents.map((agent, i) => {
              const y = rows[i]!,
                x = mobile ? 11 : 50,
                active = selected === agent.id;
              const route = `M${left} ${y}H${right - 8}q8 0 8 8t-8 ${returnY - 8}H${left + 14}q-14 0-14 -${returnY}Z`;
              const accessible = zh ? agent.zh + " Agent" : agent.en + " agent";
              return (
                <g
                  key={agent.id}
                  className="running-agent"
                  data-lane={agent.id}
                  data-active={active}
                >
                  <path className="shared-circuit" d={route} />
                  {steps.map((s) => (
                    <circle key={s} cx={s} cy={y} r="3.3" className="station-mark" />
                  ))}
                  <path className="return-head" d={`m${left + 36} ${y + returnY - 3} -5 3 5 3`} />
                  <circle
                    r={mobile ? 3.7 : 4.4}
                    className="running-pulse"
                    style={
                      {
                        offsetPath: `path("${route}")`,
                        "--rest": agent.phase + "%",
                        "--period": 4.9 + i * 0.45 + "s",
                        "--offset": (-agent.phase / 100) * (4.9 + i * 0.45) + "s",
                      } as React.CSSProperties
                    }
                  />
                  <Choice
                    x={x}
                    y={y}
                    active={active}
                    title={accessible}
                    onClick={() => onSelect(agent.id)}
                  >
                    <rect
                      className="choice-hit"
                      x={mobile ? -11 : -22}
                      y={-26}
                      width={mobile ? 87 : 144}
                      height={48}
                      rx={3}
                    />
                    <path className="task-mark" d={agent.symbol} />
                    <text x={mobile ? 16 : 20} y="-8" className="diagram-name">
                      {agent[lang]}
                    </text>
                  </Choice>
                </g>
              );
            })}
            <text
              x={mobile ? 146 : 350}
              y={mobile ? 272 : 252}
              textAnchor="middle"
              className="diagram-caption"
            >
              {decision
                ? decision === "candidate"
                  ? zh
                    ? "已保留候选版本"
                    : "Candidate kept"
                  : zh
                    ? "已恢复基线版本"
                    : "Baseline restored"
                : zh
                  ? "PenguinHarness RSI · 循环示意"
                  : "PenguinHarness RSI · illustrated loops"}
            </text>
          </>
        );
      }}
    </Diagram>
  );
}
