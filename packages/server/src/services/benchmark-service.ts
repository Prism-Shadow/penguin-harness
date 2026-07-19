/**
 * Benchmark score reading (read-only display): walks `benchmarks/<id>/`, reads
 * `benchmark_config.toml` (title,
 * description, evaluation Model, per-case run count `runs`) and `scoreboard.yaml`
 * (evaluations[], scoreboard v2: each case carries a runs array and a summary).
 * Content is created and refined by benchmark_builder; the server only reads it.
 * Missing or corrupt files always degrade gracefully (title falls back to the
 * directory name, scores come back empty) rather than throwing.
 *
 * The three per-case metrics trust the file's own values; when missing they're
 * computed as the average over the runs array. The old format (no runs at the
 * case level, a single session_id) is parsed as a single run — the server backfills
 * one run entry.
 * Docs: /docs/self-improvement § "Benchmark storage".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { benchmarksDir } from "@prismshadow/penguin-core";
import type {
  BenchmarkCaseScore,
  BenchmarkEvaluation,
  BenchmarkRunScore,
  BenchmarkSummary,
  BenchmarksResponse,
} from "../api/types.js";

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function numberOr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringOr(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Shapes a single run entry: score is the minimum requirement, other fields tolerate being absent; a bad entry returns null and is dropped. */
function toRun(v: unknown): BenchmarkRunScore | null {
  const r = asRecord(v);
  const score = numberOr(r.score);
  if (score === undefined) return null;
  const cost = numberOr(r.cost);
  const durationMs = numberOr(r.duration_ms);
  const sessionId = stringOr(r.session_id);
  return {
    score,
    ...(cost !== undefined ? { cost } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

/** Average of a metric across runs; undefined when there's no value at all (never forced to 0). */
function averageOf(runs: BenchmarkRunScore[], pick: (r: BenchmarkRunScore) => number | undefined) {
  const values = runs.map(pick).filter((v): v is number => v !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Shapes a case-level entry (scoreboard v2): the three metrics trust the file's own
 * values, falling back to an average over runs when missing; the old format (no
 * runs, a single case-level session_id) is backfilled into a single run. case and a
 * score (from the file or derivable from runs) are the minimum requirement,
 * otherwise the entry is dropped.
 */
function toCase(v: unknown): BenchmarkCaseScore | null {
  const cr = asRecord(v);
  const caseId = stringOr(cr.case);
  if (caseId === undefined) return null;
  const parsedRuns = Array.isArray(cr.runs)
    ? cr.runs.map(toRun).filter((r): r is BenchmarkRunScore => r !== null)
    : [];
  const score = numberOr(cr.score) ?? averageOf(parsedRuns, (r) => r.score);
  if (score === undefined) return null;
  const cost = numberOr(cr.cost) ?? averageOf(parsedRuns, (r) => r.cost);
  const durationMs = numberOr(cr.duration_ms) ?? averageOf(parsedRuns, (r) => r.durationMs);
  const sessionId = stringOr(cr.session_id);
  const runs: BenchmarkRunScore[] =
    parsedRuns.length > 0
      ? parsedRuns
      : [
          // The old format is parsed as a single run: the case-level values are that run's raw result.
          {
            score,
            ...(cost !== undefined ? { cost } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(sessionId !== undefined ? { sessionId } : {}),
          },
        ];
  return {
    case: caseId,
    score,
    ...(cost !== undefined ? { cost } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    runs,
  };
}

/** Shapes a single evaluation record: time and score are the minimum requirement, other fields (summary, etc.) tolerate being absent. */
function toEvaluation(v: unknown): BenchmarkEvaluation | null {
  const r = asRecord(v);
  const time = r.time instanceof Date ? r.time.toISOString() : r.time;
  const score = numberOr(r.score);
  if (typeof time !== "string" || time === "" || score === undefined) return null;
  const cases: BenchmarkCaseScore[] = Array.isArray(r.cases)
    ? r.cases.map(toCase).filter((c): c is BenchmarkCaseScore => c !== null)
    : [];
  const summary = stringOr(r.summary);
  // Title and body are separate: summary_title is a one-line
  // conclusion, summary is the body text.
  const summaryTitle = stringOr(r.summary_title);
  // The Model actually used for this evaluation run (paired with provider):
  // charted curves are split into series by model, each with a distinct color.
  const modelId = stringOr(r.model_id);
  const provider = stringOr(r.provider);
  const version = numberOr(r.version);
  const cost = numberOr(r.cost);
  const durationMs = numberOr(r.duration_ms);
  return {
    time,
    ...(summaryTitle !== undefined ? { summaryTitle } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(provider !== undefined ? { provider } : {}),
    score,
    ...(version !== undefined ? { version } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    cases,
  };
}

export class BenchmarkService {
  constructor(private readonly root: string) {}

  async list(projectId: string, agentId: string): Promise<BenchmarksResponse> {
    const dir = benchmarksDir(this.root, projectId, agentId);
    let items: Array<{ name: string; isDir: boolean }>;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      items = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return { benchmarks: [] }; // Doesn't exist when unconfigured.
    }
    const benchmarks: BenchmarkSummary[] = [];
    for (const item of items.filter((i) => i.isDir).sort((a, b) => a.name.localeCompare(b.name))) {
      benchmarks.push(await this.readBenchmark(path.join(dir, item.name), item.name));
    }
    return { benchmarks };
  }

  private async readBenchmark(benchDir: string, id: string): Promise<BenchmarkSummary> {
    // benchmark_config.toml: title, description, and per-case run count (falls back
    // to defaults if corrupt). The model isn't part of the config — each evaluation
    // carries the Model actually used for that run.
    let title = id;
    let description: string | undefined;
    let runs: number | undefined;
    try {
      const config = asRecord(
        parseToml(await fs.readFile(path.join(benchDir, "benchmark_config.toml"), "utf8")),
      );
      if (typeof config.title === "string" && config.title !== "") title = config.title;
      if (typeof config.description === "string" && config.description !== "") {
        description = config.description;
      }
      const configRuns = numberOr(config.runs);
      if (configRuns !== undefined && Number.isInteger(configRuns) && configRuns >= 1) {
        runs = configRuns;
      }
    } catch {
      // Missing or corrupt: title falls back to the directory name.
    }

    // scoreboard.yaml: evaluations[] is appended over time; bad entries are dropped one by one.
    let evaluations: BenchmarkEvaluation[] = [];
    try {
      const scoreboard = asRecord(
        parseYaml(await fs.readFile(path.join(benchDir, "scoreboard.yaml"), "utf8")),
      );
      if (Array.isArray(scoreboard.evaluations)) {
        evaluations = scoreboard.evaluations
          .map(toEvaluation)
          .filter((e): e is BenchmarkEvaluation => e !== null);
      }
    } catch {
      // No scores yet.
    }

    // Case count: number of case subfolders (the statement/rubric structure isn't validated here).
    let caseCount = 0;
    try {
      const entries = await fs.readdir(benchDir, { withFileTypes: true });
      caseCount = entries.filter((e) => e.isDirectory()).length;
    } catch {
      // Stays at 0.
    }

    return {
      id,
      title,
      ...(description !== undefined ? { description } : {}),
      ...(runs !== undefined ? { runs } : {}),
      caseCount,
      evaluations,
    };
  }
}
