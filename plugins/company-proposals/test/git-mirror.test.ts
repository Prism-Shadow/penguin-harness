/**
 * The blobless bare mirror over a real git: a temporary repository stands in for the delivery
 * repository (branches and `refs/pull/<n>/head`), the mirror lists its refs with one
 * ls-remote, fetches only the refs it is given, and compares commits the way GitHub's
 * `compare/<base>...<head>` reports them — ahead, behind, same, diverged, and "the commits it
 * lacks carry no content".
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalGitMirror, compareInMirror } from "../src/index.js";

describe("LocalGitMirror", () => {
  let dir: string;
  let origin: string;
  const sha: Record<string, string> = {};

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();

  const commit = async (name: string, file: string, text: string): Promise<string> => {
    await fs.writeFile(path.join(origin, file), text);
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "--allow-empty", "-m", name);
    sha[name] = git(origin, "rev-parse", "HEAD");
    return sha[name]!;
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "git-mirror-"));
    origin = path.join(dir, "origin");
    await fs.mkdir(origin);
    git(origin, "init", "-q", "-b", "main");
    git(origin, "config", "uploadpack.allowFilter", "true");
    await commit("base", "a.txt", "one\n");
    // dev: two commits ahead of main.
    git(origin, "checkout", "-q", "-b", "dev");
    await commit("dev1", "b.txt", "two\n");
    await commit("dev2", "c.txt", "three\n");
    // feat: off main, one commit of its own — diverged from dev.
    git(origin, "checkout", "-q", "-b", "feat", sha.base!);
    await commit("feat1", "d.txt", "four\n");
    // revert: a commit that brings the tree back to base — what it lacks of dev carries nothing.
    git(origin, "checkout", "-q", "-b", "empty", sha.base!);
    await commit("noop", "a.txt", "one\n");
    git(origin, "checkout", "-q", "main");
    git(origin, "update-ref", "refs/pull/7/head", sha.feat1!);
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const mirror = () => new LocalGitMirror({ dir: path.join(dir, "mirror.git"), url: origin });

  it("lists every branch and refs/pull/*/head with one ls-remote, and the default branch", async () => {
    const remote = await mirror().lsRemote();
    expect(remote.head).toBe("main");
    expect(Object.fromEntries(remote.refs)).toEqual({
      "refs/heads/main": sha.base,
      "refs/heads/dev": sha.dev2,
      "refs/heads/feat": sha.feat1,
      "refs/heads/empty": sha.noop,
      "refs/pull/7/head": sha.feat1,
    });
  });

  it("fetches only the refs it is given", async () => {
    const m = mirror();
    expect(await m.missing([sha.dev2!, sha.feat1!])).toEqual([sha.dev2, sha.feat1]);
    await m.fetch(["refs/heads/dev"]);
    expect(await m.missing([sha.dev2!, sha.dev1!, sha.feat1!])).toEqual([sha.feat1]);
    await m.fetch(["refs/pull/7/head", "refs/heads/main", "refs/heads/empty"]);
    expect(await m.missing([sha.feat1!, sha.base!, sha.noop!])).toEqual([]);
    // A bare repository, its refs named as the remote names them.
    expect(git(path.join(dir, "mirror.git"), "rev-parse", "refs/pull/7/head")).toBe(sha.feat1);
    expect(git(path.join(dir, "mirror.git"), "rev-parse", "--is-bare-repository")).toBe("true");
  });

  it("compares as GitHub does: ahead, behind, same, diverged, and empty", async () => {
    const m = mirror();
    await m.fetch(["refs/heads/dev", "refs/heads/main", "refs/heads/feat", "refs/heads/empty"]);
    expect(await compareInMirror(m, sha.base!, sha.dev2!)).toEqual({
      relation: "ahead",
      ahead: 2,
      behind: 0,
      mergeBase: sha.base,
      empty: true,
    });
    expect(await compareInMirror(m, sha.dev2!, sha.base!)).toMatchObject({
      relation: "behind",
      ahead: 0,
      behind: 2,
    });
    expect(await compareInMirror(m, sha.dev2!, sha.dev2!)).toMatchObject({
      relation: "same",
      ahead: 0,
      behind: 0,
    });
    expect(await compareInMirror(m, sha.dev2!, sha.feat1!)).toEqual({
      relation: "diverged",
      ahead: 1,
      behind: 2,
      mergeBase: sha.base,
      empty: false,
    });
    // `noop` lacks dev's two commits, but its own tree is base's: against `noop`, what dev's
    // line lacks is nothing — GitHub's "empty" (the base's tree is the merge base's).
    expect(await compareInMirror(m, sha.noop!, sha.dev2!)).toMatchObject({
      relation: "diverged",
      empty: true,
    });
    expect(await m.isAncestor(sha.base!, sha.dev2!)).toBe(true);
    expect(await m.isAncestor(sha.feat1!, sha.dev2!)).toBe(false);
    expect(await m.mergeBase(sha.feat1!, sha.dev2!)).toBe(sha.base);
    expect(await m.treeEquals(sha.base!, sha.noop!)).toBe(true);
    expect(await m.treeEquals(sha.base!, sha.dev1!)).toBe(false);
  });

  it("fails with the reason when the remote cannot be read", async () => {
    const m = new LocalGitMirror({ dir: path.join(dir, "gone.git"), url: path.join(dir, "nope") });
    await expect(m.lsRemote()).rejects.toThrow(/git ls-remote failed/);
  });
});
