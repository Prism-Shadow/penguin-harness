/**
 * Where one Benchmark's page lives. A Benchmark is identified by a pair — the Agent it tests
 * and its directory name — so both segments travel in the path, and the list and the router
 * read one spelling of it.
 */
export const benchmarkRoute = (agentId: string, benchmarkId: string): string =>
  `/benchmark/${encodeURIComponent(agentId)}/${encodeURIComponent(benchmarkId)}`;
