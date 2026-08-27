export interface BenchmarkSelection {
  agentId: string;
  benchmarkId: string;
}

export function benchmarkSelectionFromSearch(search: string): BenchmarkSelection | null {
  const params = new URLSearchParams(search);
  const agentId = params.get("agentId");
  const benchmarkId = params.get("benchmarkId");
  return agentId && benchmarkId ? { agentId, benchmarkId } : null;
}

export function benchmarkSelectionSearch(selection: BenchmarkSelection): string {
  const params = new URLSearchParams();
  params.set("agentId", selection.agentId);
  params.set("benchmarkId", selection.benchmarkId);
  return `?${params.toString()}`;
}
