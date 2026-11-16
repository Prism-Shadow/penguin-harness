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
  await fs.cp(bench.directory, benchDir, { recursive: true });
  await fs.writeFile(path.join(benchDir, "scoreboard.yaml"), "evaluations: []\n", "utf8");
}
