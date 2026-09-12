/**
 * Score-only data helpers and per-label series grouping for the Benchmark center chart.
 * Series share one time axis and use each Evaluation's authoritative stored Score. A record's
 * label — the tested Agent, the model it ran on and the thinking level — is what makes two
 * scores comparable, so it is what a series is keyed by and what a score change is measured
 * within. The Agent State version is not part of it: successive versions of one agent on one
 * runtime are the trend the loop exists to show, so they stay on one line, and each point
 * carries its version in the chart's hover label and in the evaluation table's own column.
 */

/** Minimal Evaluation shape needed to read Score (BenchmarkEvaluation is a superset). */
export interface MetricSourceLike {
  score: number;
}

/** Each Evaluation's authoritative stored Score; non-finite malformed values become chart gaps. */
export function scoreValues(evaluations: readonly MetricSourceLike[]): (number | null)[] {
  return evaluations.map((e) => {
    return typeof e.score === "number" && Number.isFinite(e.score) ? e.score : null;
  });
}

export interface ScoreScale {
  min: number;
  max: number;
  ticks: number[];
}

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const SCORE_PADDING = 10;
const SCORE_TICK_STEPS = [1, 2, 2.5, 5, 10, 20];

/**
 * Dynamic Score domain: pad the observed min/max by 10, clamp to the valid
 * 0..100 Score interval, then round outward to human-friendly ticks.
 */
export function scoreScale(values: readonly (number | null)[]): ScoreScale {
  const present = values.filter(
    (value): value is number => value !== null && value >= SCORE_MIN && value <= SCORE_MAX,
  );
  if (present.length === 0) {
    return { min: SCORE_MIN, max: SCORE_MAX, ticks: [0, 20, 40, 60, 80, 100] };
  }

  const observedMin = Math.min(...present);
  const observedMax = Math.max(...present);
  const paddedMin = Math.max(SCORE_MIN, observedMin - SCORE_PADDING);
  const paddedMax = Math.min(SCORE_MAX, observedMax + SCORE_PADDING);
  const step = SCORE_TICK_STEPS.find((candidate) => (paddedMax - paddedMin) / candidate <= 5)!;
  const min = Math.max(SCORE_MIN, Math.floor(paddedMin / step) * step);
  const max = Math.min(SCORE_MAX, Math.ceil(paddedMax / step) * step);
  const ticks = Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, index) => min + index * step,
  );
  return { min, max, ticks };
}

/** Minimal evaluation shape a label is read from (BenchmarkEvaluation is a superset). */
export interface EvaluationLabelLike {
  /** The Agent under test; null or absent on records written before Benchmarks left the Agent. */
  agentId?: string | null;
  /** On the record and deliberately outside the key: a version is a point on a series, not a series. */
  version?: number;
  /** On the record and deliberately outside the key — see evaluationLabel. */
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

/** One evaluation's label: its series key, the text a legend prints, and whether it is untagged. */
export interface EvaluationLabel {
  /** Grouping key; "" for a record missing the tested Agent or the model. */
  key: string;
  /** Legend text, empty parts omitted; "" when the record is unlabeled — the caller names that series. */
  text: string;
  unlabeled: boolean;
}

/**
 * The label of one evaluation: the tested Agent, the model and the thinking level, keyed and
 * printed as the same three parts. Two fields the record also carries stay outside the key. The
 * Agent State version is what a series is watched across — keying on it would cut the line into
 * one point per version, exactly where an improvement is meant to become visible. The provider
 * is outside it because a series has to be identifiable from its legend text, and that text
 * prints the model id a reader recognizes rather than the group it is served from. A record
 * with no tested Agent or no model cannot be placed on either axis of comparison, so it is
 * unlabeled and shares one series.
 */
export function evaluationLabel(e: EvaluationLabelLike): EvaluationLabel {
  const agentId = e.agentId ?? "";
  const modelId = e.modelId ?? "";
  if (agentId === "" || modelId === "") return { key: "", text: "", unlabeled: true };
  const parts = [agentId, modelId, e.thinkingLevel ?? ""];
  return {
    key: parts.join("\u0000"),
    text: parts.filter((part) => part !== "").join(" · "),
    unlabeled: false,
  };
}

/** One chart series: the evaluations sharing one label. */
export interface EvaluationSeries {
  /** Grouping key (internal grouping only, not used as an id; "" for the unlabeled series). */
  key: string;
  /** Legend text; "" for the unlabeled series. */
  text: string;
  unlabeled: boolean;
  /** Matching evaluation indices: global time-axis positions, shared across all series on the same x-axis. */
  indices: number[];
}

/**
 * Groups evaluations into series by label, ordered by first appearance (color is picked from
 * SERIES_COLORS by series index); records with no label are grouped into a trailing gray series.
 */
export function labelSeries(evaluations: readonly EvaluationLabelLike[]): EvaluationSeries[] {
  const map = new Map<string, EvaluationSeries>();
  evaluations.forEach((e, index) => {
    const label = evaluationLabel(e);
    let series = map.get(label.key);
    if (!series) {
      series = { key: label.key, text: label.text, unlabeled: label.unlabeled, indices: [] };
      map.set(label.key, series);
    }
    series.indices.push(index);
  });
  const all = [...map.values()];
  return [...all.filter((x) => !x.unlabeled), ...all.filter((x) => x.unlabeled)];
}

/** A series' Score sequence; indices outside this series are null, keeping the global time axis. */
export function seriesValues(
  evaluations: readonly (MetricSourceLike & EvaluationLabelLike)[],
  series: EvaluationSeries,
): (number | null)[] {
  const own = new Set(series.indices);
  return scoreValues(evaluations).map((v, i) => (own.has(i) ? v : null));
}

/** Minimal evaluation shape for the list rows: the stored Score and when it was recorded. */
export interface TrendSourceLike extends MetricSourceLike {
  time: string;
}

/** Finite Scores in scoreboard order — the row sparkline's series (a malformed value is skipped, never drawn as zero). */
export function sparklineSeries(evaluations: readonly MetricSourceLike[]): number[] {
  return scoreValues(evaluations).filter((v): v is number => v !== null);
}

export interface LatestScore {
  score: number;
  /** Change from the previous finite Score carrying the same label; null when that label has no earlier record. */
  delta: number | null;
  /** When the newest scored evaluation was recorded. */
  time: string;
}

/**
 * The newest finite Score, its time, and its change from the previous score of the same label.
 * Only same-label scores are comparable — another agent, another model or another thinking
 * level is a different measurement — so a newest record whose label appears for the first time
 * reports no change at all rather than a difference against something else. A new Agent State
 * version of the same agent on the same runtime is the comparison this number exists for, and
 * is measured, not excluded.
 */
export function latestWithDelta(
  evaluations: readonly (TrendSourceLike & EvaluationLabelLike)[],
): LatestScore | null {
  const scored = evaluations.filter((e) => typeof e.score === "number" && Number.isFinite(e.score));
  const last = scored[scored.length - 1];
  if (!last) return null;
  const key = evaluationLabel(last).key;
  let previous: (TrendSourceLike & EvaluationLabelLike) | undefined;
  for (let i = scored.length - 2; i >= 0; i -= 1) {
    if (evaluationLabel(scored[i]!).key === key) {
      previous = scored[i];
      break;
    }
  }
  return {
    score: last.score,
    delta: previous ? last.score - previous.score : null,
    time: last.time,
  };
}

/** The same, narrowed to one tested Agent: the baseline the optimize dialog works from. */
export function latestScoreOfAgent(
  evaluations: readonly (TrendSourceLike & EvaluationLabelLike)[],
  agentId: string,
): LatestScore | null {
  if (agentId === "") return null;
  return latestWithDelta(evaluations.filter((e) => (e.agentId ?? "") === agentId));
}

/**
 * Default optimization target: ten points above the baseline as a whole number, capped at the
 * 100-point scale; 80 when nothing is scored yet (the optimizer then still needs a baseline,
 * which the dialog says out loud).
 */
export function defaultTargetScore(baseline: number | null): number {
  if (baseline === null) return 80;
  return Math.min(100, Math.ceil(baseline) + 10);
}

/**
 * Whether a row survives the search box: a case-insensitive substring of its title, description
 * or id, or of any tested Agent's id or name. Names are looked up in the Project's agent list;
 * an id evaluated by a since-deleted Agent still matches on the id itself.
 */
export function matchesBenchmarkQuery(
  benchmark: { id: string; title: string; description?: string; agentIds?: readonly string[] },
  agents: readonly { agentId: string; name?: string }[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [benchmark.title, benchmark.description ?? "", benchmark.id];
  for (const agentId of benchmark.agentIds ?? []) {
    haystack.push(agentId);
    const name = agents.find((a) => a.agentId === agentId)?.name;
    if (name !== undefined) haystack.push(name);
  }
  return haystack.some((s) => s.toLowerCase().includes(q));
}
