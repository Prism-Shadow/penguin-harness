/**
 * Evaluation Center selection cache (localStorage; one entry per "user × Project").
 * Only stable ids are stored: the Benchmark summary is fetched again on restore so scores,
 * titles, and case counts never come from stale browser data. Reads validate the complete
 * shape and writes are best-effort for browsers that deny storage access.
 */

export interface BenchmarkSelectionRef {
  agentId: string;
  benchmarkId: string;
}

/** Minimal storage interface for pure Node tests and browsers with Web Storage. */
export interface BenchmarkSelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Cache key scoped by account and Project, preventing another login from inheriting it. */
export const benchmarkSelectionKey = (userId: string, projectId: string): string =>
  `penguin.benchmarkSelection.${userId}.${projectId}`;

/** Invalid or legacy data is ignored rather than preventing the Evaluation Center from loading. */
export function parseBenchmarkSelection(raw: string | null): BenchmarkSelectionRef | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.agentId !== "string" ||
      record.agentId === "" ||
      typeof record.benchmarkId !== "string" ||
      record.benchmarkId === ""
    ) {
      return null;
    }
    return { agentId: record.agentId, benchmarkId: record.benchmarkId };
  } catch {
    return null;
  }
}

export function loadBenchmarkSelection(
  key: string,
  storage: BenchmarkSelectionStorage = localStorage,
): BenchmarkSelectionRef | null {
  try {
    return parseBenchmarkSelection(storage.getItem(key));
  } catch {
    return null;
  }
}

export function saveBenchmarkSelection(
  key: string,
  selection: BenchmarkSelectionRef,
  storage: BenchmarkSelectionStorage = localStorage,
): void {
  try {
    storage.setItem(key, JSON.stringify(selection));
  } catch {
    /* Storage can be unavailable under privacy restrictions; page state still works. */
  }
}

/**
 * Clears a stale remembered selection only if it is still the value the caller resolved.
 * The equality check prevents a late Benchmark request from deleting a newer user choice.
 */
export function clearBenchmarkSelection(
  key: string,
  expected: BenchmarkSelectionRef,
  storage: BenchmarkSelectionStorage = localStorage,
): void {
  try {
    const current = parseBenchmarkSelection(storage.getItem(key));
    if (current?.agentId === expected.agentId && current.benchmarkId === expected.benchmarkId) {
      storage.removeItem(key);
    }
  } catch {
    /* Best-effort cleanup only. */
  }
}
