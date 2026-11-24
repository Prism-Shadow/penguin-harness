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

type Task = "coverage" | "filing";
function AgentMark({ id }: { id: Task }) {
  return id === "coverage" ? (
    <g className="agent-symbol">
      <path d="m0 -12 11 4v8c0 5-6 10-11 13-5-3-11-8-11-13v-8Z" />
      <path d="m-5 0 3 3 7-7" />
    </g>
  ) : (
    <g className="agent-symbol">
      <path d="M-13 -7h10l3 4h12v13h-25zM-10 -8v-4H4l5 5v4" />
      <path d="M-6 2h11" />
    </g>
  );
}

function Stage({
  x,
  y,
  i,
  name,
  mobile,
}: {
  x: number;
  y: number;
  i: number;
  name: string;
  mobile: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y})`} className="flow-stage">
      <circle r={14} />
      {i === 1 ? (
        <path d="m-5 5 1-4 6-6 3 3-6 6z" />
      ) : i === 2 ? (
        <path d="m-6 0 4 4 8-9" />
      ) : (
        <g>
          <path d="m-6 3 4-5 3 3 5-7" />
          <path d="M-6 7h12" />
        </g>
      )}
      <text
        className="diagram-step"
        x={mobile ? 23 : 0}
        y={mobile ? 4 : 34}
        textAnchor={mobile ? "start" : "middle"}
      >
        {name}
      </text>
    </g>
  );
}

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
  const ids: Task[] = ["coverage", "filing"];
  const labels = zh ? ["核赔 Agent", "归档 Agent"] : ["Coverage agent", "Filing agent"];
  const stages = zh ? ["评估", "改进", "复测"] : ["Evaluate", "Improve", "Retest"];
  return (
    <Diagram
      name={
        zh
          ? "两个 Agent 在同一平台评估并返回各自版本"
          : "Two agents evaluate on one platform and return to their own versions"
      }
    >
      {(mobile) => (
        <>
          {ids.map((id, i) => {
            const active = id === selected,
              x = mobile ? [68, 212][i]! : 65,
              y = mobile ? 36 : [57, 203][i]!;
            const incoming = mobile
              ? i === 0
                ? "M68 64v9q0 14 14 14h39q19 0 19 20"
                : "M212 64v9q0 14-14 14h-39q-19 0-19 20"
              : i === 0
                ? "M84 57h62q22 0 22 22v24q0 22 25 22h18"
                : "M84 203h62q22 0 22-22v-31q0-25 25-25h18";
            const returning = mobile
              ? i === 0
                ? "M140 216v18q0 19-18 19H32q-18 0-18-18V55q0-19 20-19h12"
                : "M140 216v18q0 19 18 19h90q18 0 18-18V55q0-19-20-19h-12"
              : i === 0
                ? "M446 125h24q26 0 26-25V48q0-25-25-25H83q-18 0-18 16"
                : "M446 125h24q26 0 26 25v62q0 25-25 25H83q-18 0-18-16";
            return (
              <g key={id} className="agent-route" data-current={active} data-agent={id}>
                <path className="route-out" d={returning} />
                <path className="route-in" d={incoming} />
                <path
                  className="route-arrow"
                  d={
                    mobile
                      ? i === 0
                        ? "m41 33 5 3-5 3"
                        : "m239 33-5 3 5 3"
                      : i === 0
                        ? "m62 34 3 5 3-5"
                        : "m62 226 3-5 3 5"
                  }
                />
                <Choice x={x} y={y} active={active} title={labels[i]!} onClick={() => onSelect(id)}>
                  <rect
                    className="choice-hit"
                    x={mobile ? -43 : -25}
                    y="-20"
                    width={mobile ? 86 : 170}
                    height={mobile ? 47 : 42}
                    rx="4"
                  />
                  <AgentMark id={id} />
                  <text
                    className="diagram-name"
                    x={mobile ? 0 : 21}
                    y={mobile ? 24 : -10}
                    textAnchor={mobile ? "middle" : "start"}
                  >
                    {labels[i]}
                  </text>
                </Choice>
              </g>
            );
          })}
          <g className="common-run" key={selected}>
            <path d={mobile ? "M140 108v105" : "M201 125h252"} className="common-line" />
            <path
              d={mobile ? "M140 108v105" : "M201 125h252"}
              className="diagram-signal"
              pathLength={1}
            />
            {stages.map((s, i) => (
              <Stage
                key={s}
                i={i}
                name={s}
                x={mobile ? 140 : [223, 326, 430][i]!}
                y={mobile ? [111, 161, 212][i]! : 125}
                mobile={mobile}
              />
            ))}
          </g>
          <text
            x={mobile ? 140 : 326}
            y={mobile ? 273 : 85}
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
              : "PenguinHarness RSI"}
          </text>
        </>
      )}
    </Diagram>
  );
}
