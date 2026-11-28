/** Benchmark packages fetched at build time, copied into a Project without regenerating them. */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** One shipped package. Its manifest and Case files remain the source of its content. */
export interface BuiltinBenchmark {
  id: string;
  directory: string;
}

let pushedDirectory: string | null = null;

/** A hot update carries its own packages alongside its plugin library. */
export function usePushedBenchmarkDirectory(directory: string | null): void {
  pushedDirectory = directory;
}

function benchmarkDirectory(): string {
  if (pushedDirectory !== null) return pushedDirectory;
  const bundled = fileURLToPath(new URL("./builtin-benchmarks/", import.meta.url));
  if (existsSync(bundled)) return bundled;
  // Source execution and source tests, before bundling flattens this module into dist/.
  return fileURLToPath(
    new URL("../../../../node_modules/.cache/penguin-benchmarks/", import.meta.url),
  );
}

export async function readBuiltinBenchmarks(): Promise<BuiltinBenchmark[]> {
  const dir = benchmarkDirectory();
  const packages = await fs.readdir(dir, { withFileTypes: true });
  return packages
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ id: entry.name, directory: path.join(dir, entry.name) }));
}

/** The caller stages this copy before placing it; evaluations belong only to the Project. */
export async function writeBuiltinBenchmark(
  benchDir: string,
  bench: BuiltinBenchmark,
): Promise<void> {
  await copyTree(bench.directory, benchDir);
  await fs.writeFile(path.join(benchDir, "scoreboard.yaml"), "evaluations: []\n", "utf8");
}

/** Files in flight at once: enough to hide per-file latency, few enough to stay clear of EMFILE. */
const COPY_CONCURRENCY = 32;

/**
 * Copies the directories and regular files under `from` into `to`, many files at a time. A
 * package holds up to thousands of small files, and `fs.cp` visits them one after another, so on
 * a filesystem with slow metadata (macOS CI) one catalogue copy outgrew a test's timeout. The
 * packages hold nothing else: the build stages only files and directories.
 */
async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const files: string[] = [];
  const entries = await fs.readdir(from, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const rel = path.relative(from, path.join(entry.parentPath, entry.name));
    if (entry.isDirectory()) await fs.mkdir(path.join(to, rel), { recursive: true });
    else if (entry.isFile()) files.push(rel);
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const rel = files[next++]!;
      await fs.copyFile(path.join(from, rel), path.join(to, rel));
    }
  };
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, files.length) }, worker));
}
