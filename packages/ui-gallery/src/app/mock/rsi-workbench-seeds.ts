/**
 * Where the pinned Self-Evolution Workbench's seeds are, for the Vite and Vitest configs: an
 * `import.meta.glob` takes an alias but no package name, so benchmark-seeds.ts globs the seed
 * folders through {@link RSI_WORKBENCH_SEEDS}, which the configs point at the folder the package's
 * `./workbenches/*` export resolves to. Node code: the configs import it, the page never does.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";

/** The alias benchmark-seeds.ts globs the seed folders through. */
export const RSI_WORKBENCH_SEEDS = "@rsi-workbench-seeds";

/** The package's `workbenches/benchmark/seeds/` folder on this machine. */
export function rsiWorkbenchSeedsDir(): string {
  const catalog = createRequire(import.meta.url).resolve(
    "@penguinharness/rsi-workbench/workbenches/benchmark/seeds/catalog.json",
  );
  return dirname(catalog);
}
