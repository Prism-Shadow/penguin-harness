/**
 * The self-evolution platform as one workbench: on the left, the Optimizer (an ordinary agent
 * running the agent-optimization Skill) and its Evaluator subagents (agent-evaluation) serve
 * several tested agents at once, each going round its own loop of evaluate, improve, retest and
 * next round; on the right, three numbers recorded across the kept versions. One clock drives both
 * halves: every tick closes one agent's round, which bumps that agent's version and moves all
 * three curves a notch, so accuracy rises and cost and duration fall as the loops turn.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { SiteGlyph, type SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { ScreenBar } from "../components/application-diagrams";
import { S } from "../lib/strings";
import { useVisibleActivity } from "../lib/visible-activity";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useWidth } from "../lib/use-width";
import { Section } from "../components/section";

/** Skill names are identifiers, the same in every language. */
const OPTIMIZER_SKILL = "agent-optimization";
const EVALUATOR_SKILL = "agent-evaluation";

/**
 * Illustrative values for seven kept versions, index-aligned with S.selfImprove.trends:
 * accuracy steadily rises while cost and duration gradually decrease across self-evolution rounds.
 */
const TRENDS: ReadonlyArray<{
  points: readonly number[];
  yTicks: readonly number[];
  format: (v: number) => string;
}> = [
  {
    points: [46, 53, 59, 65, 70, 75, 79],
    yTicks: [0, 50, 100],
    format: (v) => v.toFixed(1),
  },
  {
    points: [0.42, 0.36, 0.31, 0.27, 0.23, 0.19, 0.16],
    yTicks: [0, 0.25, 0.5],
    format: (v) => `$${v.toFixed(2)}`,
  },
  {
    points: [108, 94, 82, 72, 63, 55, 48],
    yTicks: [0, 60, 120],
    format: (v) => `${Math.round(v)}s`,
  },
];

/** The versions the curves record: every agent starts at the first and ends at the last. */
const VERSIONS = TRENDS[0]!.points.length;
const STAGES = S.selfImprove.workbench.stages.length;
/** One tick is one stage of one round. */
const TICK_MS = 500;
/** Ticks until every agent has reached the last version. */
const RUN_TICKS = (VERSIONS - 1) * STAGES;
/** The finished run rests this long, then the curves clear for one tick and the run starts over. */
const HOLD_TICKS = 3;
const CYCLE_TICKS = RUN_TICKS + HOLD_TICKS + 1;

/**
 * The shared clock. Agent `i` starts `i` stages into its first round, so the loops are never in
 * step. With as many agents as a round has stages, exactly one of them closes a round on each
 * tick, and the average version (what the curves plot) advances by the same step every time.
 * Reduced motion rests on the finished run; off screen the clock stops at its start.
 */
function useEvolutionClock(running: boolean, reduced: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!running) return;
    const timer = window.setInterval(() => setCount((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  if (reduced) return { tick: RUN_TICKS, turns: RUN_TICKS, clearing: false };
  const tick = Math.min(count % CYCLE_TICKS, RUN_TICKS);
  return {
    tick,
    // Every stage walked since the clock started: it only grows, so a loop's arrow never turns back.
    turns: Math.floor(count / CYCLE_TICKS) * RUN_TICKS + tick,
    clearing: running && count % CYCLE_TICKS === CYCLE_TICKS - 1,
  };
}

/** A short arrow between the two roles, with the message that travels along it. */
function FlowArrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 44 10"
      aria-hidden="true"
      className={`evo-flow ${back ? "evo-flow-back" : ""}`}
    >
      <path d="M1,5 H42 M37.5,1.5 L42,5 L37.5,8.5" />
      <circle cx="3" cy="5" r="2" />
    </svg>
  );
}

/** Where the connectors turn and end, in px: the bus's corner, and an arrowhead's reach. */
const LINK_CORNER = 8;
const LINK_HEAD = 4.5;

/**
 * The lines from the two roles down to the loops, drawn at the size they are shown at so every
 * corner and arrowhead keeps its shape: a trunk under each role, one bus across, and a drop that
 * ends in an arrowhead over each column of loops.
 */
function Links({
  className,
  width,
  height,
  bus,
  trunks,
  drops,
}: {
  className: string;
  width: number;
  height: number;
  /** How far down the bus runs, in px. */
  bus: number;
  /** Where the trunks and the drops stand, as fractions of the width. */
  trunks: readonly number[];
  drops: readonly number[];
}) {
  const at = (fraction: number) => Math.round(fraction * width) + 0.5;
  const end = height - 1;
  const first = at(drops[0]!);
  const last = at(drops[drops.length - 1]!);
  const d = [
    ...trunks.map((x) => `M${at(x)},0 V${bus}`),
    // The outer drops and the bus are one line, rounded where it turns.
    `M${first},${end} V${bus + LINK_CORNER} Q${first},${bus} ${first + LINK_CORNER},${bus} H${last - LINK_CORNER} Q${last},${bus} ${last},${bus + LINK_CORNER} V${end}`,
    ...drops.slice(1, -1).map((x) => `M${at(x)},${bus} V${end}`),
    ...drops.map(
      (x) =>
        `M${at(x) - LINK_HEAD},${end - LINK_HEAD} L${at(x)},${end} L${at(x) + LINK_HEAD},${end - LINK_HEAD}`,
    ),
  ].join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className}>
      <path d={d} />
    </svg>
  );
}

/**
 * The platform every tested agent shares: the Optimizer dispatches Evaluators and reads their
 * scores, and both reach down to each agent's loop through one bus.
 */
function Platform() {
  const c = S.selfImprove;
  const { ref, width } = useWidth<HTMLDivElement>(720);
  return (
    <div className="evo-platform" role="img" aria-label={c.diagramLabel}>
      <div className="evo-roles">
        <div className="evo-node evo-node-accent">
          <strong>{c.nodeOptimizer}</strong>
          <code>{OPTIMIZER_SKILL}</code>
        </div>
        <div className="evo-exchange">
          <span>
            {c.edgeSpawn}
            <FlowArrow />
          </span>
          <span>
            <FlowArrow back />
            {c.edgeFeedback}
          </span>
        </div>
        <div className="evo-node evo-node-stack">
          <strong>{c.nodeEvaluator}</strong>
          <code>{EVALUATOR_SKILL}</code>
        </div>
      </div>
      <div ref={ref} className="evo-links">
        {/* Four loops in a row under two roles side by side, or two columns under the stack. */}
        <Links
          className="evo-links-wide"
          width={width}
          height={80}
          bus={46}
          trunks={[1 / 4, 3 / 4]}
          drops={[1 / 8, 3 / 8, 5 / 8, 7 / 8]}
        />
        <Links
          className="evo-links-narrow"
          width={width}
          height={104}
          bus={70}
          trunks={[1 / 2]}
          drops={[1 / 4, 3 / 4]}
        />
        <span className="evo-link-labels">
          <span>{c.edgeImprove}</span>
          <span>{c.edgeBench}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Geometry of a loop: one arrow that goes most of the way round a circle, its head at the top
 * pointing clockwise. Turning it a quarter is one stage; a full turn is one round.
 */
const RING = 96;
const RING_RADIUS = 40;
const ARROW_SWEEP_DEG = 290;
const HEAD_PX = 6;
const HEAD_SPREAD_DEG = 36;

const fixed = (n: number) => n.toFixed(2);
const LOOP_ARROW = (() => {
  const centre = RING / 2;
  const top = centre - RING_RADIUS;
  const tail = ((360 - ARROW_SWEEP_DEG) * Math.PI) / 180;
  const spread = (HEAD_SPREAD_DEG * Math.PI) / 180;
  const barb = (side: number) =>
    `${fixed(centre - HEAD_PX * Math.cos(spread))},${fixed(top + side * HEAD_PX * Math.sin(spread))}`;
  return {
    line: `M${fixed(centre + RING_RADIUS * Math.sin(tail))},${fixed(centre - RING_RADIUS * Math.cos(tail))} A${RING_RADIUS},${RING_RADIUS} 0 1 1 ${centre},${top}`,
    head: `M${barb(-1)} L${centre},${top} L${barb(1)}`,
  };
})();

/**
 * What tells one tested agent from the next, index-aligned with S.selfImprove.workbench.tasks: a
 * glyph for its domain (coverage review, service tickets, financial control, court records) on a
 * tile in one of the App Center's shades, so the four differ by shape and shade and share the hue.
 */
const AGENT_MARKS: ReadonlyArray<{ glyph: SiteGlyphName; tone: string }> = [
  { glyph: "shieldCheck", tone: "brand" },
  { glyph: "bubbleLines", tone: "soft" },
  { glyph: "barChart", tone: "deep" },
  { glyph: "folderOpen", tone: "slate" },
];

/**
 * One tested agent going round its loop, its mark in the centre with the version under it. The
 * arrow turns a quarter with every stage, and each time its head comes back to the top a round
 * has closed and the version bumps.
 */
function AgentLoop({ index, tick, turns }: { index: number; tick: number; turns: number }) {
  const c = S.selfImprove.workbench;
  const task = c.tasks[index]!;
  const walked = tick + index;
  const stage = walked % STAGES;
  const version = 1 + Math.floor(walked / STAGES);
  const mark = AGENT_MARKS[index % AGENT_MARKS.length]!;
  return (
    <li data-agent-loop={task.name}>
      <span className="evo-ring">
        <svg viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
          <circle cx={RING / 2} cy={RING / 2} r={RING_RADIUS} className="evo-loop-track" />
          <g
            className="evo-loop-arrow"
            // The head ends this stage a quarter further on than it began it.
            style={{ transform: `rotate(${((turns + index + 1) * 360) / STAGES}deg)` }}
          >
            <path d={LOOP_ARROW.line} />
            <path d={LOOP_ARROW.head} />
          </g>
        </svg>
        <span className={`evo-agent-mark scene-app-tone-${mark.tone}`} aria-hidden="true">
          <SiteGlyph name={mark.glyph} />
        </span>
        <span className="evo-version" key={version} data-agent-version="">
          {`v${version}`}
        </span>
      </span>
      <strong>{task.name}</strong>
      <small>{task.task}</small>
      <span className="evo-stage" aria-current="step">
        {c.activeStages[stage]}
      </span>
    </li>
  );
}

/**
 * One recorded number across the versions, with hairline axes and ticks. `progress` is how far
 * along the versions the agents are on average: the line is drawn up to it and the value rides on
 * its head. The chart is laid out at the width it is shown at, so its labels keep the page's
 * small size.
 */
function TrendChart({
  label,
  hint,
  points,
  yTicks,
  progress,
  format,
}: {
  label: string;
  hint: string;
  points: readonly number[];
  yTicks: readonly number[];
  progress: number;
  format: (v: number) => string;
}) {
  const { ref: box, width: W } = useWidth<HTMLDivElement>(240);
  const H = 96;
  const M = { left: 34, right: 14, top: 20, bottom: 22 };
  const yMax = Math.max(...yTicks);
  const yMin = Math.min(...yTicks);
  const last = points.length - 1;
  const px = (i: number) => M.left + (i / last) * (W - M.left - M.right);
  const py = (v: number) => M.top + ((yMax - v) / (yMax - yMin || 1)) * (H - M.top - M.bottom);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`).join(" ");
  const xTicks = [0, Math.round(last / 2), last];

  const at = progress * last;
  const i0 = Math.min(last - 1, Math.floor(at));
  const value = points[i0]! + (points[i0 + 1]! - points[i0]!) * (at - i0);
  const x = px(at);
  const y = py(value);
  // The dash is measured along the line, the head along the axis: convert, or the line's end
  // drifts off the head wherever the slope changes.
  const lengths = points.map((v, i) =>
    i === 0 ? 0 : Math.hypot(px(i) - px(i - 1), py(v) - py(points[i - 1]!)),
  );
  const drawn =
    lengths.slice(0, i0 + 1).reduce((sum, n) => sum + n, 0) + lengths[i0 + 1]! * (at - i0);
  const whole = lengths.reduce((sum, n) => sum + n, 0);
  const valueX = Math.min(W - M.right - 12, Math.max(M.left + 14, x));
  const valueY = Math.max(12, y - 10);

  return (
    <figure className="evo-trend">
      <figcaption>
        <strong>{label}</strong>
        <span>{hint}</span>
      </figcaption>
      <div ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          <path
            d={`M${M.left},${M.top} V${H - M.bottom} H${W - M.right}`}
            className="evo-chart-axis"
          />
          {yTicks.map((t) => (
            <g key={t}>
              <path d={`M${M.left - 3},${py(t)} H${M.left}`} className="evo-chart-axis" />
              <text x={M.left - 6} y={py(t) + 4} textAnchor="end" className="evo-chart-tick">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <g key={i}>
              <path d={`M${px(i)},${H - M.bottom} v3`} className="evo-chart-axis" />
              <text x={px(i)} y={H - M.bottom + 16} textAnchor="middle" className="evo-chart-tick">
                {`v${i + 1}`}
              </text>
            </g>
          ))}
          <path d={path} className="evo-chart-track" />
          <g className="evo-chart-plot">
            <path
              d={path}
              pathLength={1}
              className="evo-chart-line"
              style={{ strokeDashoffset: 1 - drawn / whole }}
            />
            <g className="evo-chart-head" style={{ transform: `translate(${x}px, ${y}px)` }}>
              <circle r={5} />
              <circle r={3.5} />
            </g>
            <g
              className="evo-chart-value"
              style={{ transform: `translate(${valueX}px, ${valueY}px)` }}
            >
              <text textAnchor="middle">{format(value)}</text>
            </g>
          </g>
        </svg>
      </div>
    </figure>
  );
}

export function SelfImprove() {
  const c = S.selfImprove;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = active && !reduced;
  const { tick, turns, clearing } = useEvolutionClock(running, reduced);
  return (
    <Section id="self-evolution" title={c.title} subtitle={c.subtitle}>
      <div
        ref={ref}
        className="product-scene product-scene-evolution"
        data-story-diagram=""
        data-active={running}
        // The curves move between ticks; on the first tick of a run they are simply placed.
        data-advancing={(running && tick > 0) || undefined}
        data-clearing={clearing || undefined}
        style={{ "--evo-tick": `${TICK_MS}ms` } as CSSProperties}
        role="group"
        aria-label={c.workbench.title}
      >
        <ScreenBar icon="trophy" title={c.workbench.title} />
        <div className="evo-body">
          <div className="scene-workflow-pane">
            <Platform />
            <ul className="evo-loops" aria-label={c.nodeTarget}>
              {c.workbench.tasks.map((task, index) => (
                <AgentLoop key={task.name} index={index} tick={tick} turns={turns} />
              ))}
            </ul>
            <p className="evo-notes">
              <span>{c.noteOld}</span>
              <span>{c.noteNew}</span>
            </p>
          </div>
          <div className="evo-trends">
            <p className="evo-trends-title">{c.sampleTrends}</p>
            {c.trends.map((t, i) => {
              const data = TRENDS[i];
              if (!data) return null;
              return (
                <TrendChart
                  key={t.label}
                  label={t.label}
                  hint={t.hint}
                  points={data.points}
                  yTicks={data.yTicks}
                  progress={tick / RUN_TICKS}
                  format={data.format}
                />
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
