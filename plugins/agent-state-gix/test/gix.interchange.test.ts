/**
 * The interchange gate: the same input is the same commit under gitoxide and under real Git.
 *
 * The real-Git side of each check runs the host's git binary with the stream the dugite plugin's
 * engine feeds it (`importStream`) — the pipeline the gate already proved byte-equal to the
 * built-in engine. If gitoxide answers the same commit id for the same input, both sides wrote
 * the same bytes: trees, order, identity lines, message whole. Reading back is checked the same
 * way, against `git cat-file`, and `git fsck` arbitrates the repository's health after every
 * writer ran.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import { describe, expect, beforeAll, afterAll, it } from "vitest";
import { importStream } from "@penguinharness/agent-state-git";
import type { AgentStateCommit } from "@prismshadow/penguin-core/plugin";
import { gixEngine } from "../src/engine.js";
import { loadNative } from "../src/binary.js";

const GIT = "git";

function run(
  gitdir: string,
  args: string[],
  input?: Uint8Array,
): { status: number; stdout: Buffer; stderr: string } {
  const r = spawnSync(GIT, ["--git-dir", gitdir, ...args], {
    input: input ?? Buffer.alloc(0),
    windowsHide: true,
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr.toString() };
}

/**
 * The gitcl pipeline's commit (the real-Git engine the ⑨ branch ships): a throwaway worktree on
 * the parent, the folder replaced wholesale, one add, one commit, and the branch moved only from
 * the parent it names. Present here so both directions of the interchange are pinned against the
 * engine gix must stand in for.
 */
function gitclCommit(c: AgentStateCommit): string {
  const tmp = fss.mkdtempSync(path.join(path.dirname(c.gitdir), "gitcl-"));
  try {
    if (c.parent !== null) {
      const wt = run(c.gitdir, ["worktree", "add", "--detach", tmp, c.parent]);
      expect(wt.status, wt.stderr).toBe(0);
    } else {
      const init = spawnSync(GIT, ["init", "-q", tmp], { windowsHide: true });
      expect(init.status).toBe(0);
    }
    const dir = path.join(tmp, c.rel);
    fss.rmSync(dir, { recursive: true, force: true });
    for (const file of c.files ?? []) {
      fss.mkdirSync(path.dirname(path.join(dir, file.rel)), { recursive: true });
      fss.writeFileSync(path.join(dir, file.rel), file.body);
    }
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: c.author.name,
      GIT_AUTHOR_EMAIL: c.author.email,
      GIT_AUTHOR_DATE: `${c.when.seconds} +0800`,
      GIT_COMMITTER_NAME: c.committer.name,
      GIT_COMMITTER_EMAIL: c.committer.email,
      GIT_COMMITTER_DATE: `${c.when.seconds} +0800`,
    };
    const feed = { input: Buffer.from(c.message, "utf8"), env, windowsHide: true };
    if (c.parent !== null || (c.files?.length ?? 0) > 0) {
      expect(spawnSync(GIT, ["-C", tmp, "add", "-A", "-f", "--", c.rel], feed).status).toBe(0);
      const commit = spawnSync(
        GIT,
        ["-C", tmp, "commit", "-q", "--cleanup=verbatim", "-F", "-"],
        feed,
      );
      expect(commit.status, commit.stderr.toString()).toBe(0);
    } else {
      const commit = spawnSync(
        GIT,
        ["-C", tmp, "commit", "-q", "--allow-empty", "--cleanup=verbatim", "-F", "-"],
        feed,
      );
      expect(commit.status, commit.stderr.toString()).toBe(0);
    }
    const sha = spawnSync(GIT, ["-C", tmp, "rev-parse", "HEAD"], feed).stdout.toString().trim();
    if (c.parent !== null) {
      const move = run(c.gitdir, ["update-ref", c.ref, sha, c.parent]);
      expect(move.status, move.stderr).toBe(0);
    } else {
      const push = spawnSync(GIT, ["-C", tmp, "push", "-q", c.gitdir, `HEAD:${c.ref}`], {
        ...feed,
        env: { ...env, GIT_DIR: undefined },
      });
      expect(push.status, push.stderr.toString()).toBe(0);
    }
    return sha;
  } finally {
    if (c.parent !== null) {
      run(c.gitdir, ["worktree", "remove", "--force", tmp]);
    }
    fss.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The commit the real-Git side writes for this input: one fast-import, then the branch's id. */
function realGitCommit(c: AgentStateCommit): string {
  const r = run(
    c.gitdir,
    ["-c", "fastimport.unpackLimit=2147483647", "fast-import", "--quiet", "--done"],
    importStream(c),
  );
  expect(r.status, r.stderr).toBe(0);
  return fs.readFile(path.join(c.gitdir, c.ref), "utf8").then((s) => s.trim()) as never;
}

const WHEN = { seconds: 1_700_000_000, offset: 480 };
const WHO = { name: "Penguin", email: "penguin@example.com" };

const dir = async (): Promise<AgentStateCommit> => {
  const root = await fs.mkdtemp(path.join(import.meta.dirname!, "gix-"));
  const gitdir = path.join(root, "repo.git");
  const init = spawnSync(GIT, ["init", "--bare", "--initial-branch=main", gitdir], {
    windowsHide: true,
  });
  expect(init.status).toBe(0);
  return {
    gitdir,
    ref: "refs/heads/main",
    parent: null,
    rel: "workbenches/w1",
    files: [
      { rel: "a.txt", body: Buffer.from("alpha\n") },
      { rel: "sub/b.txt", body: Buffer.from("bravo\n") },
    ],
    message: "first\n",
    author: WHO,
    committer: WHO,
    when: WHEN,
  } as const;
};

describe("agent-state-gix interchange with real Git", () => {
  const native = loadNative();
  const engine = gixEngine(native, native.engineVersion());
  let c: Awaited<ReturnType<typeof dir>>;

  beforeAll(async () => {
    c = await dir();
  });
  afterAll(async () => {
    await fs.rm(path.dirname(c.gitdir), { recursive: true, force: true }).catch(() => undefined);
  });

  it("the native half loads and says who it is", () => {
    expect(native.engineVersion()).toMatch(/gitoxide \d+\.\d+/);
  });

  it("the first commit: gitoxide and real Git write the same commit id", async () => {
    const gixSha = await engine.commit({ ...c });
    const realSha = await realGitCommit({ ...c });
    expect(gixSha).toBe(realSha);
    expect(gixSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("a first commit refuses an existing branch, like real Git does", async () => {
    // The branch now exists (both writers above). A fresh first commit must refuse.
    await expect(
      engine.commit({ ...c, parent: null, rel: "workbenches/w2", files: [{ rel: "x", body: Buffer.from("x") }] }),
    ).rejects.toThrow(/refused|exist/i);
  });

  it("the second commit on the parent: same id from both sides", async () => {
    const first = (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    const next: AgentStateCommit = {
      ...c,
      parent: first,
      files: [
        { rel: "a.txt", body: Buffer.from("alpha 2\n") },
        // sub/b.txt goes: the folder replaces wholesale.
      ],
    };
    const gixSha = await engine.commit(next);
    const realSha = await realGitCommit(next);
    expect(gixSha).toBe(realSha);
  });

  it("a stale parent refuses the write, like update-ref does", async () => {
    const tip = (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    await expect(
      engine.commit({ ...c, parent: "0".repeat(40) }),
    ).rejects.toThrow();
    expect((await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim()).toBe(tip);
  });

  it("a folder removal: same id from both sides, the folder gone from the tree", async () => {
    const tip = (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    const removal: AgentStateCommit = { ...c, parent: tip, files: null };
    const gixSha = await engine.commit(removal);
    const realSha = await realGitCommit(removal);
    expect(gixSha).toBe(realSha);
    const ls = run(c.gitdir, ["ls-tree", "-r", gixSha]);
    expect(ls.stdout.toString()).not.toContain("workbenches/w1");
  });

  it("a first commit with no files is the empty tree, same id from both sides — on a fresh branch", async () => {
    // The main branch already carries commits at this point, so the CAS must and does refuse a
    // fresh first commit there; the empty-tree first commit is pinned on its own repository.
    await expect(
      engine.commit({ ...c, files: null }),
    ).rejects.toThrow(/refused/i);
    const root = await fs.mkdtemp(path.join(import.meta.dirname!, "gix-empty-"));
    try {
      const gitdir = path.join(root, "repo.git");
      expect(spawnSync(GIT, ["init", "--bare", "--initial-branch=main", gitdir]).status).toBe(0);
      const empty: AgentStateCommit = { ...c, gitdir, rel: "workbenches/w-empty", files: null };
      const gixSha = await engine.commit(empty);
      const realSha = await realGitCommit(empty);
      expect(gixSha).toBe(realSha);
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("readBlobs answers what git cat-file answers", async () => {
    // Self-contained: write a folder of its own, then read its blobs back.
    const tip = (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    const next: AgentStateCommit = {
      ...c,
      parent: tip,
      rel: "workbenches/w-read",
      files: [
        { rel: "read/one.txt", body: Buffer.from("one\n") },
        { rel: "read/two.bin", body: Buffer.from([0x00, 0xff, 0x10, 0x7f]) },
      ],
    };
    const sha = await engine.commit(next);
    const ls = run(c.gitdir, ["ls-tree", "-r", sha]);
    expect(ls.status).toBe(0);
    const oids = [...ls.stdout.toString().matchAll(/blob ([0-9a-f]{40})\t/g)].map((m) => m[1]!);
    expect(oids.length).toBeGreaterThan(0);
    const mine = await engine.readBlobs(c.gitdir, oids);
    for (const [i, oid] of oids.entries()) {
      const theirs = run(c.gitdir, ["cat-file", "blob", oid]).stdout;
      expect(Buffer.from(mine[i]!).equals(theirs), oid).toBe(true);
    }
  });

  it("a missing blob id refuses", async () => {
    await expect(
      engine.readBlobs(c.gitdir, ["1".repeat(40)]),
    ).rejects.toThrow(/not in the repository/);
  });

  it("git fsck says the repository is healthy after both writers ran", () => {
    const fsck = run(c.gitdir, ["fsck", "--strict"]);
    expect(fsck.stderr + fsck.stdout).not.toMatch(/missing|corrupt|dangling commit/);
    expect(fsck.status).toBe(0);
  });

  it("gitcl builds on gix's history; gix reads it back", async () => {
    const tip = (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    // gitcl's flow: a throwaway worktree on gix's tip, the folder replaced, update-ref CAS.
    const sha = gitclCommit({
      ...c,
      parent: tip,
      rel: "workbenches/w-after-gix",
      files: [{ rel: "gitcl.txt", body: Buffer.from("written by the gitcl pipeline\n") }],
    });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // gix reads the gitcl-written blobs back, whole.
    const ls = run(c.gitdir, ["ls-tree", "-r", sha]);
    const oids = [...ls.stdout.toString().matchAll(/blob ([0-9a-f]{40})\t/g)].map((m) => m[1]!);
    const mine = await engine.readBlobs(c.gitdir, oids);
    expect(mine[0]!.toString()).toBe("written by the gitcl pipeline\n");
    // The history walk sees gitcl's commit on gix's tip: its parent is what gix wrote.
    const commitBody = run(c.gitdir, ["cat-file", "commit", sha]).stdout.toString();
    expect(commitBody).toMatch(/^tree [0-9a-f]{40}/m);
    expect(commitBody).toMatch(new RegExp(`parent ${tip}`));
    // git fsck arbitrates the mixed history.
    const fsck = run(c.gitdir, ["fsck", "--strict"]);
    expect(fsck.status).toBe(0);
  });

  it("gix builds on gitcl's history; gitcl reads it back", async () => {
    // gitcl writes first, on its own branch.
    const first = gitclCommit({
      ...c,
      ref: "refs/heads/gitcl-first",
      files: [{ rel: "seed.txt", body: Buffer.from("seed by gitcl\n") }],
    });
    // gix commits on top with the CAS the interface asks for.
    const sha = await engine.commit({
      ...c,
      ref: "refs/heads/gitcl-first",
      parent: first,
      rel: "workbenches/w-after-gitcl",
      files: [{ rel: "gix.txt", body: Buffer.from("written by gitoxide\n") }],
    });
    // gitcl's reader (cat-file, the shape its batch reads take) reads gix's objects back.
    const ls = run(c.gitdir, ["ls-tree", "-r", sha]);
    const gixOid = /blob ([0-9a-f]{40})\tworkbenches\/w-after-gitcl\/gix\.txt/.exec(
      ls.stdout.toString(),
    )![1]!;
    const blob = run(c.gitdir, ["cat-file", "blob", gixOid]).stdout.toString();
    expect(blob).toBe("written by gitoxide\n");
    // And the commit id both sides see is the same object: gitcl's rev-parse answers it.
    const tip = run(c.gitdir, ["rev-parse", "refs/heads/gitcl-first"]).stdout.toString().trim();
    expect(tip).toBe(sha);
    const fsck = run(c.gitdir, ["fsck", "--strict"]);
    expect(fsck.status).toBe(0);
  });
});
