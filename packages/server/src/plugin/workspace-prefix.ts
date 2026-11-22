/**
 * The builtin plugin prefix of a workspace checkout: `packages/server/plugins/`, which
 * `scripts/stage-dev-plugins.mjs` stages (from `pnpm build`, the dev prestep and the web e2e run).
 *
 * An installed program finds its builtin plugins one directory above its entry (loader.ts,
 * `pluginBases`). A checkout has several entries — the server's source and dist, the CLI's source
 * (`pnpm penguin`), the dev-linked CLI — and each would look in a different directory; they all
 * fall back to this one prefix instead of three staged copies. Only an entry inside a checkout and
 * outside `node_modules` does: a test runner's own entry (vitest under node_modules) never picks up
 * whatever a developer happened to stage, and an installation has no `pnpm-workspace.yaml` above it.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** The workspace prefix's manifest for a program started from `entry`, or null when there is none. */
export function workspacePrefixManifest(entry: string): string | null {
  if (path.resolve(entry).split(path.sep).includes("node_modules")) return null;
  for (let dir = path.dirname(path.resolve(entry)); ;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return path.join(dir, "packages", "server", "plugins", "package.json");
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
