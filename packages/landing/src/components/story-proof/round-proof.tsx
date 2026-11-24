import { useState } from "react";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { Link } from "react-router";
import { EvolutionFigure } from "./platform-figures";
import { trials } from "./examples";
import { S } from "../../lib/strings";
import "./proof.css";

export function RoundProof() {
  const { locale } = useSiteLocale();
  const zh = locale === "zh";
  const [key, setKey] = useState<keyof typeof trials>("coverage");
  const [version, setVersion] = useState<"before" | "after">("after");
  const trial = trials[key],
    content = trial[locale];
  const other = trials[key === "coverage" ? "filing" : "coverage"];
  const [decision, setDecision] = useState<"baseline" | "candidate" | null>(null);
  const y = (score: number) => 178 - score * 1.35;
  const latest = version === "after";
  const [expanded, setExpanded] = useState(false);
  const choose = (id: keyof typeof trials) => {
    setKey(id);
    setVersion("after");
    setDecision(null);
  };
  return (
    <section id="self-evolution" className="proof-section">
      <header>
        <h2>{S.selfImprove.title}</h2>
      </header>
      <div className="proof-platform">
        <div className="proof-platform-copy">
          <span className="proof-kicker">
            {zh ? "同一套评估与复测" : "One evaluation platform"}
          </span>
          <p>{content.task}</p>
          <button
            className="proof-open"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? zh
                ? "收起这一轮"
                : "Close this round"
              : zh
                ? "查看这一轮的改动"
                : "Inspect this round"}{" "}
            ↗
          </button>
        </div>
        <div className="proof-illustration">
          <EvolutionFigure lang={locale} selected={key} onSelect={choose} decision={decision} />
          <div
            className="proof-pick proof-switch"
            role="group"
            aria-label={zh ? "选择 Agent 的工作" : "Select the agent’s work"}
          >
            {(Object.keys(trials) as (keyof typeof trials)[]).map((id) => (
              <button key={id} type="button" aria-pressed={key === id} onClick={() => choose(id)}>
                {trials[id][locale].task}
              </button>
            ))}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="proof-stage proof-round proof-detail">
          <div className="proof-trial">
            <p>{latest ? content.change : content.material}</p>
            <span className="proof-kicker">{trial.method} · GDPEVO Essential</span>
          </div>
          <div className="proof-trace">
            <div className="proof-trace-title">
              {zh ? "留出案例复测" : "Retest on held-out cases"}
            </div>
            <svg
              viewBox="0 0 360 218"
              role="img"
              aria-label={
                (zh ? "留出集平均分：" : "Held-out mean scores: ") +
                trial.before.toFixed(2) +
                " → " +
                trial.after.toFixed(2)
              }
            >
              <defs>
                <pattern id="proof-rules" width="15" height="17" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r=".8" fill="currentColor" />
                </pattern>
              </defs>
              <rect
                className="trace-paper"
                x="15"
                y="7"
                width="330"
                height="159"
                fill="url(#proof-rules)"
              />
              <path className="trace-rule" d="M30 165H331" />
              <path
                className="trace-other"
                d={`M45 ${y(other.before)} C140 ${y(other.before)} 210 ${y(other.after)} 312 ${y(other.after)}`}
              />
              <g className="trace-version">
                <path
                  className="trace-shade"
                  d={`M45 ${y(trial.before)} C140 ${y(trial.before)} 210 ${y(trial.after)} 312 ${y(trial.after)} V164H45Z`}
                />
                <path
                  className="trace-line"
                  d={`M45 ${y(trial.before)} C140 ${y(trial.before)} 210 ${y(trial.after)} 312 ${y(trial.after)}`}
                />
              </g>
              <circle
                className="trace-dot"
                data-selected={!latest}
                cx="45"
                cy={y(trial.before)}
                r="5"
              />
              <circle
                className="trace-dot"
                data-selected={latest}
                cx="312"
                cy={y(trial.after)}
                r="5"
              />
              <text className="trace-value" x="34" y={y(trial.before) - 15}>
                {trial.before.toFixed(2)}
              </text>
              <text className="trace-value" x="324" textAnchor="end" y={y(trial.after) - 15}>
                {trial.after.toFixed(2)}
              </text>
              <text className="trace-label" x="34" y="194">
                {zh ? "基线" : "Baseline"}
              </text>
              <text className="trace-label" x="324" y="194" textAnchor="end">
                {zh ? "候选版本" : "Candidate"}
              </text>
            </svg>
            <div
              className="proof-pick proof-versions"
              role="group"
              aria-label={zh ? "查看版本" : "Inspect version"}
            >
              {(["before", "after"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={version === value}
                  onClick={() => setVersion(value)}
                >
                  {value === "before"
                    ? zh
                      ? "查看基线"
                      : "Inspect baseline"
                    : zh
                      ? "查看改动"
                      : "Inspect change"}
                </button>
              ))}
            </div>
          </div>
          <div className="proof-decision">
            <span aria-live="polite">
              {decision === null
                ? zh
                  ? "根据复测选择要保留的版本"
                  : "Choose which version to keep after the retest"
                : decision === "baseline"
                  ? zh
                    ? "示例已恢复基线"
                    : "Baseline restored in this example"
                  : zh
                    ? "示例已保留候选版本"
                    : "Candidate kept in this example"}
            </span>
            <div
              className="proof-pick"
              role="group"
              aria-label={zh ? "示例中的版本选择" : "Version to keep in this example"}
            >
              <button
                type="button"
                aria-pressed={decision === "baseline"}
                onClick={() => {
                  setDecision("baseline");
                  setVersion("before");
                }}
              >
                {zh ? "恢复基线" : "Restore baseline"}
              </button>
              <button
                type="button"
                aria-pressed={decision === "candidate"}
                onClick={() => {
                  setDecision("candidate");
                  setVersion("after");
                }}
              >
                {zh ? "保留候选" : "Keep candidate"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="proof-source">
        <span>
          {zh
            ? "分数来自已发表实验的留出集，按任务取平均。"
            : "Mean held-out scores from the published experiment."}
        </span>
        <Link to="/blog/gdpevo-self-evolution">
          {zh ? "查看原始对照表" : "Read the original comparison"} ↗
        </Link>
      </div>
    </section>
  );
}
