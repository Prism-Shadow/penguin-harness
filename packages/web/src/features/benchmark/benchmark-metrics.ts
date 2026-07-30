/**
 * Score-only data helpers and per-runtime series grouping for the Benchmark center chart.
 * Series share one time axis and use each Evaluation's authoritative stored Score.
 */

/** Minimal Evaluation shape needed to read Score (BenchmarkEvaluation is a superset). */
export interface MetricSourceLike {
  score: number;
}

/** Each Evaluation's Score; non-finite malformed values become chart gaps defensively. */
export function scoreValues(evaluations: readonly MetricSourceLike[]): (number | null)[] {
  return evaluations.map((e) => {
    return typeof e.score === "number" && Number.isFinite(e.score) ? e.score : null;
  });
}

/** A single data point on the chart: original index (x-axis position) + value. */
export interface MetricPoint {
  index: number;
  value: number;
}

/**
 * Splits a value sequence with gaps into **contiguous value-bearing** segments (each segment has
 * at least 1 point): points within a segment are connected, segments are broken apart; a
 * single-point segment draws only a point, no line.
 */
export function lineSegments(values: readonly (number | null)[]): MetricPoint[][] {
  const segments: MetricPoint[][] = [];
  let current: MetricPoint[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, value });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Y-axis upper bound: the max of value-bearing points (falls back to a tiny positive number when all values are missing / zero, to avoid dividing by zero in the coordinate system). */
export function metricMax(values: readonly (number | null)[]): number {
  return Math.max(1e-9, ...values.filter((v): v is number => v !== null));
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
