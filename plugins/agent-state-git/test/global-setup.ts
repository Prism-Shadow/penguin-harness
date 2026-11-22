// The live suites run the Git this plugin runs. A bare test run fetches it once into the
// repository's cache (dugite's pinned archive, verified; DUGITE_CACHE_DIR may already hold it),
// and every suite then finds it there. A host that cannot get it skips them, unless
// PENGUIN_MUST_RUN names agent-state-git (scripts/must-run.mjs).
import { locateGit } from "../src/binary.js";
import { GIT_CACHE } from "./cache.js";

export default async function setup(): Promise<void> {
  try {
    await locateGit({ cacheDir: GIT_CACHE, log: (line) => console.log(line) });
  } catch (err) {
    console.warn(
      `[agent-state-git] no Git for the live suites: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
