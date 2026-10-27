/**
 * The hero's catalogue rows ↔ their sources. RSI_TOOLKITS must name exactly the library plugins
 * whose package.json files them under the `rsi` category, and BENCHMARKS exactly core's built-in
 * Benchmarks, one entry per upstream repository core records for them, linked to it, so a new
 * toolkit or built-in, or a moved upstream, fails here instead of leaving the landing page behind. Every
 * link is absolute https, and only the Default toolkit has none; and both dictionaries carry one
 * kind per Benchmark and no derived count in the stat tiles (the hero derives the algorithm and
 * Benchmark counts from these lists).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARKS, MODEL_PROVIDERS, RSI_TOOLKITS } from "../src/lib/rsi-stats";
import { zh } from "../src/lib/strings";
import type { Strings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const pluginsRoot = join(__dirname, "..", "..", "..", "plugins");

/** The `penguin` block of a plugin's package.json: the field this test reads. */
interface Manifest {
  category?: unknown;
}

const manifest = (plugin: string): Manifest => {
  const pkg = JSON.parse(readFileSync(join(pluginsRoot, plugin, "package.json"), "utf8")) as {
    penguin?: Manifest;
  };
  return pkg.penguin ?? {};
};

/** Library plugins (directories with a package.json) whose `penguin.category` is `rsi`. */
const rsiPlugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(pluginsRoot, entry.name, "package.json")),
  )
  .filter((entry) => manifest(entry.name).category === "rsi")
  .map((entry) => entry.name)
  .sort();

/** The catalogue prepared from the same packages that ship in the application. */
function builtinBenchmarks(): Array<{ id: string; upstream: string }> {
  const file = join(__dirname, "../../../node_modules/.cache/penguin-benchmarks/catalog.json");
  const packages = JSON.parse(readFileSync(file, "utf8")) as Array<{
    id: string;
    cases: Array<{ statement: string }>;
  }>;
  return packages.map((benchmark) => ({
    id: benchmark.id,
    upstream: /^- Upstream: (https:\/\/\S+)/m.exec(benchmark.cases[0]!.statement)?.[1] ?? "",
  }));
}

const DICTIONARIES: ReadonlyArray<{ file: string; dict: Strings }> = [
  { file: "strings.ts", dict: zh },
  { file: "strings-en.ts", dict: en },
];

describe("hero catalogue ↔ its sources", () => {
  it("RSI_TOOLKITS names exactly the library's rsi plugins", () => {
    expect(rsiPlugins.length).toBeGreaterThan(0);
    expect(RSI_TOOLKITS.map((toolkit) => toolkit.plugin).sort()).toEqual(rsiPlugins);
  });

  it("BENCHMARKS names core's built-in Benchmarks, one entry per upstream, linked to it", async () => {
    expect(
      BENCHMARKS.flatMap((benchmark) =>
        benchmark.ids.map((id) => ({ id, upstream: benchmark.href })),
      ).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(builtinBenchmarks().sort((a, b) => a.id.localeCompare(b.id)));
    const hrefs = BENCHMARKS.map((benchmark) => benchmark.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("every link is absolute https; only the Default toolkit has none", () => {
    expect(MODEL_PROVIDERS.map((provider) => provider.id)).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "zai",
      "moonshot",
      "qwen",
      "openrouter",
    ]);
    const links = [
      ...MODEL_PROVIDERS.map((provider) => provider.href),
      ...RSI_TOOLKITS.flatMap((toolkit) => (toolkit.href === null ? [] : [toolkit.href])),
      ...BENCHMARKS.map((benchmark) => benchmark.href),
    ];
    for (const href of links) expect(new URL(href).protocol, href).toBe("https:");
    const unlinked = RSI_TOOLKITS.filter((toolkit) => toolkit.href === null);
    expect(unlinked.map((toolkit) => toolkit.plugin)).toEqual(["default-rsi-toolkit"]);
  });

  for (const { file, dict } of DICTIONARIES) {
    it(`${file} has one kind per Benchmark and no catalogue counts in the stat tiles`, () => {
      expect(dict.hero.benchmarkKinds).toHaveLength(BENCHMARKS.length);
      for (const stat of dict.hero.stats) {
        expect(stat.value).not.toMatch(/算法|Benchmark|Algorithms|Reproductions/);
      }
    });
  }
});
