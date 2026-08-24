/**
 * Resolves the identity of the running build, once per process.
 *
 * The version number alone cannot answer "which code is this?": every build made from a
 * checkout between two releases also calls itself 0.2.3. So the answer is assembled from
 * two disjoint sources, picked by whether the release workflow stamped this build.
 *
 * A stamped release carries everything it needs in constants (see the barrel's VERSION /
 * BUILD_DATE / BUILD_COMMIT) and asks git nothing — an installed penguin never shells out
 * for its own version.
 *
 * An unstamped build reads its git position from the stamp a bundler inlined at build time
 * (see __PENGUIN_BUILD_GIT__), which is what lets an artifact identify itself after it has
 * left the checkout that produced it. Asking git at run time is only the fallback, for a run
 * that never went through a bundler at all.
 *
 * The single consumer-visible product is {@link BuildInfo}, which `penguin version`,
 * `penguin version --json` and GET /api/version all render without adding facts of their
 * own, so those three can never disagree about what is running.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildInfo } from "../interfaces.js";

/** The stamped constants this module reads, passed in by the barrel that declares them. */
export interface BuildStamp {
  version: string;
  buildDate: string | null;
  commit: string | null;
}

/** A hung git (a network-backed filesystem, a stale lock) must not hang `penguin -v`. */
const GIT_TIMEOUT_MS = 2000;

/** Where this build's own files are — the only honest place to start looking for its checkout. */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The git identity of the checkout this artifact was BUILT from, inlined verbatim at bundle
 * time (scripts/build-git-stamp.mjs supplies it to core/cli/desktop's tsup configs and to
 * scripts/deploy.mjs's esbuild).
 *
 * It is the only thing that can identify a bundle which no longer sits in a checkout — one
 * pushed into `<root>/hmr/store/`, or a dist copied onto a server — where the walk-up below
 * finds nothing and the working directory would answer about the user's own repository.
 *
 * Authoritative over anything git says at run time, because it describes the code that is
 * EXECUTING, while the surrounding tree may have moved on since the build: running a stale
 * `dist/` from a checkout that is now ten commits further along reports the build's own
 * revision, not the tree's.
 *
 * Declared and never defined: `typeof` on a missing identifier is legal JavaScript, so an
 * un-bundled run — `tsx`, `vitest`, `pnpm dev` — finds no stamp and falls through to git.
 * When a bundler does substitute it, that same `typeof` folds to a constant and the fallback
 * is eliminated with it.
 */
declare const __PENGUIN_BUILD_GIT__: string | undefined;

/**
 * A tag description this build can present as its own identity: `v` followed by a digit,
 * which is the shape of every tag this project publishes. Anything else `git describe
 * --always` produced — a bare commit sha from a shallow clone or a fork with no tags — is
 * true but does not name a version, so it gets composed into one instead.
 */
const TAG_DESCRIPTION = /^v\d/;

/**
 * Locates the checkout this build is sitting in: walks up from this module's own directory
 * for one holding both `.git` and `pnpm-workspace.yaml`. Reached only when no build-time
 * stamp was inlined — an un-bundled `tsx` / `vitest` / `pnpm dev` run.
 *
 * Both halves of that test are load-bearing. Starting from the module rather than the
 * working directory is what makes `penguin version` report the harness's revision when it
 * is run inside somebody else's repository. Requiring the workspace marker beside `.git` is
 * what stops an install that merely sits under an unrelated repository — a home directory
 * that is itself a dotfiles repo, which is common — from reporting a stranger's commits as
 * this build's; finding nothing is the better answer there.
 *
 * `.git` is tested for existence rather than for being a directory: in a linked worktree it
 * is a file pointing at the real git directory, and this project's own work happens in
 * worktrees.
 *
 * `startDir` is a parameter only so tests can aim it at a fixture; production passes
 * {@link moduleDir}.
 */
export function findCheckoutRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, ".git")) && existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * One git invocation against `root`, or null for any failure at all — git missing from
 * PATH, a repository too broken to answer, the timeout. Version reporting is never worth an
 * exception, and a null here degrades to the plain `v<version>` form.
 */
function git(root: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      // git's own diagnostics would otherwise land on the CLI's stderr.
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The git half of a source build's identity, before composition. `described` is git's raw
 * answer, which may name no version at all — distinct from BuildInfo's `describe`, which
 * always does.
 */
interface CheckoutFacts {
  described: string | null;
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
}

/** Reads a checkout's facts; every field independently degrades to null. */
export function readCheckout(root: string): CheckoutFacts {
  // `--always` keeps this useful in a shallow clone or a tagless fork, where a description
  // relative to a tag cannot be produced; `--dirty` is the uncommitted-changes marker.
  const described = git(root, ["describe", "--tags", "--dirty", "--always"]);
  // One invocation for both: rev-parse resolves its arguments in order, and --abbrev-ref
  // applies to the ones after it, so this prints the full sha then the branch name.
  const [commit = null, branch = null] =
    git(root, ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"])
      ?.split("\n")
      .map((line) => line.trim()) ?? [];

  return {
    described,
    commit,
    // Detached HEAD is git's own literal "HEAD" here, which names no branch.
    branch: branch === "HEAD" ? null : branch,
    dirty: described === null ? null : described.endsWith("-dirty"),
  };
}

/**
 * The inlined stamp, or null when this artifact carries none. Every field is re-checked
 * rather than trusted: the value is a string literal a bundler substituted, and a
 * hand-edited or half-substituted bundle must degrade to fewer facts, not throw on startup.
 */
function stampedCheckout(): CheckoutFacts | null {
  if (typeof __PENGUIN_BUILD_GIT__ !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(__PENGUIN_BUILD_GIT__);
  } catch {
    return null;
  }
  // JSON.parse yields any JSON value, not necessarily an object: `null`, a number and a
  // string all parse successfully, and reading a field off them is a TypeError.
  if (typeof parsed !== "object" || parsed === null) return null;

  const fields = parsed as Partial<CheckoutFacts>;
  const facts: CheckoutFacts = {
    described: typeof fields.described === "string" ? fields.described : null,
    commit: typeof fields.commit === "string" ? fields.commit : null,
    branch: typeof fields.branch === "string" ? fields.branch : null,
    dirty: typeof fields.dirty === "boolean" ? fields.dirty : null,
  };
  // A stamp naming neither a description nor a commit says nothing about this artifact, so
  // it counts as absent — the same condition under which build-git-stamp.mjs emits none.
  return facts.described === null && facts.commit === null ? null : facts;
}

/** The checkout this artifact reports: its build-time stamp, else the tree it is sitting in. */
function checkoutFacts(): CheckoutFacts {
  const stamped = stampedCheckout();
  if (stamped !== null) return stamped;
  const root = findCheckoutRoot(moduleDir);
  return root === null
    ? { described: null, commit: null, branch: null, dirty: null }
    : readCheckout(root);
}

let cached: BuildInfo | null = null;

/**
 * Assembles the running build's identity from the stamped constants, consulting git only
 * for an unstamped build. Cached: the answer cannot change within a process, and the CLI
 * asks for it on every startup to render `-v`.
 */
export function resolveBuildInfo(stamp: BuildStamp): BuildInfo {
  if (cached !== null) return cached;

  const runtime = {
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };

  // BUILD_DATE is the marker: the release workflow always stamps it, whereas BUILD_COMMIT
  // is only stamped where the workflow knows the sha.
  if (stamp.buildDate !== null) {
    cached = {
      version: stamp.version,
      describe: `v${stamp.version}`,
      channel: "release",
      buildDate: stamp.buildDate,
      commit: stamp.commit,
      branch: null,
      // Not false: the release workflow stamps its constants into the tree before building,
      // so the checkout a release is built from is dirty by construction and claiming
      // otherwise would be a lie. Cleanliness is simply not a fact about a release build.
      dirty: null,
      runtime,
    };
    return cached;
  }

  const checkout = checkoutFacts();

  cached = {
    version: stamp.version,
    describe: composeDescribe(stamp.version, checkout.described),
    channel: "source",
    buildDate: null,
    commit: checkout.commit ?? stamp.commit,
    branch: checkout.branch,
    dirty: checkout.dirty,
    runtime,
  };
  return cached;
}

/**
 * The one-line identity: git's description when it already names a version, the version
 * number carrying git's commit when it does not, and the bare version number when there is
 * no git answer at all. Every form starts with `v` and a digit, so `penguin version` always
 * reads as a version — but only the two composed forms start with `v{version}`: a tag
 * description is git's own answer, passed through, and it names the nearest reachable tag
 * rather than the version constant. The two disagree throughout release preparation, when
 * VERSION is bumped in its own commit and the tag follows; git's answer is the honest one
 * there, so it wins.
 */
export function composeDescribe(version: string, described: string | null): string {
  if (described === null) return `v${version}`;
  if (TAG_DESCRIPTION.test(described)) return described;
  // A bare sha (with git's own `-dirty` suffix already attached, if any); `g` prefixes it to
  // match the way `git describe` spells a commit inside a description.
  return `v${version}-g${described}`;
}

/** Test seam: drops the process-lifetime cache so a test can resolve against a new stamp. */
export function resetBuildInfoCache(): void {
  cached = null;
}
