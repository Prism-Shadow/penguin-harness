/**
 * The machine picker's fuzzy search: subsequence matching (a query does not have to be a
 * substring to hit), scoring that ranks contiguous and word-start hits above scattered
 * ones, and the highlight segmentation the rows render from.
 */
import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlightSegments, matchMachines } from "../src/lib/machines";
import type { MachineTargetInfo } from "../src/lib/machines";

const machine = (alias: string): MachineTargetInfo => ({ id: `ssh:${alias}`, alias, origin: null });

describe("fuzzyMatch", () => {
  it("hits subsequences, not just substrings, case-insensitively", () => {
    expect(fuzzyMatch("gpu-01", "gpu1")?.positions).toEqual([0, 1, 2, 5]);
    expect(fuzzyMatch("Build-Box", "bb")?.positions).toEqual([0, 6]);
    expect(fuzzyMatch("gpu-01", "gx")).toBeNull();
  });

  it("scores contiguous runs and word starts above scattered hits", () => {
    const contiguous = fuzzyMatch("build-box", "build")!;
    const scattered = fuzzyMatch("b-u-i-l-d", "build")!;
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });
});

describe("matchMachines", () => {
  const machines = ["staging", "gpu-01", "gpu-02", "big-gpu"].map(machine);

  it("an empty query keeps every machine in the server's order", () => {
    expect(matchMachines(machines, "  ").map((m) => m.machine.alias)).toEqual([
      "staging",
      "gpu-01",
      "gpu-02",
      "big-gpu",
    ]);
  });

  it("filters, ranks best-first, and keeps the server's order among ties", () => {
    const hits = matchMachines(machines, "gpu").map((m) => m.machine.alias);
    // The two word-start contiguous hits outrank big-gpu's later hit; between the equal
    // gpu-01/gpu-02 the server's order (recency) stands.
    expect(hits).toEqual(["gpu-01", "gpu-02", "big-gpu"]);
    expect(matchMachines(machines, "zzz")).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("splits into contiguous hit/miss runs covering the whole alias", () => {
    expect(highlightSegments("gpu-01", [0, 1, 2, 5])).toEqual([
      { text: "gpu", hit: true },
      { text: "-0", hit: false },
      { text: "1", hit: true },
    ]);
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});
