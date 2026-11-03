/**
 * The start page's server reads (start-dashboard.tsx): what its counts count. Each is read again
 * on every mount (lib/use-fresh-read.ts), starting from what the last mount read, so a count
 * follows a plugin installed or removed, or a Benchmark imported or deleted, as soon as the user
 * comes back to the page — and does not drop back to "—" while the fresh list is on its way.
 */
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { useFreshRead } from "../../lib/use-fresh-read";

export { useRsiToolkits } from "../../lib/use-rsi-toolkits";

/** The last Benchmark list read per Project in this page load. */
const benchmarkLists = new Map<string, BenchmarkSummary[]>();

export interface ProjectBenchmarks {
  /** The Project's Benchmarks on this server; null until the first list arrives. */
  benchmarks: BenchmarkSummary[] | null;
  /** The read failed with no earlier list to show. */
  failed: boolean;
}

/**
 * This Project's Benchmarks as this server holds them — the Evaluation Center's own list, without
 * the machines it reaches: the start page summarises the server it is talking to.
 */
export function useProjectBenchmarks(projectId: string): ProjectBenchmarks {
  const { value, failed } = useFreshRead(benchmarkLists, projectId, async () => {
    const res = await api.listBenchmarks(projectId);
    return res.benchmarks;
  });
  return { benchmarks: value, failed };
}
