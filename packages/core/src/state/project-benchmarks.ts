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
 * marker naming one that was never written; what it can leave is a staging entry, which a later
 * provisioning clears once it is an hour old, or a Benchmark in place but not yet recorded, which
 * the rules above then treat as present.
 *
 * Two processes can provision one Project at once: the server and a CLI share a data root, and
 * the lock taken here holds within one process only. So every write of the marker reads it again
 * first and writes the union, and neither process drops what the other recorded meanwhile. A
 * directory that appears under an id while this process is placing it was placed by the other
 * one, and counts as given here too, built-in or not. And staging is shared: only an entry old
 * enough to be a crash's leftover is cleared, never another process's Benchmark in the making.
 *
 * An unreadable marker gives nothing, since bringing back a Benchmark the user deleted is the one
 * outcome this file exists to prevent. It is reported once per process on stderr, with the way
 * out: fix the file, or remove it to be given every missing Benchmark again.
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

/**
 * How old a staging entry must be before provisioning clears it as a crash's leftover. Writing a
 * Benchmark takes well under a second, so anything younger may be another process's work.
 */
const STALE_STAGING_MS = 60 * 60 * 1000;

/** One Benchmark a Project is given once. */
export interface BenchmarkSeed {
  id: string;
  write: (benchDir: string) => Promise<void>;
  /** Whether a directory already under this id counts as this Benchmark given. */
  adoptExisting: boolean;
}

/** Markers this process has reported unreadable: provisioning runs on every load, the warning once. */
const reportedMarkers = new Set<string>();

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

/** readSeeded, reporting the first time this process finds the marker unreadable. */
async function readMarker(marker: string): Promise<Set<string> | null> {
  const seeded = await readSeeded(marker);
  if (seeded === null && !reportedMarkers.has(marker)) {
    reportedMarkers.add(marker);
    process.stderr.write(
      `[benchmarks] ${marker} is not a readable list of Benchmark ids: no Benchmark is given to this Project until the file is fixed, and removing it gives the Project every missing one again.\n`,
    );
  }
  return seeded;
}

/**
 * Records `id` as given. The marker is read again right before the write and the union with
 * `seeded` is written, so whatever another process recorded meanwhile is kept, and `seeded` takes
 * it in. False, with nothing written, when the marker no longer reads.
 */
async function record(marker: string, seeded: Set<string>, id: string): Promise<boolean> {
  const onDisk = await readMarker(marker);
  if (onDisk === null) return false;
  for (const given of onDisk) seeded.add(given);
  seeded.add(id);
  await atomicWriteFile(marker, `${JSON.stringify({ seeded: [...seeded].sort() }, null, 2)}\n`);
  return true;
}

/**
 * Writes one Benchmark in staging and renames it into place. When a directory appears under its
 * id meanwhile, another process provisioning this Project placed it first: this copy is dropped
 * and the Benchmark counts as placed.
 */
async function place(dir: string, seed: BenchmarkSeed): Promise<void> {
  const staging = path.join(dir, STAGING_DIR);
  const prefix = path.join(staging, `${seed.id}-`);
  // Staging is made on demand, again when another process removed it as empty a moment ago.
  const tmp = await fs.mkdtemp(prefix).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(staging, { recursive: true });
    return fs.mkdtemp(prefix);
  });
  const target = path.join(dir, seed.id);
  try {
    await seed.write(tmp);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true });
    if (!(await exists(target))) throw error;
  }
}

/** Clears staging entries old enough to be a crash's leftovers, then staging itself once empty. */
async function sweepStaging(dir: string): Promise<void> {
  const staging = path.join(dir, STAGING_DIR);
  let names: string[];
  try {
    names = await fs.readdir(staging);
  } catch {
    return; // No staging: nothing was left.
  }
  const cutoff = Date.now() - STALE_STAGING_MS;
  for (const name of names) {
    const entry = path.join(staging, name);
    const stat = await fs.stat(entry).catch(() => null);
    if (stat !== null && stat.mtimeMs < cutoff)
      await fs.rm(entry, { recursive: true, force: true });
  }
  // Fails while an entry remains, another process's work in progress included.
  await fs.rmdir(staging).catch(() => {});
}

/**
 * Gives `dir`, a Project's `benchmarks/`, every seed its marker does not list yet. Callers go
 * through provisionProjectBenchmarks; this takes no lock, so the tests use it to stand in for a
 * second process provisioning the same Project.
 */
export async function provisionSeeds(dir: string, seeds: readonly BenchmarkSeed[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await sweepStaging(dir);
  const marker = path.join(dir, SEEDED_BENCHMARKS_FILE);
  const seeded = await readMarker(marker);
  if (seeded === null) return;
  const pending = seeds.filter((seed) => !seeded.has(seed.id));
  if (pending.length === 0) return;
  for (const seed of pending) {
    if (await exists(path.join(dir, seed.id))) {
      // There before this provisioning placed anything. The example is adopted; under a
      // built-in id it is a Benchmark of the user's own, or one another process has just
      // placed, which that process records.
      if (!seed.adoptExisting) continue;
    } else {
      await place(dir, seed);
    }
    if (!(await record(marker, seeded, seed.id))) return;
  }
  await sweepStaging(dir);
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
  const seeds: BenchmarkSeed[] = [
    { id: EXAMPLE_BENCHMARK_ID, write: writeExampleBenchmark, adoptExisting: true },
    ...builtins.map((bench) => ({
      id: bench.id,
      write: (benchDir: string) => writeBuiltinBenchmark(benchDir, bench),
      adoptExisting: false,
    })),
  ];
  await withFileLock(await fileLockKey(path.join(dir, SEEDED_BENCHMARKS_FILE)), () =>
    provisionSeeds(dir, seeds),
  );
}
