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
import path from "node:path";
import { describe, expect, beforeAll, afterAll, it } from "vitest";
import { importStream } from "@penguinharness/agent-state-git";
import type { AgentStateCommit } from "@prismshadow/penguin-core/plugin";
import { gixEngine, loadNative } from "../src/engine.js";

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

  it("readBlobs answers what git cat-file answers", async () => {
    const tip = (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    const ls = run(c.gitdir, ["ls-tree", "-r", tip]);
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
});
