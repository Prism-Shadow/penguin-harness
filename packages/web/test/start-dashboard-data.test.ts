/**
 * What the start page shows (src/features/chat/start-dashboard-data.ts).
 *
 * - The toolkits follow the Method select's rows, the default loop first, and a plugin no row
 *   names comes after them, by name; before the library answers there is one entry per row.
 * - The toolkit tile offers the remembered toolkit, else the first; a name the library no longer
 *   carries falls back the same way.
 * - A Benchmark's latest evaluation is its newest scored one, and an empty scoreboard has none.
 * - The Benchmarks tile's order puts the evaluated Benchmarks first, the most recently evaluated
 *   on top, then the rest by title.
 * - The agents tile shows the agent whose Agent State changed last.
 * - A toolkit is the agent's only when every Skill it ships is installed.
 */
import { describe, expect, it } from "vitest";
import {
  isInstalled,
  latestEvaluation,
  orderToolkits,
  recentAgent,
  recentToolkit,
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

  it("offers the remembered toolkit, else the first, and the first again for a name the library lost", () => {
    const entries = orderToolkits(
      [plugin("opro-rsi-toolkit"), plugin("default-rsi-toolkit")],
      METHODS,
    );
    expect(recentToolkit(entries, "opro-rsi-toolkit")?.key).toBe("opro-rsi-toolkit");
    expect(recentToolkit(entries, null)?.key).toBe("default-rsi-toolkit");
    expect(recentToolkit(entries, "ape-rsi-toolkit")?.key).toBe("default-rsi-toolkit");
    expect(recentToolkit([], "opro-rsi-toolkit")).toBeNull();
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

  it("shows the agent whose Agent State changed last, the first listed among those without a time", () => {
    expect(
      recentAgent([
        { agentId: "a", updatedAt: "2026-10-01T00:00:00Z" },
        { agentId: "b", updatedAt: "2026-10-05T00:00:00Z" },
        { agentId: "c" },
      ])?.agentId,
    ).toBe("b");
    expect(recentAgent([{ agentId: "x" }, { agentId: "y" }])?.agentId).toBe("x");
    expect(recentAgent([])).toBeNull();
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
