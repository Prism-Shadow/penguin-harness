/**
 * The Evaluation Center's reads, fanned out over this server and every machine it holds.
 *
 * A machine that cannot answer is left out rather than failing the read: its scoreboard is
 * missing from the merge, which is what "could not read it" means, while everything this
 * server holds still renders. Only when NO source answered is there an error to report.
 */
import * as api from "../../api/endpoints";
import { mergeBenchmarkCases, mergeBenchmarks } from "../../lib/benchmark-merge";
import type { MergedBenchmark, MergedCase } from "../../lib/benchmark-merge";

/** Settles one read per source (this server first) into the answers that came back. */
async function askEach<T>(
  sources: readonly (string | null)[],
  read: (machineId: string | null) => Promise<T>,
): Promise<{ machineId: string | null; value: T }[]> {
  const answers = await Promise.allSettled(
    sources.map(async (machineId) => ({ machineId, value: await read(machineId) })),
  );
  const answered = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
  if (answered.length === 0 && answers[0]?.status === "rejected") throw answers[0].reason;
  return answered;
}

/** The Project's Benchmarks as this server and the given machines hold them, merged. */
export async function fetchBenchmarks(
  projectId: string,
  machineIds: readonly string[],
): Promise<MergedBenchmark[]> {
  const answered = await askEach([null, ...machineIds], (machineId) =>
    api.listBenchmarks(projectId, machineId),
  );
  return mergeBenchmarks(
    answered.map(({ machineId, value }) => ({ machineId, benchmarks: value.benchmarks })),
  );
}

/** One Benchmark's Cases, asked of the machines that hold a copy of it, merged. */
export async function fetchBenchmarkCases(
  projectId: string,
  benchmark: Pick<MergedBenchmark, "id" | "machineIds">,
): Promise<MergedCase[]> {
  const answered = await askEach(benchmark.machineIds, (machineId) =>
    api.listBenchmarkCases(projectId, benchmark.id, machineId),
  );
  return mergeBenchmarkCases(
    answered.map(({ machineId, value }) => ({ machineId, cases: value.cases })),
  );
}
