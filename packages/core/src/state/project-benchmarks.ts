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
 * into place (placeBenchmark, which the server's zip import writes through too), so a write that
 * fails part-way leaves no half-written Benchmark under its id; the error reaches the caller,
 * whose Project creation then rolls the Project back.
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

export interface PlaceBenchmarkOptions {
  /** Replace whatever is already under the id, whole; without it the id must be free. */
  replace?: boolean;
}

/**
 * Writes the Benchmark `id` into `dir`, a Project's `benchmarks/`: `write` fills a temporary
 * directory under `.seeding/`, which is then renamed to `<dir>/<id>`. A write that fails part-way
 * leaves nothing under the id, and the staging directory goes as soon as it is empty.
 *
 * Without `replace` the id has to be free: a rename onto a directory that holds anything fails
 * (ENOTEMPTY or EEXIST), so a caller that must not overwrite checks first and treats that failure
 * as the id having been taken in between. With `replace`, what is under the id is moved aside,
 * the new copy is renamed in, and only then is the old one removed: the id never holds a
 * half-written copy, and holds nothing only between the two renames. A symlink under the id is
 * moved and removed as a link; what it points to is never touched.
 */
export async function placeBenchmark(
  dir: string,
  id: string,
  write: (benchDir: string) => Promise<void>,
  options: PlaceBenchmarkOptions = {},
): Promise<void> {
  const staging = path.join(dir, STAGING_DIR);
  await fs.mkdir(staging, { recursive: true });
  try {
    const tmp = await fs.mkdtemp(path.join(staging, `${id}-`));
    try {
      await write(tmp);
      const target = path.join(dir, id);
      if (options.replace === true) await swapIn(tmp, target);
      else await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { recursive: true, force: true });
      throw error;
    }
  } finally {
    // Empty once this Benchmark is out of it, unless another placement is still writing there.
    await fs.rmdir(staging).catch(() => {});
  }
}

/** Renames `incoming` to `target`, moving what is there aside first and removing it afterwards. */
async function swapIn(incoming: string, target: string): Promise<void> {
  // A sibling of the staged copy, unique because the staged copy's name is.
  const aside = `${incoming}.replaced`;
  let moved = false;
  try {
    await fs.rename(target, aside);
    moved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await fs.rename(incoming, target);
  } catch (error) {
    // Put the old copy back rather than leave the id empty.
    if (moved) await fs.rename(aside, target).catch(() => {});
    throw error;
  }
  // The new copy is in place; an old one that cannot be removed now stays under staging, which
  // is never listed, rather than failing a replacement that has already happened.
  if (moved) await fs.rm(aside, { recursive: true, force: true }).catch(() => {});
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
  await fs.mkdir(dir, { recursive: true });
  const seeds: BenchmarkSeed[] = [
    { id: EXAMPLE_BENCHMARK_ID, write: writeExampleBenchmark },
    ...builtins.map((bench) => ({
      id: bench.id,
      write: (benchDir: string) => writeBuiltinBenchmark(benchDir, bench),
    })),
  ];
  for (const seed of seeds) {
    if (!(await exists(path.join(dir, seed.id)))) await placeBenchmark(dir, seed.id, seed.write);
  }
}
