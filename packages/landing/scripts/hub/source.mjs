/**
 * Where the Benchmarks and Leaderboards pages read penguin-harness-benchmark from.
 *
 * A build clones the repository afresh, so a deploy always shows the repository as it is. The
 * clone is shallow and sparse: `packages/`, `experiments/` and `leaderboards/`, and from the large
 * `data/` only each benchmark's README.md and each task's instruction.md; the rest of `data/` is
 * listed from git (`dataFiles`) without being downloaded.
 * The dev server reuses the last clone while it is fresh (see `fresh`). PENGUIN_BENCHMARK_REPO names a local
 * checkout to read instead, with no network (developing both repositories, or a machine that
 * cannot reach GitHub). The clone lives in this package's node_modules cache, never in git.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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
/** How long the dev server reuses a clone before fetching the repository again. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SPARSE = [
  "/packages/",
  "/experiments/",
  "/leaderboards/",
  "/data/*/README.md",
  "/data/*/tasks/*/instruction.md",
];

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
  const cached = existsSync(join(CHECKOUT, "packages"));
  if (!refresh && cached && fresh(CHECKOUT)) return CHECKOUT;
  try {
    return clone();
  } catch (error) {
    // Offline in dev: an old clone still serves, but say so.
    if (refresh || !cached) throw error;
    console.warn(`[penguin:hub] ${error.message}; reading the clone from an earlier run.`);
    return CHECKOUT;
  }
}

/**
 * Whether the dev server may reuse the last clone: it is under a day old and was made with the
 * sparse patterns this file asks for, so a pattern added here reaches it.
 */
function fresh(dir) {
  try {
    const age = Date.now() - statSync(join(dir, ".git", "HEAD")).mtimeMs;
    const patterns = execFileSync("git", ["-C", dir, "sparse-checkout", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (
      age < MAX_AGE_MS && patterns.split("\n").filter(Boolean).join("\n") === SPARSE.join("\n")
    );
  } catch {
    return false;
  }
}

function clone() {
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
    git(["-C", temp, "sparse-checkout", "set", "--no-cone", ...SPARSE]);
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

/**
 * Every file under the checkout's `data/`, as paths from the repository root. A git checkout
 * answers from its tree, which lists the files a sparse clone never downloaded; a plain folder
 * (a test fixture, an exported copy) is walked.
 */
export function dataFiles(repo) {
  if (existsSync(join(repo, ".git"))) {
    try {
      const out = execFileSync(
        "git",
        ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD", "--", "data"],
        {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return out.split("\n").filter(Boolean);
    } catch {
      // Not a usable repository after all: fall back to what is on disk.
    }
  }
  const root = join(repo, "data");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(repo, join(entry.parentPath, entry.name)).split(sep).join("/"));
}
