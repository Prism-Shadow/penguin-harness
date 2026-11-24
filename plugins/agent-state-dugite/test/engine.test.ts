/**
 * The native engine against real repositories, beyond what the shared suite holds every engine
 * to (agent-state-repo.test.ts):
 *
 * - File names with spaces, brackets, apostrophes and non-ASCII text (and, where a file system
 *   can hold them, quotes, tabs and line breaks) are written and read back exactly, in the same
 *   commits the built-in engine writes.
 * - Every object it writes is a loose file, as the built-in engine stores them: no pack per commit.
 * - What the server's environment could change does not apply: an ambient `GIT_DIR` or index
 *   file is not followed — the repository comes from the `--git-dir` flag and the index is a
 *   temporary file of the commit's own.
 * - A ref another program holds locked fails the write and stays as it was; once it is released
 *   the next write goes through.
 * - A repository a person packed (`git gc`) is read and written on.
 * - A program that is not there is reported as unavailable, so the harness takes over; git
 *   refusing a write is reported as itself.
 *
 * Live: these need this host's Git (test/global-setup.ts).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitEngine } from "../src/engine.js";
import { runGit } from "../src/git.js";
import { liveGit, QUIET, server, type RepoUnderTest } from "./live-git.js";

const live = await liveGit();
const REL = "workbenches/demo";
const T1 = new Date("2026-11-19T08:00:00.000Z");
const text = (files: Record<string, string>) =>
  Object.entries(files).map(([rel, body]) => ({ rel, body: Buffer.from(body) }));
const texts = (files: Array<{ rel: string; body: Uint8Array }> | null) =>
  Object.fromEntries((files ?? []).map((f) => [f.rel, Buffer.from(f.body).toString()]));
const revisionOf = (files: Array<{ rel: string; body: Uint8Array }>) =>
  server.treeId(files.map((f) => ({ rel: f.rel, oid: server.blobOid(f.body) })));

describe.skipIf(live === null)("the native engine", () => {
  let dir: string;
  let gitdir: string;
  const saved = { ...process.env };
  const open = (at = gitdir, engine = live?.engine): RepoUnderTest =>
    new server.AgentStateRepo({
      gitdir: at,
      now: () => T1,
      log: () => {},
      engine,
      // Every step goes to the engine under test, however small the folder.
      engineFrom: { commit: 1, read: 1 },
      identity: QUIET,
    });
  const git = (args: string[], input?: string) =>
    runGit(live!.git, gitdir, args, input === undefined ? undefined : Buffer.from(input)).then(
      (out) => out.toString().trimEnd(),
    );

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-dugite-"));
    gitdir = path.join(dir, "agent_state.git");
  });
  afterEach(async () => {
    process.env = { ...saved };
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes and reads back unusual names exactly, in the commits the built-in engine writes", async () => {
    const files = text({
      "nested/-item with spaces": "中文",
      "apostrophe's (and parentheses).md": "q",
      "名字 with [brackets]/index.ts": "export {};",
      "ünï cödé.txt": "ü",
      // A quote, a tab and a line break cannot be in a file name on Windows, and Git for Windows
      // refuses them in a path; a workbench folder there never holds one.
      ...(process.platform === "win32"
        ? {}
        : { 'quote "and" back.md': "q", "tab\tline\nbreak.txt": "contents" }),
    });
    const rel = "workbenches/名字 [x]";
    const twin = path.join(dir, "twin.git");

    await open().commitPath(rel, files, "odd names");
    await open(twin, server.builtinEngine).commitPath(rel, files, "odd names");

    expect(texts(await open().filesAt(rel, revisionOf(files)))).toEqual(texts(files));
    expect(await git(["rev-parse", "HEAD"])).toBe(
      (await fs.readFile(path.join(twin, "refs", "heads", "main"), "utf8")).trim(),
    );
  });

  it("stores every object as a loose file", async () => {
    await open().commitPath(REL, text({ "package.json": "{}", "index.ts": "one" }), "one");
    await open().commitPath(REL, text({ "package.json": "{}", "index.ts": "two" }), "two");

    const packs = await fs.readdir(path.join(gitdir, "objects", "pack")).catch(() => []);
    expect(packs.filter((name) => name.endsWith(".pack"))).toEqual([]);
    expect(await git(["count-objects"])).toMatch(/^\d+ objects/);
  });

  it("follows no ambient repository variable", async () => {
    process.env.GIT_DIR = path.join(dir, "unrelated.git");
    process.env.GIT_INDEX_FILE = path.join(dir, "outside-index");
    const repo = open();
    await repo.commitPath(REL, text({ "package.json": "{}" }), "first");
    expect((await repo.commitPath(REL, text({ "package.json": "{ }" }), "second")).changed).toBe(
      true,
    );
    process.env = { ...saved };

    for (const outside of ["unrelated.git", "outside-index"]) {
      await expect(fs.stat(path.join(dir, outside))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect((await open().history(REL)).map((v) => v.commit)).toHaveLength(2);
  });

  it("leaves a ref another program locked as it was, and writes once it is released", async () => {
    const repo = open();
    const first = await repo.commitPath(REL, text({ "package.json": "{}" }), "base");
    const lock = path.join(gitdir, "refs", "heads", "main.lock");
    await fs.writeFile(lock, "another Git process");

    const refused = await repo
      .commitPath(REL, text({ "package.json": "{ }" }), "competing")
      .catch((err: Error & { engineUnavailable?: boolean }) => err);

    expect(refused).toBeInstanceOf(Error);
    expect((refused as { engineUnavailable?: boolean }).engineUnavailable).toBeUndefined();
    expect(await fs.readFile(lock, "utf8")).toBe("another Git process");
    expect((await repo.history(REL))[0]?.commit).toBe(first.commit);
    await fs.unlink(lock);
    expect((await repo.commitPath(REL, text({ "package.json": "{ }" }), "retry")).changed).toBe(
      true,
    );
  });

  it("reads and writes on a repository a person packed", async () => {
    const repo = open();
    const v1 = text({ "package.json": "{}", "index.ts": "one" });
    await repo.commitPath(REL, v1, "one");
    await git(["pack-refs", "--all"]);
    await git(["repack", "-a", "-d", "-q"]);

    const v2 = text({ "package.json": "{}", "index.ts": "two" });
    expect((await repo.commitPath(REL, v2, "two")).changed).toBe(true);
    expect((await repo.history(REL)).map((v) => v.revision)).toEqual([
      revisionOf(v2),
      revisionOf(v1),
    ]);
    expect(texts(await repo.filesAt(REL, revisionOf(v1)))).toEqual(texts(v1));
  });

  it("reports a program that is not there as unavailable", async () => {
    const missing = gitEngine({ program: path.join(dir, "no-such-git"), execPath: dir }, "0.0.0");
    await open().commitPath(REL, text({ "package.json": "{}" }), "base");
    const tip = await git(["rev-parse", "HEAD"]);
    const err = await missing
      .commit({
        gitdir,
        ref: "refs/heads/main",
        parent: tip,
        rel: REL,
        files: text({ "package.json": "{ }" }),
        message: "never\n",
        author: { name: "a", email: "a@a" },
        committer: { name: "a", email: "a@a" },
        when: { seconds: 1, offset: 0 },
      })
      .catch((e: Error) => e);
    expect((err as { engineUnavailable?: boolean }).engineUnavailable).toBe(true);
  });
});
