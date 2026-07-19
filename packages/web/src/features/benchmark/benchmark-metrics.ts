/**
 * Metric switching and per-model series grouping for the Benchmark center chart (pure functions,
 * easy to unit test): the chart can switch between the score / cost / duration metrics (sharing
 * the same time axis), and is grouped into series by each evaluation's (provider, modelId) — one
 * color per series, legend by model. score is always present;
 * cost / durationMs are optional — missing values are **skipped points**: neither drawn nor
 * connected, so the line breaks at the gap (lineSegments splits value-bearing indices into
 * contiguous segments).
 */

export type BenchmarkMetric = "score" | "cost" | "duration";

export const BENCHMARK_METRICS: readonly BenchmarkMetric[] = ["score", "cost", "duration"];

/** Minimal evaluation shape needed to read a metric (BenchmarkEvaluation is a superset). */
export interface MetricSourceLike {
  score: number;
  cost?: number;
  durationMs?: number;
}

/** Each evaluation's value under the selected metric; missing (cost / durationMs not recorded) is null (skipped point). */
export function metricValues(
  evaluations: readonly MetricSourceLike[],
  metric: BenchmarkMetric,
): (number | null)[] {
  return evaluations.map((e) => {
    const v = metric === "score" ? e.score : metric === "cost" ? e.cost : e.durationMs;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
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
  provider?: string;
  modelId?: string;
}

/** One chart series: the set of evaluations sharing the same (provider, modelId) (older records with no model tag are grouped into a single series). */
export interface EvaluationSeries {
  /** Grouping key (internal grouping only, not used as an id; empty string for untagged model). */
  key: string;
  provider?: string;
  modelId?: string;
  /** Matching evaluation indices: global time-axis positions, shared across all series on the same x-axis. */
  indices: number[];
}

/**
 * Groups evaluations into series by the model they carry: models are ordered by first
 * appearance (color is picked from SERIES_COLORS by series index, so color follows the model and
 * doesn't change with filtering); older records with no model tag are grouped into a trailing
 * unnamed series (shown in gray, labeled "untagged model").
 */
export function modelSeries(evaluations: readonly ModelRefLike[]): EvaluationSeries[] {
  const map = new Map<string, EvaluationSeries>();
  evaluations.forEach((e, index) => {
    const labeled = e.modelId !== undefined && e.modelId !== "";
    const key = labeled ? `${e.provider ?? ""}\u0000${e.modelId}` : "";
    let series = map.get(key);
    if (!series) {
      series = {
        key,
        ...(labeled && e.provider !== undefined ? { provider: e.provider } : {}),
        ...(labeled && e.modelId !== undefined ? { modelId: e.modelId } : {}),
        indices: [],
      };
      map.set(key, series);
    }
    series.indices.push(index);
  });
  const all = [...map.values()];
  return [...all.filter((x) => x.key !== ""), ...all.filter((x) => x.key === "")];
}

/** A series' value sequence under the selected metric: indices outside this series are null (skipped point), keeping the global time axis. */
export function seriesValues(
  evaluations: readonly (MetricSourceLike & ModelRefLike)[],
  series: EvaluationSeries,
  metric: BenchmarkMetric,
): (number | null)[] {
  const own = new Set(series.indices);
  return metricValues(evaluations, metric).map((v, i) => (own.has(i) ? v : null));
}
