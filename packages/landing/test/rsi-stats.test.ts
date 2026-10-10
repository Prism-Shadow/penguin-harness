/**
 * Hero counts ↔ their sources: RSI_TOOLKITS must name exactly the library plugins whose
 * plugin.json files them under the `rsi` category, and BENCHMARK_REPRODUCTIONS exactly core's
 * built-in Benchmarks, so a new toolkit or built-in fails here instead of leaving the landing
 * page's count quietly behind. Both dictionaries must print the two counts in the stat tiles.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { BENCHMARK_REPRODUCTIONS, RSI_TOOLKITS } from "../src/lib/rsi-stats";
import { zh } from "../src/lib/strings";
import type { Strings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const pluginsRoot = join(__dirname, "..", "..", "..", "plugins");

/** Library plugins (directories with a plugin.json) whose category is `rsi`. */
const rsiPlugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(pluginsRoot, entry.name, "plugin.json")),
  )
  .filter((entry) => {
    const manifest = JSON.parse(
      readFileSync(join(pluginsRoot, entry.name, "plugin.json"), "utf8"),
    ) as { category?: unknown };
    return manifest.category === "rsi";
  })
  .map((entry) => entry.name)
  .sort();

/**
 * Core's built-in Benchmark ids. Imported at run time through a URL rather than statically: a
 * static import would pull core's sources, and everything they import, into this package's
 * typecheck.
 */
async function builtinBenchmarkIds(): Promise<string[]> {
  const file = join(__dirname, "..", "..", "core", "src", "state", "builtin-benchmarks-data.ts");
  const data = (await import(pathToFileURL(file).href)) as {
    BUILTIN_BENCHMARKS: ReadonlyArray<{ id: string }>;
  };
  return data.BUILTIN_BENCHMARKS.map((benchmark) => benchmark.id);
}

const DICTIONARIES: ReadonlyArray<{ file: string; dict: Strings }> = [
  { file: "strings.ts", dict: zh },
  { file: "strings-en.ts", dict: en },
];

describe("hero counts ↔ their sources", () => {
  it("RSI_TOOLKITS names exactly the library's rsi plugins", () => {
    expect(rsiPlugins.length).toBeGreaterThan(0);
    expect([...RSI_TOOLKITS].sort()).toEqual(rsiPlugins);
  });

  it("BENCHMARK_REPRODUCTIONS names exactly core's built-in Benchmarks", async () => {
    expect([...BENCHMARK_REPRODUCTIONS]).toEqual(await builtinBenchmarkIds());
  });

  for (const { file, dict } of DICTIONARIES) {
    it(`${file} prints both counts in the stat tiles`, () => {
      const [, toolkits, benchmarks] = dict.hero.stats;
      expect(toolkits?.value).toMatch(new RegExp(`^${RSI_TOOLKITS.length} `));
      expect(benchmarks?.value).toMatch(new RegExp(`^${BENCHMARK_REPRODUCTIONS.length} `));
    });
  }
});
