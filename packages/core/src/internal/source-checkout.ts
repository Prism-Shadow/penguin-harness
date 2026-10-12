/**
 * Whether the running code is a source checkout of this repository: the fact that picks the
 * default data root when `PENGUIN_HOME` is unset (state/paths.ts resolveRoot).
 *
 * Decided at run time from the module's own location, never by a build flag: releases are built
 * from a checkout too, and what matters is where the code runs from now. A checkout reaches
 * this module as TypeScript source under tsx or vitest, as `packages/core/dist`, as the copy
 * pnpm injected under `node_modules/.pnpm/…` for the server, or inlined into a bundle that
 * still sits in the tree (`packages/cli/dist/penguin.js`, the desktop shell's) — all of them
 * somewhere below the workspace root, so the answer is a walk up to it.
 *
 * What the walk must not find is a workspace that is not this repository. The SDK installed
 * from npm into somebody else's pnpm monorepo sits under a `pnpm-workspace.yaml` as well, so a
 * workspace counts only when its `packages/core` is this package. An installation never has
 * one above it: the installer's `~/.penguin/lib/dist/`, an npm install under
 * `node_modules/@prismshadow/…`, the desktop app's packaged resources and a bundle pushed into
 * `<root>/hmr/store/` all walk to the filesystem root without a match.
 *
 * Not build-info's findCheckoutRoot (git-facts.ts), which asks a different question: where git
 * facts can be read, so it needs `.git` and accepts any workspace beside it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The name this repository's core package carries; it is what makes a workspace this one. */
const CORE_PACKAGE = "@prismshadow/penguin-core";

/** Whether `dir` is the root of this repository's workspace. */
function isHarnessWorkspace(dir: string): boolean {
  if (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return false;
  try {
    const raw = fs.readFileSync(path.join(dir, "packages", "core", "package.json"), "utf8");
    return (JSON.parse(raw) as { name?: unknown }).name === CORE_PACKAGE;
  } catch {
    return false;
  }
}

/**
 * The root of the checkout of this repository that `fromDir` lies in, or null outside one.
 * Pass a module's own directory, never the working directory: a command run inside a checkout
 * by an installed CLI is still an installation.
 */
export function sourceCheckoutRoot(fromDir: string): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (isHarnessWorkspace(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let cached: boolean | undefined;

/**
 * Whether this copy of core runs from a source checkout. Resolved once per process: the
 * module does not move while it runs. The real path is walked, so a globally linked CLI (a
 * symlink into the checkout, which `pnpm build` creates) still counts as the checkout; any
 * failure to locate the module reads as an installation, the default that predates this rule.
 */
export function runsFromSourceCheckout(): boolean {
  if (cached === undefined) {
    try {
      const here = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
      cached = sourceCheckoutRoot(here) !== null;
    } catch {
      cached = false;
    }
  }
  return cached;
}
