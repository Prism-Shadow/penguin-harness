/**
 * Where the Benchmarks and Leaderboards pages read penguin-harness-benchmark from.
 *
 * A build fetches the index afresh. Each pinned data repository gets one sparse checkout with
 * READMEs and task instructions. Other files are listed from the Git tree. Older index revisions
 * keep their data in the index checkout. The dev server reuses a fresh clone (see `fresh`).
 * PENGUIN_BENCHMARK_REPO selects an offline index checkout, with data in its sibling repositories
 * or the cache in this package's node_modules.
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
 * Every file under the prefix, as paths from the repository root. A git checkout
 * answers from its tree, which lists the files a sparse clone never downloaded; a plain folder
 * (a test fixture, an exported copy) is walked.
 */
export function dataFiles(repo, prefix = "data") {
  if (existsSync(join(repo, ".git"))) {
    try {
      const out = execFileSync(
        "git",
        ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD", "--", ...(prefix ? [prefix] : [])],
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
  const root = join(repo, prefix);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(repo, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.startsWith(".git/"));
}

/** A pinned dataset checkout for the file browser. Only README and instruction text is downloaded. */
export function pinnedDataRepo(repository, commit) {
  const dest = join(CACHE_DIR, "data", repository, commit);
  if (existsSync(join(dest, ".git"))) return dest;
  const git = (args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const local = process.env.PENGUIN_BENCHMARK_REPO;
  const sibling = local && join(dirname(resolve(local)), repository.split("/")[1]);
  if (sibling && !existsSync(join(sibling, ".git"))) return undefined;
  mkdirSync(dirname(dest), { recursive: true });
  const temp = mkdtempSync(join(dirname(dest), "fetch-"));
  try {
    git(["init", "-q", temp]);
    git(["-C", temp, "config", "core.longpaths", "true"]);
    git(["-C", temp, "remote", "add", "origin", sibling || `https://github.com/${repository}.git`]);
    git(["-C", temp, "sparse-checkout", "set", "--no-cone", "README.md", "instruction.md"]);
    git(["-C", temp, "fetch", "--depth=1", "--filter=blob:none", "--no-tags", "origin", commit]);
    git(["-C", temp, "checkout", "--detach", "-q", "FETCH_HEAD"]);
    renameSync(temp, dest);
  } catch (error) {
    // Another site build may have published the same immutable checkout.
    if (!existsSync(join(dest, ".git"))) throw error;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return dest;
}
