#!/usr/bin/env node
/**
 * Writes the built-in Benchmarks, PenguinHarness Benchmark Sec A to Sec E, as packages: for each,
 * `<out>/<id>/` holding its benchmark.json and every case's statement and rubric. That is what a
 * new Project is seeded with, minus the scoreboard, which is a copy's own record of its
 * evaluations and never part of a package. The benchmark repository
 * (Prism-Shadow/penguin-harness-benchmark) commits the output under `packages/`, where the
 * Evaluation Center's import takes a Benchmark by its folder link; Project creation keeps
 * seeding from core's own data, offline. The example Benchmark is not written: it demonstrates
 * the Evaluation Center and is not a package to share.
 *
 * Each `<out>/<id>/` is replaced whole; anything else under `<out>`, such as its README, is left
 * alone. The writer is core's, so build core first:
 *
 *   pnpm --filter @prismshadow/penguin-core build
 *   node scripts/benchmark-packages.mjs --out ../penguin-harness-benchmark/packages
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined || values.out === "") {
  console.error("usage: node scripts/benchmark-packages.mjs --out <dir>");
  process.exit(2);
}
const out = path.resolve(values.out);

let core;
try {
  core = await import("@prismshadow/penguin-core");
} catch (error) {
  console.error(
    `benchmark-packages: cannot load @prismshadow/penguin-core (${error.message}). ` +
      "Build it first: pnpm --filter @prismshadow/penguin-core build",
  );
  process.exit(1);
}
const { BUILTIN_BENCHMARKS, writeBuiltinBenchmark } = core;

await fs.mkdir(out, { recursive: true });
for (const bench of BUILTIN_BENCHMARKS) {
  const dir = path.join(out, bench.id);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir);
  await writeBuiltinBenchmark(dir, bench);
  await fs.rm(path.join(dir, "scoreboard.yaml"));
  console.log(`benchmark-packages: ${bench.id} v${bench.version} (${bench.cases.length} cases)`);
}
