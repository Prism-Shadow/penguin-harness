/**
 * Build identity: what `penguin version [--json]` and GET /api/version report.
 *
 * The git-backed cases run against real throwaway repositories rather than a stubbed git,
 * because the facts under test are the exact output shapes of `git describe --tags --dirty
 * --always` and of a single `rev-parse` asked for a sha and a branch at once — a stub would
 * assert this file's beliefs about git instead of git's behavior.
 */
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  composeDescribe,
  resetBuildInfoCache,
  resolveBuildInfo,
} from "../src/internal/build-info.js";
import { findCheckoutRoot, readCheckout } from "../src/internal/git-facts.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-build-info-"));
  resetBuildInfoCache();
});

afterEach(async () => {
  resetBuildInfoCache();
  await fsp.rm(tmp, { recursive: true, force: true });
});

/**
 * git against a fixture repository. stderr is dropped rather than inherited: on Windows,
 * `git add` warns about LF being replaced by CRLF for every file, which floods the CI log
 * with dozens of lines that say nothing about the test.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  }).trim();
}

/**
 * A repository with one commit, plus the workspace marker that makes it "ours".
 *
 * Identity rides on the commit as `-c` flags rather than two `git config` calls: this file
 * builds nine of these, and process spawning is expensive enough on a Windows runner to be
 * worth not paying for twice per repository.
 */
async function makeCheckout(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main", ".");
  await fsp.writeFile(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await fsp.writeFile(path.join(dir, "tracked.txt"), "one\n");
  git(dir, "add", ".");
  commit(dir, "initial");
}

/** A commit that carries its own author identity, so the fixture needs no `git config`. */
function commit(dir: string, message: string): void {
  git(dir, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", message);
}

describe("resolveBuildInfo", () => {
  it("reports a stamped build as a release and never consults git", () => {
    const info = resolveBuildInfo({
      version: "1.2.3",
      buildDate: "2026-08-20",
      commit: "a".repeat(40),
    });

    expect(info).toEqual({
      version: "1.2.3",
      describe: "v1.2.3",
      channel: "release",
      buildDate: "2026-08-20",
      commit: "a".repeat(40),
      branch: null,
      // Null rather than false: a release is built from a tree the workflow just stamped.
      dirty: null,
      runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
    });
  });

  it("keeps a release identity even where a checkout surrounds the build", () => {
    // BUILD_DATE alone decides the channel, so a release built and then run from inside the
    // source tree still reports itself as a release rather than picking up the tree's HEAD.
    const info = resolveBuildInfo({ version: "1.2.3", buildDate: "2026-08-20", commit: null });
    expect(info.channel).toBe("release");
    expect(info.branch).toBeNull();
  });

  it("caches, so the CLI rendering -v on every startup pays for git at most once", () => {
    const first = resolveBuildInfo({ version: "1.2.3", buildDate: "2026-08-20", commit: null });
    const second = resolveBuildInfo({ version: "9.9.9", buildDate: "2000-01-01", commit: null });
    expect(second).toBe(first);
  });
});

describe("findCheckoutRoot", () => {
  it("finds the root from a nested directory", async () => {
    await makeCheckout(tmp);
    const nested = path.join(tmp, "packages", "core", "dist");
    await fsp.mkdir(nested, { recursive: true });

    expect(await fsp.realpath(findCheckoutRoot(nested) ?? "")).toBe(await fsp.realpath(tmp));
  });

  it("ignores a repository without the workspace marker", async () => {
    // The case this protects: an install living under a home directory that is itself a
    // dotfiles repo. Reporting a stranger's commits as this build's would be worse than
    // reporting nothing.
    await makeCheckout(tmp);
    await fsp.rm(path.join(tmp, "pnpm-workspace.yaml"));

    expect(findCheckoutRoot(tmp)).toBeNull();
  });

  it("ignores a workspace that is not a repository", async () => {
    await fsp.writeFile(path.join(tmp, "pnpm-workspace.yaml"), "packages: []\n");
    expect(findCheckoutRoot(tmp)).toBeNull();
  });

  it("accepts a linked worktree, where .git is a file", async () => {
    await makeCheckout(tmp);
    const worktree = path.join(tmp, "..", `${path.basename(tmp)}-wt`);
    git(tmp, "worktree", "add", "-q", "-b", "topic", worktree);
    try {
      const stat = await fsp.stat(path.join(worktree, ".git"));
      expect(stat.isFile()).toBe(true);
      expect(await fsp.realpath(findCheckoutRoot(worktree) ?? "")).toBe(
        await fsp.realpath(worktree),
      );
    } finally {
      await fsp.rm(worktree, { recursive: true, force: true });
    }
  });
});

describe("readCheckout", () => {
  it("reads the sha, the branch and a clean tree", async () => {
    await makeCheckout(tmp);
    const facts = readCheckout(tmp);

    expect(facts.commit).toBe(git(tmp, "rev-parse", "HEAD"));
    expect(facts.branch).toBe("main");
    expect(facts.dirty).toBe(false);
  });

  it("describes a tagged commit, and counts commits past the tag", async () => {
    await makeCheckout(tmp);
    git(tmp, "tag", "v0.2.3");
    expect(readCheckout(tmp).described).toBe("v0.2.3");

    await fsp.writeFile(path.join(tmp, "tracked.txt"), "two\n");
    git(tmp, "add", ".");
    commit(tmp, "second");
    expect(readCheckout(tmp).described).toMatch(/^v0\.2\.3-1-g[0-9a-f]+$/);
  });

  it("marks a tree with uncommitted changes as dirty", async () => {
    await makeCheckout(tmp);
    git(tmp, "tag", "v0.2.3");
    await fsp.writeFile(path.join(tmp, "tracked.txt"), "changed\n");

    const facts = readCheckout(tmp);
    expect(facts.dirty).toBe(true);
    expect(facts.described).toBe("v0.2.3-dirty");
  });

  it("falls back to a bare sha where no tag is reachable", async () => {
    await makeCheckout(tmp);
    expect(readCheckout(tmp).described).toMatch(/^[0-9a-f]+$/);
  });

  it("reports a detached HEAD as no branch", async () => {
    await makeCheckout(tmp);
    git(tmp, "checkout", "-q", "--detach");
    expect(readCheckout(tmp).branch).toBeNull();
  });

  it("returns nulls instead of throwing outside a repository", () => {
    expect(readCheckout(tmp)).toEqual({
      described: null,
      commit: null,
      branch: null,
      dirty: null,
    });
  });
});

describe("stampedCheckout", () => {
  // The stamp is a string literal a bundler substituted for a declared-but-never-defined
  // identifier. These drive it through the same globalThis slot the substitution produces,
  // because the alternative — running a real bundler per case — tests esbuild, not this.
  const KEY = "__PENGUIN_BUILD_GIT__";
  const withStamp = <T>(value: unknown, body: () => T): T => {
    const had = KEY in (globalThis as Record<string, unknown>);
    const before = (globalThis as Record<string, unknown>)[KEY];
    (globalThis as Record<string, unknown>)[KEY] = value;
    try {
      return body();
    } finally {
      if (had) (globalThis as Record<string, unknown>)[KEY] = before;
      else delete (globalThis as Record<string, unknown>)[KEY];
    }
  };

  it("reads an inlined stamp, so an artifact identifies itself away from its checkout", () => {
    const stamp = JSON.stringify({
      described: "v0.2.4-3-gfeedface-dirty",
      commit: "f".repeat(40),
      branch: "topic",
      dirty: true,
    });
    const info = withStamp(stamp, () => {
      resetBuildInfoCache();
      return resolveBuildInfo({ version: "0.2.4", buildDate: null, commit: null });
    });

    expect(info.describe).toBe("v0.2.4-3-gfeedface-dirty");
    expect(info.commit).toBe("f".repeat(40));
    expect(info.branch).toBe("topic");
    expect(info.dirty).toBe(true);
  });

  it("prefers the stamp over the tree it happens to be sitting in", () => {
    // A stale `dist/` inside a checkout that has moved on must report the revision it was
    // BUILT from — that is the code actually executing — not the tree's current HEAD.
    const stamp = JSON.stringify({
      described: "v0.0.1-1-gstale00",
      commit: "0".repeat(40),
      branch: "old",
      dirty: false,
    });
    const info = withStamp(stamp, () => {
      resetBuildInfoCache();
      return resolveBuildInfo({ version: "0.2.4", buildDate: null, commit: null });
    });

    expect(info.describe).toBe("v0.0.1-1-gstale00");
    expect(info.commit).toBe("0".repeat(40));
    // This suite runs from a real checkout, so the fallback would have answered otherwise.
    expect(findCheckoutRoot(process.cwd())).not.toBeNull();
  });

  it("falls back to git for a malformed or half-substituted stamp", () => {
    for (const bad of ["not json at all", "", "null", '{"described":42}']) {
      const info = withStamp(bad, () => {
        resetBuildInfoCache();
        return resolveBuildInfo({ version: "0.2.4", buildDate: null, commit: null });
      });
      // Never a throw, and never the garbage: either git answered or every field is null.
      expect(info.describe).toMatch(/^v\d/);
      expect(info.commit === null || /^[0-9a-f]{40}$/.test(info.commit)).toBe(true);
    }
  });

  it("is ignored entirely by a stamped release", () => {
    const stamp = JSON.stringify({
      described: "v9.9.9-1-gbadbad0",
      commit: "9".repeat(40),
      branch: "nope",
      dirty: true,
    });
    const info = withStamp(stamp, () => {
      resetBuildInfoCache();
      return resolveBuildInfo({
        version: "1.0.0",
        buildDate: "2026-08-20",
        commit: "a".repeat(40),
      });
    });

    expect(info.channel).toBe("release");
    expect(info.describe).toBe("v1.0.0");
    expect(info.commit).toBe("a".repeat(40));
    expect(info.branch).toBeNull();
  });
});

describe("composeDescribe", () => {
  it("passes a tag description through unchanged", () => {
    expect(composeDescribe("0.2.3", "v0.2.3")).toBe("v0.2.3");
    expect(composeDescribe("0.2.3", "v0.2.3-14-g9e8f7d6-dirty")).toBe("v0.2.3-14-g9e8f7d6-dirty");
  });

  it("composes a version around a bare sha, keeping git's dirty marker", () => {
    expect(composeDescribe("0.2.3", "9e8f7d6")).toBe("v0.2.3-g9e8f7d6");
    expect(composeDescribe("0.2.3", "9e8f7d6-dirty")).toBe("v0.2.3-g9e8f7d6-dirty");
  });

  it("falls back to the bare version when git answered nothing", () => {
    expect(composeDescribe("0.2.3", null)).toBe("v0.2.3");
  });

  it("keeps git's tag even when it names an earlier version than the constant", () => {
    // The release-preparation window: `release: X.Y.Z` bumps VERSION in its own commit and
    // the tag is created afterwards, so a build from that window has VERSION 0.2.4 while
    // the nearest reachable tag is still v0.2.3. Git's answer is the truthful one — it
    // states where in history this build sits — so it is passed through unchanged rather
    // than rewritten to agree with the constant.
    expect(composeDescribe("0.2.4", "v0.2.3-52-g9e8f7d6")).toBe("v0.2.3-52-g9e8f7d6");
  });

  it("always produces something that reads as a version", () => {
    // `v` and a digit is the guarantee across every input — not `v${version}`, which only
    // the two composed forms can promise.
    for (const described of [null, "v0.2.3", "v0.1.0-1-gabc-dirty", "abc1234", "abc1234-dirty"]) {
      expect(composeDescribe("0.2.3", described)).toMatch(/^v\d/);
    }
  });
});
