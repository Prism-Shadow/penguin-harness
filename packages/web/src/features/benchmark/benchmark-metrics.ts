/**
 * Score-only data helpers and per-runtime series grouping for the Benchmark center chart.
 * Series share one time axis and use each Evaluation's authoritative stored Score.
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

/** Minimal evaluation shape needed for series grouping (BenchmarkEvaluation is a superset). */
export interface ModelRefLike {
  modelId?: string;
  thinkingLevel?: string;
}

/** One chart series: the set of evaluations sharing the same (modelId, thinkingLevel). */
export interface EvaluationSeries {
  /** Grouping key (internal grouping only, not used as an id; empty string for untagged model). */
  key: string;
  modelId?: string;
  thinkingLevel?: string;
  /** Matching evaluation indices: global time-axis positions, shared across all series on the same x-axis. */
  indices: number[];
}

/**
 * Groups evaluations into series by model ID and thinking level, deliberately ignoring provider.
 * Runtime combinations are ordered by first appearance (color is picked from SERIES_COLORS by
 * series index); defensive records with no model tag are grouped into a trailing unnamed series.
 */
export function modelSeries(evaluations: readonly ModelRefLike[]): EvaluationSeries[] {
  const map = new Map<string, EvaluationSeries>();
  evaluations.forEach((e, index) => {
    const labeled = e.modelId !== undefined && e.modelId !== "";
    const key = labeled ? `${e.modelId}\u0000${e.thinkingLevel ?? ""}` : "";
    let series = map.get(key);
    if (!series) {
      series = {
        key,
        ...(labeled && e.modelId !== undefined ? { modelId: e.modelId } : {}),
        ...(labeled && e.thinkingLevel !== undefined ? { thinkingLevel: e.thinkingLevel } : {}),
        indices: [],
      };
      map.set(key, series);
    }
    series.indices.push(index);
  });
  const all = [...map.values()];
  return [...all.filter((x) => x.key !== ""), ...all.filter((x) => x.key === "")];
}

/** A series' Score sequence; indices outside this series are null, keeping the global time axis. */
export function seriesValues(
  evaluations: readonly (MetricSourceLike & ModelRefLike)[],
  series: EvaluationSeries,
): (number | null)[] {
  const own = new Set(series.indices);
  return scoreValues(evaluations).map((v, i) => (own.has(i) ? v : null));
}
