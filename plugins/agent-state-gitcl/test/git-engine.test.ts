/**
 * Unit tests for `@penguinharness/agent-state-gitcl` pure-plumbing `GitEngine` / `GitRepo`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GitCommitInput, GitError } from "@prismshadow/penguin-core/plugin";
import { gitclGitEngine } from "../src/git-engine.js";

const GIT = "git";
const gitVersion = /^git version (\S+)/.exec(
  spawnSync(GIT, ["version"], { encoding: "utf8", windowsHide: true }).stdout ?? "",
)?.[1];

function initBare(gitdir: string): void {
  const r = spawnSync(GIT, ["init", "--bare", "--initial-branch=main", gitdir], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`git init --bare failed: ${r.stderr}`);
}

describe("agent-state-gitcl exports", () => {
  it("exports gitclGitEngine", () => {
    expect(typeof gitclGitEngine).toBe("function");
  });
});

describe.skipIf(gitVersion === undefined)("gitclGitEngine (pure-plumbing Git CLI)", () => {
  let root: string;
  let diskDir: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-gitcl-test-"));
    diskDir = path.join(root, "disk");
    await fs.mkdir(diskDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  async function writeSource(name: string, content: string | Uint8Array): Promise<string> {
    const p = path.join(diskDir, name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return p;
  }

  it("supports replace, patch, listTree, walkHistory, extractTree, CAS conflict, and beforeMoveRef abort", async () => {
    const gitdir = path.join(root, "lifecycle.git");
    initBare(gitdir);
    const engine = gitclGitEngine({ program: GIT }, gitVersion!);
    const repo = await engine.open(gitdir);
    try {
      expect(await repo.resolveHead()).toEqual({ ref: "refs/heads/main", commit: null });

      const f1 = await writeSource("a.txt", "hello\n");
      const f2 = await writeSource("sub/b.bin", new Uint8Array([0, 1, 2, 255]));
      const c1 = await repo.commit({
        ref: "refs/heads/main",
        parent: null,
        prefix: "wb/one",
        change: {
          kind: "replace",
          files: [
            { rel: "a.txt", source: { kind: "file", path: f1 }, mode: "100644" },
            { rel: "sub/b.bin", source: { kind: "file", path: f2 }, mode: "100755" },
          ],
        },
        message: "initial\n",
        author: { name: "Test", email: "test@example.com" },
        committer: { name: "Test", email: "test@example.com" },
        when: { seconds: 1_700_000_000, offset: 480 },
      });
      expect(c1).toMatch(/^[0-9a-f]{40}$/);
      expect(await repo.resolveHead()).toEqual({ ref: "refs/heads/main", commit: c1 });

      const tree = await repo.listTree(c1, "wb/one", { withSize: true });
      expect(tree?.map((e) => [e.rel, e.mode, e.size])).toEqual([
        ["a.txt", "100644", 6],
        ["sub/b.bin", "100755", 4],
      ]);

      const f3 = await writeSource("c.txt", "updated\n");
      const c2 = await repo.commit({
        ref: "refs/heads/main",
        parent: c1,
        prefix: "wb/one",
        change: {
          kind: "patch",
          upsert: [{ rel: "a.txt", source: { kind: "file", path: f3 } }],
          remove: ["sub/b.bin"],
        },
        message: "patch\n",
        author: { name: "Test", email: "test@example.com" },
        committer: { name: "Test", email: "test@example.com" },
        when: { seconds: 1_700_000_010, offset: -330 },
      });

      const hist = await repo.walkHistory({
        fromCommit: c2,
        prefix: "wb/one",
        limit: 10,
        maxWalk: 50,
      });
      expect(hist.map((h) => h.commit)).toEqual([c2, c1]);

      const dest = path.join(root, "extract");
      const ext = await repo.extractTree({ commitOid: c2, prefix: "wb/one", destDir: dest });
      expect(ext.files).toEqual(["a.txt"]);
      expect(await fs.readFile(path.join(dest, "a.txt"), "utf8")).toBe("updated\n");

      // Stale CAS must reject with CAS_CONFLICT and not move HEAD
      let casErr: unknown;
      try {
        await repo.commit({
          ref: "refs/heads/main",
          parent: c1,
          prefix: "wb/one",
          change: { kind: "patch", upsert: [], remove: [] },
          message: "stale\n",
          author: { name: "Test", email: "test@example.com" },
          committer: { name: "Test", email: "test@example.com" },
          when: { seconds: 1_700_000_020, offset: 0 },
        });
      } catch (e) {
        casErr = e;
      }
      expect((casErr as GitError)?.code).toBe("CAS_CONFLICT");

      // beforeMoveRef throw aborts without advancing HEAD
      let abortErr: unknown;
      try {
        await repo.commit({
          ref: "refs/heads/main",
          parent: c2,
          prefix: "wb/one",
          change: { kind: "patch", upsert: [], remove: [] },
          message: "abort\n",
          author: { name: "Test", email: "test@example.com" },
          committer: { name: "Test", email: "test@example.com" },
          when: { seconds: 1_700_000_030, offset: 0 },
          beforeMoveRef: async () => {
            throw new Error("ABORT_TEST");
          },
        });
      } catch (e) {
        abortErr = e;
      }
      expect((abortErr as Error)?.message).toContain("ABORT_TEST");
      expect((await repo.resolveHead()).commit).toBe(c2);
    } finally {
      await repo.close();
    }
  });

  it("handles small and boundary Unix timestamps (@0, @1, @2, @526) and passes git fsck", async () => {
    const gitdir = path.join(root, "timestamps.git");
    initBare(gitdir);
    const engine = gitclGitEngine({ program: GIT }, gitVersion!);
    const repo = await engine.open(gitdir);
    try {
      const f = await writeSource("ts.txt", "epoch\n");
      let parent: string | null = null;
      for (const when of [
        { seconds: 0, offset: 0 },
        { seconds: 1, offset: 480 },
        { seconds: 2, offset: -330 },
        { seconds: 526, offset: 525 },
      ]) {
        const input: GitCommitInput = {
          ref: "refs/heads/main",
          parent,
          prefix: "wb/ts",
          change: {
            kind: "replace",
            files: [{ rel: "ts.txt", source: { kind: "file", path: f } }],
          },
          message: `ts ${when.seconds}\n`,
          author: { name: "Test", email: "test@example.com" },
          committer: { name: "Test", email: "test@example.com" },
          when,
        };
        parent = await repo.commit(input);
      }
      const fsck = spawnSync(GIT, ["--git-dir", gitdir, "fsck", "--strict", "--no-dangling"], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(fsck.status, fsck.stderr).toBe(0);
    } finally {
      await repo.close();
    }
  });
});
