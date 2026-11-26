/**
 * The hero's benchmark families ↔ the Benchmarks the product ships.
 *
 * - Given the pinned Self-Evolution Workbench, whose seeds are the Benchmarks a new default Agent
 *   starts with, the hero lists one family per upstream data repository those Benchmarks come
 *   from (a seed's `data_url`; the Example Benchmark names none).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BENCHMARKS } from "../src/lib/rsi-stats";

/** The seeds the pinned workbench writes on its first load, as its catalog lists them. */
function seedCatalog(): Array<{ id: string; data_url?: string }> {
  const file = createRequire(import.meta.url).resolve(
    "@penguinharness/rsi-workbench/workbenches/benchmark/seeds/catalog.json",
  );
  return JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; data_url?: string }>;
}

describe("the hero's benchmark families", () => {
  it("count the upstream repositories the shipped Benchmarks come from", () => {
    const upstreams = new Set(
      seedCatalog()
        .map((seed) => seed.data_url)
        .filter((url): url is string => typeof url === "string" && url !== ""),
    );
    expect(upstreams.size).toBeGreaterThan(0);
    expect(BENCHMARKS).toHaveLength(upstreams.size);
  });
});
