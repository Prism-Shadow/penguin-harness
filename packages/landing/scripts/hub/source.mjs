/**
 * Where the Benchmarks and Leaderboards pages read penguin-harness-benchmark from.
 *
 * A build clones the repository afresh (shallow, sparse: `packages/`, `experiments/` and
 * `leaderboards/`, never the large `data/`), so a deploy always shows the repository as it is.
 * The dev server reuses the last clone when there is one. PENGUIN_BENCHMARK_REPO names a local
 * checkout to read instead, with no network (developing both repositories, or a machine that
 * cannot reach GitHub). The clone lives in this package's node_modules cache, never in git.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "https://github.com/Prism-Shadow/penguin-harness-benchmark.git";
export const CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "node_modules",
  ".cache",
  "penguin-hub",
);
const CHECKOUT = join(CACHE_DIR, "penguin-harness-benchmark");

/** The checkout to read: the local override, the cached clone, or a fresh one when `refresh`. */
export function benchmarkRepo({ refresh = false } = {}) {
  const local = process.env.PENGUIN_BENCHMARK_REPO;
  if (local) {
    const dir = resolve(local);
    if (!existsSync(join(dir, "packages"))) {
      throw new Error(`PENGUIN_BENCHMARK_REPO=${local} has no packages/ directory`);
    }
    return dir;
  }
  if (!refresh && existsSync(join(CHECKOUT, "packages"))) return CHECKOUT;
  mkdirSync(CACHE_DIR, { recursive: true });
  const temp = mkdtempSync(join(CACHE_DIR, "clone-"));
  try {
    const git = (args) => execFileSync("git", args, { stdio: "pipe" });
    git([
      "clone",
      // Task paths in that repository run past Windows' 260-character limit; `--config` keeps
      // the setting in the clone, so the sparse checkout below reads it too.
      "--config=core.longpaths=true",
      "--depth=1",
      "--filter=blob:none",
      "--sparse",
      "--branch=main",
      REPOSITORY,
      temp,
    ]);
    git(["-C", temp, "sparse-checkout", "set", "packages", "experiments", "leaderboards"]);
    rmSync(CHECKOUT, { recursive: true, force: true });
    renameSync(temp, CHECKOUT);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(
      `Could not clone ${REPOSITORY} (set PENGUIN_BENCHMARK_REPO to a local checkout to build offline): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return CHECKOUT;
}
