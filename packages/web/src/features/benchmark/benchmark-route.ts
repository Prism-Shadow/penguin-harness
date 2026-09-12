/**
 * Where one Benchmark's page lives. A Benchmark belongs to the Project rather than to an Agent,
 * so its directory name alone identifies it, and the list and the router read one spelling of it.
 */
export const benchmarkRoute = (benchmarkId: string): string =>
  `/benchmark/${encodeURIComponent(benchmarkId)}`;
