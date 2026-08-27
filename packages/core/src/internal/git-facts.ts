/**
 * How this repository reads git — the one implementation, shared by the two places that ask.
 *
 * Both a build and a run need the same four facts about a checkout, and they have to agree:
 * a bundled artifact reports the stamp a build captured (see build-info.ts's
 * __PENGUIN_BUILD_GIT__, fed by scripts/build-git-stamp.mjs), while an un-bundled run asks
 * git directly. Two implementations of "what does `-dirty` mean" or "what is a detached
 * HEAD" would make `penguin version` answer differently depending on how it was launched,
 * which is the one thing version reporting must not do.
 *
 * The build script imports this module directly: Node strips the types (>=24, which this
 * package requires), and esbuild does the same when a tsup config loads the script.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** A hung git (a network-backed filesystem, a stale lock) must not hang `penguin -v`. */
const GIT_TIMEOUT_MS = 2000;

/** What a checkout says about itself. Every field independently degrades to null. */
export interface CheckoutFacts {
  /**
   * Raw `git describe` output, which may name no version at all — a bare sha from a shallow
   * clone or a tagless fork. Distinct from BuildInfo's `describe`, which always names one.
   */
  described: string | null;
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
}

/**
 * One git invocation against `root`, or null for any failure at all — git missing from
 * PATH, a repository too broken to answer, the timeout. Version reporting is never worth an
 * exception, and a null degrades to fewer facts rather than none.
 */
export function git(root: string, args: string[]): string | null {
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
 * Locates a checkout of THIS repository at or above `startDir`: the first directory holding
 * both `.git` and `pnpm-workspace.yaml`.
 *
 * Both halves of that test are load-bearing. Callers start from a module's or a script's own
 * directory rather than the working directory, which is what makes `penguin version` report
 * the harness's revision when run inside somebody else's repository. Requiring the workspace
 * marker beside `.git` is what stops a tree that merely sits under an unrelated repository —
 * a home directory that is itself a dotfiles repo, which is common — from reporting a
 * stranger's commits; finding nothing is the better answer there.
 *
 * `.git` is tested for existence rather than for being a directory: in a linked worktree it
 * is a file pointing at the real git directory, and this project's own work happens in
 * worktrees.
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

/** Reads a checkout's facts. This is the only place the four rules below are decided. */
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
