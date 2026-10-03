/**
 * The Benchmarks every new Project starts with: the example and the built-in ones.
 *
 * They are written once, when the Project is created — the server's Project creation, and the
 * one-time bootstrap of `default_project` — and nothing later re-reads or re-writes them: a
 * deleted one stays deleted, and a Project created before a Benchmark shipped never gets it.
 * Loading or initializing an Agent, default_agent included, never touches `benchmarks/`.
 *
 * A directory already under an id is left alone, whatever it holds: a `default_project` adopted
 * from a data root the CLI made, or one whose web.db was re-created over an existing data root,
 * keeps its own and is given only the ids that are missing.
 *
 * Each Benchmark is written into a temporary directory under `benchmarks/.seeding/` and renamed
 * into place, so a write that fails part-way leaves no half-written Benchmark under its id; the
 * error reaches the caller, whose Project creation then rolls the Project back.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { BUILTIN_BENCHMARKS } from "./builtin-benchmarks-data.js";
import { writeBuiltinBenchmark, type BuiltinBenchmark } from "./builtin-benchmarks.js";
import { EXAMPLE_BENCHMARK_ID, writeExampleBenchmark } from "./example-benchmark.js";
import { benchmarksDir } from "./paths.js";

/** Where a Benchmark is written under `benchmarks/` before it is renamed into place. */
const STAGING_DIR = ".seeding";

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

/** Writes `seed` in staging and renames it into place; a failed write leaves nothing behind. */
async function place(dir: string, staging: string, seed: BenchmarkSeed): Promise<void> {
  await fs.mkdir(staging, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(staging, `${seed.id}-`));
  try {
    await seed.write(tmp);
    await fs.rename(tmp, path.join(dir, seed.id));
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The Benchmarks every new Project starts with: the example and the built-in ones. `builtins`
 * defaults to the shipped definitions. Called only where a Project is created (the server's
 * project-service); an id whose directory exists is skipped, never written into.
 */
export async function provisionProjectBenchmarks(
  root: string,
  projectId: string,
  builtins: readonly BuiltinBenchmark[] = BUILTIN_BENCHMARKS,
): Promise<void> {
  const dir = benchmarksDir(root, projectId);
  const staging = path.join(dir, STAGING_DIR);
  await fs.mkdir(dir, { recursive: true });
  const seeds: BenchmarkSeed[] = [
    { id: EXAMPLE_BENCHMARK_ID, write: writeExampleBenchmark },
    ...builtins.map((bench) => ({
      id: bench.id,
      write: (benchDir: string) => writeBuiltinBenchmark(benchDir, bench),
    })),
  ];
  try {
    for (const seed of seeds) {
      if (!(await exists(path.join(dir, seed.id)))) await place(dir, staging, seed);
    }
  } catch (error) {
    // The failed Benchmark's temporary directory is gone already; staging goes with it.
    await fs.rmdir(staging).catch(() => {});
    throw error;
  }
  // Empty by now: every Benchmark was renamed out of it. Absent when nothing was missing.
  await fs.rmdir(staging).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}
