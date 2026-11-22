/**
 * The Benchmarks every new Project starts with: the example and the built-in ones.
 *
 * They are written once, when the Project is created — the server's Project creation, and the
 * one-time bootstrap of `default_project` — and nothing later re-reads or re-writes them: a
 * deleted one stays deleted, and a Project created before a Benchmark shipped never gets it.
 * Loading or initializing an Agent, default_agent included, never touches the Benchmark folder
 * (the Evaluation Center's data folder, benchmark-dirs.ts).
 *
 * A directory already under an id is left alone, whatever it holds: a `default_project` adopted
 * from a data root the CLI made, or one whose web.db was re-created over an existing data root,
 * keeps its own and is given only the ids that are missing.
 *
 * Each Benchmark is written into a temporary directory under the Benchmark folder's `.seeding/` and renamed
 * into place (placeBenchmark over place-folder.ts, which the server's zip import writes through
 * too), so a write that fails part-way leaves no half-written Benchmark under its id; the error
 * reaches the caller, whose Project creation then rolls the Project back.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  readBuiltinBenchmarks,
  writeBuiltinBenchmark,
  type BuiltinBenchmark,
} from "./builtin-benchmarks.js";
import { EXAMPLE_BENCHMARK_ID, writeExampleBenchmark } from "./example-benchmark.js";
import { benchmarksDir } from "./benchmark-dirs.js";
import { placeFolder, type PlaceFolderOptions } from "./place-folder.js";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** One Benchmark a new Project starts with, and the writer that fills its directory. */
interface BenchmarkSeed {
  id: string;
  write: (benchDir: string) => Promise<void>;
}

export type PlaceBenchmarkOptions = PlaceFolderOptions;

/**
 * Writes the Benchmark `id` into `dir`, a Project's Benchmark folder, staged under `.seeding/` and
 * renamed into place (place-folder.ts has the rules: without `replace` the id must be free, and a
 * write that fails part-way leaves nothing under it).
 */
export function placeBenchmark(
  dir: string,
  id: string,
  write: (benchDir: string) => Promise<void>,
  options: PlaceBenchmarkOptions = {},
): Promise<void> {
  return placeFolder(dir, id, write, options);
}

/**
 * The Benchmarks every new Project starts with: the example and the built-in ones. `builtins`
 * defaults to the shipped packages. Called only where a Project is created (the server's
 * project-service); an id whose directory exists is skipped, never written into.
 */
export async function provisionProjectBenchmarks(
  root: string,
  projectId: string,
  builtins?: readonly BuiltinBenchmark[],
): Promise<void> {
  const dir = benchmarksDir(root, projectId);
  // The folders of an app's data are this user's alone, as the workbench host makes them.
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const seeds: BenchmarkSeed[] = [
    { id: EXAMPLE_BENCHMARK_ID, write: writeExampleBenchmark },
    ...(builtins ?? (await readBuiltinBenchmarks())).map((bench) => ({
      id: bench.id,
      write: (benchDir: string) => writeBuiltinBenchmark(benchDir, bench),
    })),
  ];
  for (const seed of seeds) {
    if (!(await exists(path.join(dir, seed.id)))) await placeBenchmark(dir, seed.id, seed.write);
  }
}
