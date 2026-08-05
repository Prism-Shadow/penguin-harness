import { describe, expect, it } from "vitest";
import {
  benchmarkSelectionKey,
  clearBenchmarkSelection,
  loadBenchmarkSelection,
  parseBenchmarkSelection,
  saveBenchmarkSelection,
} from "../src/features/benchmark/benchmark-selection";
import type { BenchmarkSelectionStorage } from "../src/features/benchmark/benchmark-selection";

function memoryStorage(): BenchmarkSelectionStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("Benchmark selection cache", () => {
  it("round-trips stable ids and scopes them by user and Project", () => {
    const storage = memoryStorage();
    const a = benchmarkSelectionKey("user-a", "project-1");
    const b = benchmarkSelectionKey("user-b", "project-1");
    const c = benchmarkSelectionKey("user-a", "project-2");

    saveBenchmarkSelection(a, { agentId: "agent-a", benchmarkId: "benchmark-a" }, storage);

    expect(loadBenchmarkSelection(a, storage)).toEqual({
      agentId: "agent-a",
      benchmarkId: "benchmark-a",
    });
    expect(loadBenchmarkSelection(b, storage)).toBeNull();
    expect(loadBenchmarkSelection(c, storage)).toBeNull();
  });

  it.each([
    null,
    "",
    "not json",
    "[]",
    "{}",
    '{"agentId":"agent-a"}',
    '{"agentId":"","benchmarkId":"benchmark-a"}',
    '{"agentId":"agent-a","benchmarkId":42}',
  ])("drops malformed or incomplete data: %s", (raw) => {
    expect(parseBenchmarkSelection(raw)).toBeNull();
  });

  it("clears a stale value without deleting a newer choice", () => {
    const storage = memoryStorage();
    const key = benchmarkSelectionKey("user-a", "project-1");
    const stale = { agentId: "agent-a", benchmarkId: "old-benchmark" };
    const current = { agentId: "agent-a", benchmarkId: "new-benchmark" };

    saveBenchmarkSelection(key, stale, storage);
    clearBenchmarkSelection(key, stale, storage);
    expect(loadBenchmarkSelection(key, storage)).toBeNull();

    saveBenchmarkSelection(key, current, storage);
    clearBenchmarkSelection(key, stale, storage);
    expect(loadBenchmarkSelection(key, storage)).toEqual(current);
  });

  it("degrades safely when browser storage is unavailable", () => {
    const broken: BenchmarkSelectionStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const key = benchmarkSelectionKey("user-a", "project-1");
    const value = { agentId: "agent-a", benchmarkId: "benchmark-a" };

    expect(loadBenchmarkSelection(key, broken)).toBeNull();
    expect(() => saveBenchmarkSelection(key, value, broken)).not.toThrow();
    expect(() => clearBenchmarkSelection(key, value, broken)).not.toThrow();
  });

  it("degrades safely when the default localStorage global is unavailable", () => {
    const key = benchmarkSelectionKey("user-a", "project-1");
    const value = { agentId: "agent-a", benchmarkId: "benchmark-a" };

    // Vitest runs in Node without a localStorage global. Resolving the default inside each try
    // keeps that ReferenceError on the same best-effort path as browser SecurityErrors.
    expect(loadBenchmarkSelection(key)).toBeNull();
    expect(() => saveBenchmarkSelection(key, value)).not.toThrow();
    expect(() => clearBenchmarkSelection(key, value)).not.toThrow();
  });
});
