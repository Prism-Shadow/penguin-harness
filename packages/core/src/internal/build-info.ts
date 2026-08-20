/**
 * Resolves the identity of the running build, once per process.
 *
 * The version number alone cannot answer "which code is this?": every build made from a
 * checkout between two releases also calls itself 0.2.3. So the answer is assembled from
 * two disjoint sources, picked by whether the release workflow stamped this build.
 *
 * A stamped release carries everything it needs in constants (see the barrel's VERSION /
 * BUILD_DATE / BUILD_COMMIT) and asks git nothing — an installed penguin never shells out
 * for its own version. Only an unstamped build consults git, and only against the checkout
 * it was built from.
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
 * A tag description this build can present as its own identity: `v` followed by a digit,
 * which is the shape of every tag this project publishes. Anything else `git describe
 * --always` produced — a bare commit sha from a shallow clone or a fork with no tags — is
 * true but does not name a version, so it gets composed into one instead.
 */
const TAG_DESCRIPTION = /^v\d/;

/**
 * Locates the checkout this build came from: walks up from this module's own directory for
 * one holding both `.git` and `pnpm-workspace.yaml`.
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

  const root = findCheckoutRoot(moduleDir);
  const checkout: CheckoutFacts =
    root === null
      ? { described: null, commit: null, branch: null, dirty: null }
      : readCheckout(root);

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
 * no git answer at all. Every form starts with `v<major>.<minor>` so the output of `penguin
 * version` is recognizable as a version whatever the build is.
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
