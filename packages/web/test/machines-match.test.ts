/**
 * The machine picker's fuzzy search: subsequence matching (a query does not have to be a
 * substring to hit), scoring that ranks contiguous and word-start hits above scattered
 * ones, and the highlight segmentation the rows render from. An ssh config with hundreds
 * of hosts is the case this exists for, so the cap and the "N more" arithmetic are pinned
 * here too.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_MACHINES,
  fuzzyMatch,
  highlightSegments,
  matchMachines,
} from "../src/features/machines/machines-match";
import type { MachineLike } from "../src/features/machines/machines-match";

const machine = (alias: string): MachineLike => ({ id: `ssh:${alias}`, alias });

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

  it("an empty query fits everything, hitting nothing", () => {
    expect(fuzzyMatch("gpu-01", "")).toEqual({ positions: [], score: 0 });
  });
});

describe("matchMachines", () => {
  const machines = ["staging", "gpu-01", "gpu-02", "big-gpu"].map(machine);

  it("an empty query keeps every machine in the config's order", () => {
    expect(matchMachines(machines, "  ").map((m) => m.machine.alias)).toEqual([
      "staging",
      "gpu-01",
      "gpu-02",
      "big-gpu",
    ]);
  });

  it("filters, ranks best-first, and keeps the config's order among ties", () => {
    const hits = matchMachines(machines, "gpu").map((m) => m.machine.alias);
    // The two word-start contiguous hits outrank big-gpu's later hit; between the equal
    // gpu-01/gpu-02 the config's own order stands.
    expect(hits).toEqual(["gpu-01", "gpu-02", "big-gpu"]);
    expect(matchMachines(machines, "zzz")).toEqual([]);
  });

  it("carries the hit positions so the row can show why it matched", () => {
    const [hit] = matchMachines([machine("gpu-01")], "gpu1");
    expect(hit?.positions).toEqual([0, 1, 2, 5]);
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

describe("a config with hundreds of hosts", () => {
  const many = Array.from({ length: 300 }, (_, i) => machine(`node-${String(i).padStart(3, "0")}`));

  it("narrows to the visible few, and the counter names the rest honestly", () => {
    const all = matchMachines(many, "");
    expect(all).toHaveLength(300);
    expect(all.length - all.slice(0, MAX_VISIBLE_MACHINES).length).toBe(300 - MAX_VISIBLE_MACHINES);

    // A query specific enough to fit on screen leaves nothing hidden.
    const narrowed = matchMachines(many, "node287");
    expect(narrowed.map((m) => m.machine.alias)).toEqual(["node-287"]);
    expect(narrowed.length - narrowed.slice(0, MAX_VISIBLE_MACHINES).length).toBe(0);
  });
});
