/**
 * The Benchmarks a Project is given: the example and the built-in Harbor Benchmarks, each once.
 *
 * `benchmarks/.seeded.json` lists the ids the Project has been given. Provisioning runs on
 * default_agent's initialization and every later load, and gives each Benchmark whose id the
 * marker does not list yet, then records it. So a Benchmark the user deletes stays deleted, and
 * a release that adds a Benchmark gives a Project just that one. Deleting the whole
 * `benchmarks/` directory, marker included, starts the Project over; taking an id out of the
 * marker gives that Benchmark once more.
 *
 * A directory already there under an id the marker does not list:
 * - `example-benchmark/` is recorded as given and left as it is. An earlier release wrote the
 *   example on every load, so a Project from before the marker has it, evaluations appended to
 *   it included; one whose user had deleted it gets it once more, when the marker is first
 *   written, and never again.
 * - A built-in Harbor id taken by a Benchmark of the user's own is left alone and not recorded:
 *   the Project has not been given the built-in, and is given it once that directory is gone.
 *
 * A Benchmark is written into `benchmarks/.seeding/` and renamed into place, and only then
 * recorded. A crash therefore leaves neither a half-written Benchmark under `benchmarks/` nor a
 * marker naming one that was never written; what it can leave is a staging directory, which the
 * next provisioning clears, or a Benchmark in place but not yet recorded, which the rules above
 * then treat as present. An unreadable marker gives nothing: bringing back a Benchmark the user
 * deleted is the one outcome this file exists to prevent. One Project is provisioned at a time
 * in this process.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { fileLockKey, withFileLock } from "../internal/file-lock.js";
import { BUILTIN_BENCHMARKS } from "./builtin-benchmarks-data.js";
import { writeBuiltinBenchmark, type BuiltinBenchmark } from "./builtin-benchmarks.js";
import { EXAMPLE_BENCHMARK_ID, writeExampleBenchmark } from "./example-benchmark.js";
import { benchmarksDir } from "./paths.js";

/** The marker under a Project's `benchmarks/`: the ids of the Benchmarks it has been given. */
export const SEEDED_BENCHMARKS_FILE = ".seeded.json";

/** Where a Benchmark is written under `benchmarks/` before it is renamed into place. */
const STAGING_DIR = ".seeding";

/** One Benchmark a Project is given once. */
interface Seed {
  id: string;
  write: (benchDir: string) => Promise<void>;
  /** Whether a directory already under this id counts as this Benchmark given. */
  adoptExisting: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** The ids the marker lists: none when there is no marker, null when it cannot be read. */
async function readSeeded(file: string): Promise<Set<string> | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? new Set() : null;
  }
  try {
    const seeded = (JSON.parse(text) as { seeded?: unknown } | null)?.seeded;
    if (!Array.isArray(seeded) || !seeded.every((id) => typeof id === "string")) return null;
    return new Set(seeded);
  } catch {
    return null;
  }
}

/** Writes one Benchmark in staging and renames it into place; false when its directory appeared meanwhile. */
async function place(dir: string, seed: Seed): Promise<boolean> {
  const staging = path.join(dir, STAGING_DIR);
  await fs.mkdir(staging, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(staging, `${seed.id}-`));
  try {
    await seed.write(tmp);
    await fs.rename(tmp, path.join(dir, seed.id));
    return true;
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true });
    if (await exists(path.join(dir, seed.id))) return false;
    throw error;
  }
}

async function provision(dir: string, seeds: readonly Seed[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, SEEDED_BENCHMARKS_FILE);
  const seeded = await readSeeded(marker);
  if (seeded === null) return;
  const pending = seeds.filter((seed) => !seeded.has(seed.id));
  if (pending.length === 0) return;
  // Whatever staging holds was left by a provisioning that never finished: none of it was
  // renamed into place, so none of it was recorded.
  await fs.rm(path.join(dir, STAGING_DIR), { recursive: true, force: true });
  for (const seed of pending) {
    const placed = (await exists(path.join(dir, seed.id))) ? false : await place(dir, seed);
    if (!placed && !seed.adoptExisting) continue;
    seeded.add(seed.id);
    await atomicWriteFile(marker, `${JSON.stringify({ seeded: [...seeded].sort() }, null, 2)}\n`);
  }
  await fs.rm(path.join(dir, STAGING_DIR), { recursive: true, force: true });
}

/**
 * Gives the Project every Benchmark it has not been given yet — the example, then the built-in
 * Harbor Benchmarks — and records each in `benchmarks/.seeded.json`. `builtins` defaults to the
 * shipped definitions. Callers are restricted to default_agent's initialization and load paths
 * (see agent-state.ts).
 */
export async function provisionProjectBenchmarks(
  root: string,
  projectId: string,
  builtins: readonly BuiltinBenchmark[] = BUILTIN_BENCHMARKS,
): Promise<void> {
  const dir = benchmarksDir(root, projectId);
  const seeds: Seed[] = [
    { id: EXAMPLE_BENCHMARK_ID, write: writeExampleBenchmark, adoptExisting: true },
    ...builtins.map((bench) => ({
      id: bench.id,
      write: (benchDir: string) => writeBuiltinBenchmark(benchDir, bench),
      adoptExisting: false,
    })),
  ];
  await withFileLock(await fileLockKey(path.join(dir, SEEDED_BENCHMARKS_FILE)), () =>
    provision(dir, seeds),
  );
}
