/**
 * The git identity of the checkout a build is made FROM, shaped as an esbuild/tsup `define`
 * entry so every bundler inlines it verbatim into the artifact.
 *
 * This exists because a built artifact carries no path back to its origin. A bundle pushed
 * into `<root>/hmr/store/cli/<sha>.mjs`, or a dist copied onto a server, sits outside any
 * checkout — asking git at run time from there finds nothing, and asking from the user's
 * working directory would answer about the user's repository instead of the harness. The
 * information only exists while the build is running, so this captures it there.
 *
 * Deliberately free of anything that changes between two builds of identical source — no
 * timestamp, no counter. The HMR store addresses bundles by content hash, so a stamp that
 * varied per build would turn every re-push of unchanged code into a new store entry.
 *
 * Returns `{}` when there is nothing to stamp (no git, or a source tree that is not this
 * repository's checkout). The artifact then carries no stamp and the runtime falls back to
 * asking git about its own checkout, which is what an un-bundled `tsx` or `vitest` run does.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The identifier the bundlers replace; `build-info.ts` declares and reads the same name. */
export const BUILD_GIT_DEFINE = "__PENGUIN_BUILD_GIT__";

/** One git query against the tree being built, or null for any failure at all. */
function git(...args) {
  try {
    const out = execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * This checkout's origin remote, falling back to its directory name — the `repo` half of a
 * push's recorded provenance. Null outside a checkout of this repository.
 */
export function originUrl() {
  if (!isOwnCheckout()) return null;
  return git("remote", "get-url", "origin") ?? path.basename(ROOT);
}

/**
 * The facts a build or a push reports about this checkout, or null outside one. Shared so the
 * revision inlined into a bundle and the revision recorded alongside it in harness.json are
 * the same string by construction rather than by two implementations agreeing.
 */
export function checkoutFacts() {
  if (!isOwnCheckout()) return null;

  const described = git("describe", "--tags", "--dirty", "--always");
  const [commit = null, branch = null] =
    git("rev-parse", "HEAD", "--abbrev-ref", "HEAD")
      ?.split("\n")
      .map((line) => line.trim()) ?? [];
  if (described === null && commit === null) return null;

  return {
    described,
    commit,
    // git's own literal for a detached HEAD, which names no branch.
    branch: branch === "HEAD" ? null : branch,
    dirty: described === null ? null : described.endsWith("-dirty"),
  };
}

/** Whether ROOT is itself a checkout, rather than merely sitting inside somebody else's. */
function isOwnCheckout() {
  const top = git("rev-parse", "--show-toplevel");
  if (top === null) return false;
  try {
    return fs.realpathSync(top) === fs.realpathSync(ROOT);
  } catch {
    return false;
  }
}

/**
 * `{ [BUILD_GIT_DEFINE]: <JS expression> }` for a bundler's `define`, or `{}`.
 *
 * The value is double-encoded on purpose: `define` substitutes a JS *expression*, so the
 * expression has to be a quoted string literal whose contents are the JSON the runtime
 * parses. The shape matches build-info.ts's CheckoutFacts.
 */
export function buildGitDefine() {
  const facts = checkoutFacts();
  return facts === null ? {} : { [BUILD_GIT_DEFINE]: JSON.stringify(JSON.stringify(facts)) };
}
