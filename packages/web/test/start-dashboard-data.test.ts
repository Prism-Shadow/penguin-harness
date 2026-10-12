/**
 * What the start page shows (src/features/chat/start-dashboard-data.ts).
 *
 * - The toolkit cards follow the Method select's rows, the default loop first, and a plugin no row
 *   names comes after them, by name; before the library answers there is one card per row.
 * - A Benchmark's latest evaluation is its newest scored one, and an empty scoreboard has none.
 * - The Evaluation Center rows put the evaluated Benchmarks first, the most recently evaluated on
 *   top, then the rest by title.
 * - A toolkit is the agent's only when every Skill it ships is installed.
 */
import { describe, expect, it } from "vitest";
import {
  isInstalled,
  latestEvaluation,
  orderToolkits,
  sortBenchmarks,
} from "../src/features/chat/start-dashboard-data";

const METHODS = [
  { id: "default", plugin: "default-rsi-toolkit" },
  { id: "opro", plugin: "opro-rsi-toolkit" },
  { id: "ape", plugin: "ape-rsi-toolkit" },
];

const plugin = (name: string, skills: string[] = [name]) => ({
  name,
  skills: skills.map((skill) => ({ name: skill })),
});

describe("the start page's data", () => {
  it("orders the toolkits by the method rows, the default first, then any other by name", () => {
    const library = [
      plugin("zeta-rsi-toolkit"),
      plugin("ape-rsi-toolkit"),
      plugin("alpha-rsi-toolkit"),
      plugin("default-rsi-toolkit", ["agent-optimization", "agent-evaluation"]),
      plugin("opro-rsi-toolkit"),
    ];
    expect(orderToolkits(library, METHODS).map((entry) => entry.key)).toEqual([
      "default-rsi-toolkit",
      "opro-rsi-toolkit",
      "ape-rsi-toolkit",
      "alpha-rsi-toolkit",
      "zeta-rsi-toolkit",
    ]);
    expect(orderToolkits(null, METHODS).map((entry) => [entry.key, entry.plugin])).toEqual([
      ["default-rsi-toolkit", null],
      ["opro-rsi-toolkit", null],
      ["ape-rsi-toolkit", null],
    ]);
  });

  it("takes the newest scored evaluation as the latest, and none from an empty scoreboard", () => {
    const latest = latestEvaluation([
      { time: "2026-10-01T08:00:00Z", score: 61 },
      { time: "2026-10-03T08:00:00Z", score: 72.5 },
      { time: "2026-10-02T08:00:00Z", score: 80 },
      // The newest record carries no number to show.
      { time: "2026-10-04T08:00:00Z", score: Number.NaN },
    ]);
    expect(latest?.score).toBe(72.5);
    expect(latestEvaluation([])).toBeNull();
  });

  it("lists the evaluated Benchmarks first, the newest on top, then the rest by title", () => {
    const benchmark = (id: string, title: string, times: string[]) => ({
      id,
      title,
      evaluations: times.map((time) => ({ time, score: 50 })),
    });
    const sorted = sortBenchmarks([
      benchmark("c", "Charlie", []),
      benchmark("a", "Alpha", ["2026-10-01T00:00:00Z"]),
      benchmark("b", "Bravo", []),
      benchmark("d", "Delta", ["2026-09-01T00:00:00Z", "2026-10-05T00:00:00Z"]),
    ]);
    expect(sorted.map((b) => b.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("counts a toolkit as installed only when every Skill it ships is", () => {
    const toolkit = plugin("default-rsi-toolkit", ["agent-initialization", "benchmark-design"]);
    expect(
      isInstalled(toolkit, new Set(["agent-initialization", "benchmark-design", "memory"])),
    ).toBe(true);
    expect(isInstalled(toolkit, new Set(["agent-initialization"]))).toBe(false);
    expect(isInstalled(plugin("hooks-only", []), new Set())).toBe(false);
  });
});
