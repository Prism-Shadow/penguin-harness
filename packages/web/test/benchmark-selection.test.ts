import { describe, expect, it } from "vitest";
import {
  benchmarkSelectionFromSearch,
  benchmarkSelectionSearch,
} from "../src/features/benchmark/benchmark-selection";

describe("benchmark selection URL state", () => {
  it("round-trips the selected agent and benchmark", () => {
    const selection = { agentId: "agent a", benchmarkId: "benchmark/1" };
    expect(benchmarkSelectionFromSearch(benchmarkSelectionSearch(selection))).toEqual(selection);
  });

  it("ignores incomplete selections", () => {
    expect(benchmarkSelectionFromSearch("?agentId=agent-only")).toBeNull();
  });
});
