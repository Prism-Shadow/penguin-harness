/**
 * An impl branch's structured diff over a real git: a temporary repository stands in for the
 * delivery repository, a blobless bare mirror is built from it the way a graph refresh builds
 * one, and the diff — merge base of base and head, up to head — fetches only the blobs it reads.
 * Covered: a base that moved on after the head branched off does not count; added, deleted,
 * renamed, modified and binary files; hunks; the per-file and whole-diff caps; `-w`; the cache;
 * and the fall back to GitHub's comparison when the mirror cannot answer.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProposalImplChanges,
  ProposalImplDiff,
  ProposalResolvedBranch,
} from "@prismshadow/penguin-server/api";
import { LocalGitMirror } from "../src/git-mirror.js";
import { ImplChangesCache, implChanges, type ImplChangesDeps } from "../src/impl-diff.js";
import type { DiffMirror } from "../src/ports.js";
import type { RunGh } from "../src/pr-status.js";
import { gitHeader, gitQuote, parseHunks } from "../src/unified-patch.js";

const HEAD: ProposalResolvedBranch = { remote: "origin", repo: "acme/site", branch: "feat" };
const BASE: ProposalResolvedBranch = { remote: "origin", repo: "acme/site", branch: "main" };
const TAB_NAME = "tab\tname.txt";
// A Windows file name cannot hold the tab, so the quoted-path fixture is written only where the
// file can exist; `gitQuote` below covers the quoted form as text on every platform.
const TAB = process.platform === "win32" ? null : TAB_NAME;

describe("implChanges", () => {
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
        GIT_NO_LAZY_FETCH: "1",
      },
      maxBuffer: 64 * 1024 * 1024,
    }).trim();

  const write = (file: string, text: string | Buffer) =>
    fs.writeFile(path.join(origin, file), text);
  const commit = (name: string) => {
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", name);
    sha[name] = git(origin, "rev-parse", "HEAD");
  };
  const lines = (n: number, word: string) =>
    Array.from({ length: n }, (_, i) => `${word} line ${i + 1}`).join("\n") + "\n";

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "impl-diff-"));
    origin = path.join(dir, "origin");
    await fs.mkdir(origin);
    git(origin, "init", "-q", "-b", "main");
    git(origin, "config", "uploadpack.allowFilter", "true");
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    await write("keep.txt", lines(20, "keep"));
    await write("gone.txt", "to be deleted\n");
    await write("old-name.txt", lines(30, "moved"));
    await write("ws.txt", "a\n  b\nc\n");
    await write("with space.txt", "one\n");
    if (TAB !== null) await write(TAB_NAME, "tab one\n");
    commit("base");

    git(origin, "checkout", "-q", "-b", "feat");
    const keep = lines(20, "keep").replace("keep line 2\n", "keep line two\n") + "appended\n";
    await write("keep.txt", keep);
    await fs.rm(path.join(origin, "gone.txt"));
    await fs.rename(path.join(origin, "old-name.txt"), path.join(origin, "new-name.txt"));
    await write("added.txt", "fresh\nfile\n");
    await write("image.bin", Buffer.from([0, 1, 2, 3, 0, 255, 0, 10]));
    await write("ws.txt", "a\n    b\nc\n");
    await write("with space.txt", "two\n");
    if (TAB !== null) await write(TAB_NAME, "tab two\n");
    await write("big.txt", lines(40_000, "big"));
    commit("feat");

    // The base moves on after the head branched off: its commit must not count.
    git(origin, "checkout", "-q", "main");
    await write("main-only.txt", "only on main\n");
    commit("main2");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  let mirrors = 0;
  /** A mirror built from the repository as a graph refresh builds one: blobless, refs only. */
  const builtMirror = async (): Promise<LocalGitMirror> => {
    const m = new LocalGitMirror({ dir: path.join(dir, `mirror-${++mirrors}.git`), url: origin });
    await m.fetch(["refs/heads/main", "refs/heads/feat"]);
    return m;
  };

  const gh: RunGh = async (args) => {
    const p = args[1]!;
    if (p === "repos/acme/site/branches/feat") return JSON.stringify(sha.feat);
    if (p === "repos/acme/site/branches/main") return JSON.stringify(sha.main2);
    throw new Error(`HTTP 404: ${p}`);
  };

  const COMPARE: ProposalImplDiff = {
    head: HEAD,
    base: BASE,
    headSha: "a".repeat(40),
    mergeBase: "c".repeat(40),
    ahead: 1,
    behind: 1,
    files: [
      {
        path: "keep.txt",
        status: "modified",
        from: null,
        additions: 2,
        deletions: 1,
        patch:
          "@@ -1,3 +1,3 @@ intro\n keep line 1\n-keep line 2\n+keep line two\n@@ -20 +20,2 @@\n keep line 20\n+appended\n\\ No newline at end of file",
      },
      { path: "image.bin", status: "added", from: null, additions: 0, deletions: 0, patch: null },
      {
        path: "new-name.txt",
        status: "renamed",
        from: "old-name.txt",
        additions: 0,
        deletions: 0,
        patch: null,
      },
      {
        path: "gone.txt",
        status: "removed",
        from: null,
        additions: 0,
        deletions: 1,
        patch: "@@ -1 +0,0 @@\n-to be deleted",
      },
    ],
    truncated: false,
    compareUrl: "https://github.com/acme/site/compare/main...feat",
    pr: null,
  };

  const run = (
    mirror: DiffMirror | null,
    opts: { ignoreWhitespace?: boolean } & Partial<ImplChangesDeps> = {},
  ) => {
    const compared: number[] = [];
    const deps: ImplChangesDeps = {
      gh,
      mirror,
      cache: opts.cache ?? new ImplChangesCache(),
      compare: async () => {
        compared.push(1);
        return COMPARE;
      },
      ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    };
    return {
      compared,
      result: implChanges(deps, {
        head: HEAD,
        base: BASE,
        pr: null,
        ignoreWhitespace: opts.ignoreWhitespace ?? false,
      }),
    };
  };

  const byPath = (r: ProposalImplChanges) => new Map(r.files.map((f) => [f.path, f]));

  it("reads the merge base up to the head from a blobless mirror, fetching only the blobs it reads", async () => {
    const mirror = await builtMirror();
    const blobs = await mirror.changedBlobs(sha.base!, sha.feat!);
    // Built blobless: none of the diff's blobs are there yet.
    expect([...(await mirror.objectSizes(blobs)).values()].every((s) => s === null)).toBe(true);

    const { result, compared } = run(mirror);
    const r = await result;
    expect(compared).toEqual([]);
    expect(r).toMatchObject({
      source: "mirror",
      fallbackReason: null,
      headSha: sha.feat,
      baseSha: sha.main2,
      mergeBase: sha.base,
      ignoreWhitespace: false,
      truncated: false,
      compareUrl: "https://github.com/acme/site/compare/main...feat",
    });
    expect(r.files.map((f) => f.path)).toEqual([
      "added.txt",
      "big.txt",
      "gone.txt",
      "image.bin",
      "keep.txt",
      "new-name.txt",
      ...(TAB !== null ? [TAB_NAME] : []),
      "with space.txt",
      "ws.txt",
    ]);
    // The base's own later commit is not in the diff.
    expect(r.files.some((f) => f.path === "main-only.txt")).toBe(false);
    // The blobs it read are in the mirror now, and the base's later blob is not.
    expect([...(await mirror.objectSizes(blobs)).values()].every((s) => s !== null)).toBe(true);
    const mainOnly = git(origin, "rev-parse", `${sha.main2}:main-only.txt`);
    expect((await mirror.objectSizes([mainOnly])).get(mainOnly)).toBeNull();

    const f = byPath(r);
    expect(f.get("added.txt")).toMatchObject({ status: "added", additions: 2, deletions: 0 });
    expect(f.get("added.txt")!.hunks).toEqual([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        section: "",
        lines: [
          { kind: "add", text: "fresh" },
          { kind: "add", text: "file" },
        ],
      },
    ]);
    expect(f.get("gone.txt")).toMatchObject({ status: "deleted", additions: 0, deletions: 1 });
    expect(f.get("new-name.txt")).toMatchObject({
      status: "renamed",
      oldPath: "old-name.txt",
      additions: 0,
      deletions: 0,
      omitted: null,
      hunks: [],
    });
    expect(f.get("image.bin")).toMatchObject({
      status: "added",
      binary: true,
      additions: 0,
      deletions: 0,
      omitted: null,
      hunks: [],
    });
    const keep = f.get("keep.txt")!;
    expect(keep).toMatchObject({ status: "modified", additions: 2, deletions: 1, binary: false });
    expect(keep.hunks).toHaveLength(2);
    expect(keep.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(keep.hunks[0]!.lines).toContainEqual({ kind: "del", text: "keep line 2" });
    expect(keep.hunks[0]!.lines).toContainEqual({ kind: "add", text: "keep line two" });
    expect(keep.hunks[0]!.lines).toContainEqual({ kind: "context", text: "keep line 1" });
    expect(keep.hunks[1]!.lines.at(-1)).toEqual({ kind: "add", text: "appended" });
    // Paths git quotes or that hold a space still find their hunks.
    if (TAB !== null) {
      expect(f.get(TAB_NAME)!.hunks[0]!.lines).toContainEqual({ kind: "add", text: "tab two" });
    }
    expect(f.get("with space.txt")!.hunks[0]!.lines).toContainEqual({ kind: "add", text: "two" });
    // Over the per-file cap: counts, no hunks.
    expect(f.get("big.txt")).toMatchObject({
      status: "added",
      additions: 40_000,
      omitted: "tooLarge",
      hunks: [],
    });
    expect(r.additions).toBe(r.files.reduce((n, x) => n + x.additions, 0));
    expect(r.deletions).toBe(r.files.reduce((n, x) => n + x.deletions, 0));
  });

  it("ignores whitespace on request", async () => {
    const mirror = await builtMirror();
    const plain = byPath(await run(mirror).result);
    expect(plain.get("ws.txt")).toMatchObject({ additions: 1, deletions: 1 });
    const r = await run(mirror, { ignoreWhitespace: true }).result;
    expect(r.ignoreWhitespace).toBe(true);
    expect(r.files.some((f) => f.path === "ws.txt")).toBe(false);
    expect(byPath(r).get("keep.txt")).toMatchObject({ additions: 2, deletions: 1 });
  });

  it("keeps counts only for the files past the whole-diff cap", async () => {
    const mirror = await builtMirror();
    const r = await run(mirror, { limits: { fileBytes: 512 * 1024, diffBytes: 400 } }).result;
    const f = byPath(r);
    // The first text file fits; the cap is reached before the later ones.
    expect(f.get("added.txt")!.hunks).toHaveLength(1);
    expect(f.get("keep.txt")).toMatchObject({
      additions: 2,
      deletions: 1,
      omitted: "diffLimit",
      hunks: [],
    });
    expect(f.get("ws.txt")).toMatchObject({ omitted: "diffLimit" });
    // A binary file has nothing to cap.
    expect(f.get("image.bin")).toMatchObject({ binary: true, omitted: null });
    expect(r.additions).toBe(r.files.reduce((n, x) => n + x.additions, 0));
  });

  it("answers the same commits from its cache, and a moved branch afresh", async () => {
    const mirror = await builtMirror();
    let stats = 0;
    const counting: DiffMirror = {
      exists: () => mirror.exists(),
      missing: (o) => mirror.missing(o),
      fetch: (r, o) => mirror.fetch(r, o),
      mergeBase: (a, b) => mirror.mergeBase(a, b),
      changedBlobs: (a, b) => mirror.changedBlobs(a, b),
      fetchObjects: (o, x) => mirror.fetchObjects(o, x),
      objectSizes: (o) => mirror.objectSizes(o),
      diffStat: (a, b, o) => {
        stats += 1;
        return mirror.diffStat(a, b, o);
      },
      patch: (a, b, o) => mirror.patch(a, b, o),
    };
    const cache = new ImplChangesCache();
    const first = await run(counting, { cache }).result;
    const second = await run(counting, { cache }).result;
    expect(second).toBe(first);
    expect(stats).toBe(1);
    await run(counting, { cache, ignoreWhitespace: true }).result;
    expect(stats).toBe(2);
  });

  it("falls back to GitHub's comparison when the mirror is not built, and says so", async () => {
    const absent = new LocalGitMirror({ dir: path.join(dir, "never-built.git"), url: origin });
    const cache = new ImplChangesCache();
    const { result, compared } = run(absent, { cache, ignoreWhitespace: true });
    const r = await result;
    expect(compared).toEqual([1]);
    expect(r.source).toBe("github");
    expect(r.fallbackReason).toContain("not built");
    // GitHub's comparison cannot ignore whitespace.
    expect(r.ignoreWhitespace).toBe(false);
    expect(r.baseSha).toBe(sha.main2);
    expect(r.mergeBase).toBe("c".repeat(40));
    const f = byPath(r);
    expect(f.get("keep.txt")!.hunks).toHaveLength(2);
    expect(f.get("keep.txt")!.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      section: "intro",
    });
    expect(f.get("keep.txt")!.hunks[1]).toMatchObject({ oldStart: 20, oldLines: 1, newLines: 2 });
    expect(f.get("gone.txt")).toMatchObject({ status: "deleted", hunks: [{ newLines: 0 }] });
    // No patch: GitHub does not say whether binary or too large.
    expect(f.get("image.bin")).toMatchObject({ omitted: "noPatch", binary: false });
    // A pure rename has nothing to show, and nothing is missing.
    expect(f.get("new-name.txt")).toMatchObject({ omitted: null, oldPath: "old-name.txt" });
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(2);
    // A GitHub answer is not kept: the next read asks again.
    const again = run(absent, { cache });
    await again.result;
    expect(again.compared).toEqual([1]);
  });

  it("falls back when the mirror cannot fetch what it lacks", async () => {
    const m = new LocalGitMirror({
      dir: path.join(dir, `mirror-${++mirrors}.git`),
      url: origin,
    });
    await m.fetch(["refs/heads/main"]);
    // The remote goes away: the head's commits cannot be fetched.
    git(
      dir,
      "--git-dir",
      path.join(dir, `mirror-${mirrors}.git`),
      "config",
      "remote.origin.url",
      path.join(dir, "nowhere"),
    );
    const r = await run(m).result;
    expect(r.source).toBe("github");
    expect(r.fallbackReason).toMatch(/git fetch failed/);
  });

  it("falls back with no mirror at all", async () => {
    const r = await run(null).result;
    expect(r).toMatchObject({ source: "github", fallbackReason: "there is no mirror to read" });
  });
});

describe("unified patch text", () => {
  it("quotes a path the way git does in a diff header", () => {
    expect(gitQuote("a/plain name.txt")).toBe("a/plain name.txt");
    expect(gitQuote('a/q"t\\x\ty')).toBe('"a/q\\"t\\\\x\\ty"');
    expect(gitHeader("old.txt", "new.txt")).toBe("diff --git a/old.txt b/new.txt");
  });

  it("reads a one-line hunk header and skips the no-newline marker", () => {
    expect(parseHunks("@@ -3 +3 @@\n-a\n\\ No newline at end of file\n+b\n")).toEqual([
      {
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        section: "",
        lines: [
          { kind: "del", text: "a" },
          { kind: "add", text: "b" },
        ],
      },
    ]);
  });
});
