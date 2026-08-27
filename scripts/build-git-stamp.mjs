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
 * It reads git through core's own `internal/git-facts.ts` rather than reimplementing it: the
 * stamp and the runtime fallback answer the same question, so one rule set decides what
 * `-dirty` means and what a detached HEAD is. Importing TypeScript from a plain `.mjs` works
 * because Node strips types (>=24, which this repo requires) and esbuild does the same when a
 * tsup config loads this module.
 *
 * Deliberately free of anything that changes between two builds of identical source — no
 * timestamp, no counter. The HMR store addresses bundles by content hash, so a stamp that
 * varied per build would turn every re-push of unchanged code into a new store entry.
 *
 * Returns `{}` when there is nothing to stamp (no git, or a tree that is not this
 * repository's checkout). The artifact then carries no stamp and the runtime falls back to
 * asking git about its own checkout, which is what an un-bundled `tsx` or `vitest` run does.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCheckoutRoot, git, readCheckout } from "../packages/core/src/internal/git-facts.ts";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The identifier the bundlers replace; `build-info.ts` declares and reads the same name. */
export const BUILD_GIT_DEFINE = "__PENGUIN_BUILD_GIT__";

/**
 * The checkout this build is running from, or null when it is not one of ours — the same
 * `.git` + `pnpm-workspace.yaml` test the runtime fallback applies, so a source tree
 * extracted inside an unrelated repository stamps nothing rather than that repository.
 */
function root() {
  return findCheckoutRoot(HERE);
}

/**
 * This checkout's origin remote, falling back to its directory name — the `repo` half of a
 * push's recorded provenance. Null outside a checkout of this repository.
 */
export function originUrl() {
  const dir = root();
  if (dir === null) return null;
  return git(dir, ["remote", "get-url", "origin"]) ?? path.basename(dir);
}

/** The facts a build or a push reports about this checkout, or null outside one. */
export function checkoutFacts() {
  const dir = root();
  if (dir === null) return null;
  const facts = readCheckout(dir);
  // Naming neither a description nor a commit says nothing about the artifact; the runtime
  // treats such a stamp as absent too, so do not emit one.
  return facts.described === null && facts.commit === null ? null : facts;
}

/**
 * `{ [BUILD_GIT_DEFINE]: <JS expression> }` for a bundler's `define`, or `{}`.
 *
 * The value is double-encoded on purpose: `define` substitutes a JS *expression*, so the
 * expression has to be a quoted string literal whose contents are the JSON the runtime
 * parses back into CheckoutFacts.
 */
export function buildGitDefine() {
  const facts = checkoutFacts();
  return facts === null ? {} : { [BUILD_GIT_DEFINE]: JSON.stringify(JSON.stringify(facts)) };
}
