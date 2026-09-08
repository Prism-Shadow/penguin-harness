/**
 * One Agent's Benchmarks, read off every machine it runs on.
 *
 * An Agent is ONE identity across machines: this Project's `default_agent` here and on a
 * machine is that Agent, not two of them. Its `benchmarks/` directory, though, is written
 * where the evaluation actually ran — so one Agent's case library and its scoreboard are
 * spread over as many disks as it has been evaluated on, while the Evaluation Center read
 * only the disk it is served from.
 *
 * So the merge is BY IDENTITY, never by machine: one entry per benchmark id, one history of
 * evaluations under it. The machine rides along as attribution — which disk an evaluation was
 * read from, and where a Case's files have to be fetched from — and is not a grouping key.
 *
 * Two rules are load-bearing:
 *
 * - **Order.** A scoreboard's append order IS its evaluation sequence, and the page preserves
 *   it rather than trusting timestamps. Two scoreboards on two disks share no append order at
 *   all, so a merged history can only be ordered by time — and a benchmark that came from a
 *   single machine is therefore left exactly as that file had it.
 * - **First source wins the description.** The caller lists this server first, so a title or a
 *   `runs` count read here is the one displayed. They describe the same benchmark of the same
 *   Agent; where two disks disagree, the one the person is looking at is the honest choice.
 */
import type {
  BenchmarkCaseSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
} from "@prismshadow/penguin-server/api";

/** One server's answer about an Agent's Benchmarks, with the machine that gave it. */
export interface BenchmarkSource {
  /** The machine's own id; null for the server serving this page. */
  machineId: string | null;
  benchmarks: readonly BenchmarkSummary[];
}

/** An evaluation, and the machine whose scoreboard recorded it. */
export type MergedEvaluation = BenchmarkEvaluation & { machineId: string | null };

/** One Benchmark of one Agent, as every machine together holds it. */
export interface MergedBenchmark extends Omit<BenchmarkSummary, "evaluations"> {
  evaluations: MergedEvaluation[];
  /**
   * The machines holding a copy, in the order they were asked (this server first). More than
   * one means the same benchmark was evaluated in more than one place — which is what makes
   * an evaluation row's machine worth showing.
   */
  machineIds: (string | null)[];
}

/** Newest last, by the timestamp the scoreboard recorded; entries without one keep their place. */
function byTime(a: MergedEvaluation, b: MergedEvaluation): number {
  return (a.time ?? "").localeCompare(b.time ?? "");
}

/**
 * Folds every machine's answer into one list of Benchmarks, in the order the sources were
 * asked (so this server's benchmarks lead, and a machine-only one follows).
 */
export function mergeBenchmarks(sources: readonly BenchmarkSource[]): MergedBenchmark[] {
  const byId = new Map<string, MergedBenchmark>();
  for (const source of sources) {
    for (const benchmark of source.benchmarks) {
      const evaluations = benchmark.evaluations.map((evaluation) => ({
        ...evaluation,
        machineId: source.machineId,
      }));
      const existing = byId.get(benchmark.id);
      if (existing === undefined) {
        byId.set(benchmark.id, {
          ...benchmark,
          evaluations,
          machineIds: [source.machineId],
        });
        continue;
      }
      existing.machineIds.push(source.machineId);
      existing.evaluations.push(...evaluations);
      // The count of a directory nobody merged: the machines hold overlapping case sets, so
      // the largest is the closest true statement available from the list endpoint alone.
      existing.caseCount = Math.max(existing.caseCount, benchmark.caseCount);
    }
  }
  const merged = [...byId.values()];
  for (const benchmark of merged) {
    // Only where two files were joined: a single scoreboard keeps the order it was written in.
    if (benchmark.machineIds.length > 1) benchmark.evaluations.sort(byTime);
  }
  return merged;
}

/** One server's answer about a Benchmark's Cases. */
export interface CaseSource {
  machineId: string | null;
  cases: readonly BenchmarkCaseSummary[];
}

/** A Case, and the machine whose disk its files have to be read from. */
export type MergedCase = BenchmarkCaseSummary & { machineId: string | null };

/**
 * The union of the Cases every machine holds for one Benchmark, first source winning a
 * shared id. A Case's files are then fetched from the machine it is recorded against: they
 * are two copies of one Case, and reading one of them is reading the Case.
 */
export function mergeBenchmarkCases(sources: readonly CaseSource[]): MergedCase[] {
  const byId = new Map<string, MergedCase>();
  for (const source of sources) {
    for (const item of source.cases) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, { ...item, machineId: source.machineId });
    }
  }
  return [...byId.values()];
}
