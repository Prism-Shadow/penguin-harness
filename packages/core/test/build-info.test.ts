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
  findCheckoutRoot,
  readCheckout,
  resetBuildInfoCache,
  resolveBuildInfo,
} from "../src/internal/build-info.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-build-info-"));
  resetBuildInfoCache();
});

afterEach(async () => {
  resetBuildInfoCache();
  await fsp.rm(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A repository with one commit, plus the workspace marker that makes it "ours". */
async function makeCheckout(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main", ".");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  await fsp.writeFile(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await fsp.writeFile(path.join(dir, "tracked.txt"), "one\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "initial");
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
    git(tmp, "commit", "-qam", "second");
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
