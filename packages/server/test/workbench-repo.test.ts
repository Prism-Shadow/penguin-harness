/**
 * The Agent State repository: a workbench's versions are the commits that touched its folder.
 *
 * - Given a fresh Agent State, the first commit creates the repository and its `.gitignore`,
 *   and the history lists one version whose revision is the folder's in-memory tree id — the
 *   id git wrote for it, names git orders unusually included.
 * - Given the same files again, nothing is recorded; an edit is a newer version, dated by the
 *   clock, or by the time the caller passes (to the whole second, as git keeps it).
 * - Given two folders committed at once, each lists exactly its own commit.
 * - Given no repository, the history is empty and removing creates nothing; after a removal the
 *   history is empty, and a folder made again lists only its new versions.
 * - Given a listed revision, its files come back exactly; a revision not listed is null.
 * - Given a person's `git status` after commits and a removal, the folder reads clean; a broken
 *   index never fails a commit, and the line is logged.
 * - Given an unreadable or a detached HEAD, a commit and a history read are errors.
 * - Given a version that holds something other than source, restoring it is refused before
 *   anything is written.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentStateRepo, blobOid, treeId, type SourceFile } from "../src/workbenches/repo.js";
import { readFolder, restoreSource } from "../src/workbenches/store.js";

const REL = "workbenches/demo";
const T1 = new Date("2026-11-03T08:00:00.000Z");
const T2 = new Date("2026-11-03T09:30:00.000Z");

const source = (files: Record<string, string>): SourceFile[] =>
  Object.entries(files).map(([rel, text]) => ({ rel, body: Buffer.from(text) }));
const revisionOf = (files: SourceFile[]) =>
  treeId(files.map((f) => ({ rel: f.rel, oid: blobOid(f.body) })));
const texts = (files: SourceFile[] | null) =>
  Object.fromEntries((files ?? []).map((f) => [f.rel, Buffer.from(f.body).toString()]));

/**
 * `ui.css` beside `ui/` and two names whose UTF-16 order differs from their code point order:
 * git sorts a directory as if its name ended in `/`, and compares bytes.
 */
const DEMO = source({
  "package.json": '{"name":"demo"}',
  "index.ts": "export default {};",
  "ui.css": "body{}",
  "ui/index.html": "<h1>v1</h1>",
  "\u{1F600}.txt": "astral",
  "ａ.txt": "fullwidth",
});
const EDITED = source({
  "package.json": '{"name":"demo"}',
  "index.ts": "export default { edited: true };",
  "ui/index.html": "<h1>v2</h1>",
  "lib/util.ts": "export const x = 1;",
});

let dir: string;
let now: Date;
let logged: string[];
const open = () =>
  new AgentStateRepo({ stateDir: dir, now: () => now, log: (line) => logged.push(line) });
const head = () => git.resolveRef({ fs: nodeFs, dir, ref: "HEAD" });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-repo-"));
  now = T1;
  logged = [];
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("recording versions", () => {
  it("the first commit creates the repository and its .gitignore, and lists the folder's tree id", async () => {
    const repo = open();
    expect((await repo.commitPath(REL, DEMO, "workbench demo @1")).changed).toBe(true);

    expect(await git.currentBranch({ fs: nodeFs, dir })).toBe("main");
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toContain(
      "workbenches/*/state.json",
    );
    const commit = await head();
    const written = await git.readTree({ fs: nodeFs, dir, oid: commit, filepath: REL });
    expect(written.oid.slice(0, 12)).toBe(revisionOf(DEMO));
    expect(await repo.history(REL)).toEqual([
      { revision: revisionOf(DEMO), commit: commit.slice(0, 12), savedAt: T1.toISOString() },
    ]);
  });

  it("records nothing for the same files, and an edit as a newer version dated by the clock or by `at`", async () => {
    const repo = open();
    const first = await repo.commitPath(REL, DEMO, "workbench demo @1");
    expect(await repo.commitPath(REL, DEMO, "workbench demo @1 again")).toEqual({
      commit: first.commit,
      changed: false,
    });

    now = T2;
    await repo.commitPath(REL, EDITED, "workbench demo @2");
    // A replayed version keeps the time it was first saved, to the second.
    const replayed = new Date("2026-10-01T00:00:00.789Z");
    await repo.commitPath(REL, DEMO, "workbench demo @1 replayed", { at: replayed });

    const { commit } = await git.readCommit({ fs: nodeFs, dir, oid: await head() });
    expect([commit.author.timestamp, commit.committer.timestamp]).toEqual([
      Date.parse("2026-10-01T00:00:00Z") / 1000,
      Date.parse("2026-10-01T00:00:00Z") / 1000,
    ]);
    expect((await repo.history(REL)).map((v) => [v.revision, v.savedAt])).toEqual([
      [revisionOf(DEMO), "2026-10-01T00:00:00.000Z"],
      [revisionOf(EDITED), T2.toISOString()],
      [revisionOf(DEMO), T1.toISOString()],
    ]);
  });

  it("two folders committed at once each list exactly their own commit", async () => {
    const repo = open();
    const [a, b] = await Promise.all([
      repo.commitPath("workbenches/a", DEMO, "workbench a @1"),
      repo.commitPath("workbenches/b", EDITED, "workbench b @1"),
    ]);

    expect(a.commit).not.toBe(b.commit);
    expect((await repo.history("workbenches/a")).map((v) => v.commit)).toEqual([a.commit]);
    expect((await repo.history("workbenches/b")).map((v) => v.commit)).toEqual([b.commit]);
  });
});

describe("removing and restoring", () => {
  it("a removal empties the history, and a folder made again lists only its new versions", async () => {
    const repo = open();
    expect(await repo.history(REL)).toEqual([]);
    await repo.removePath(REL, "workbench demo: removed");
    await expect(fs.stat(path.join(dir, ".git"))).rejects.toMatchObject({ code: "ENOENT" });

    await repo.commitPath(REL, DEMO, "workbench demo @1");
    await repo.removePath(REL, "workbench demo: removed");
    expect(await repo.history(REL)).toEqual([]);
    expect(await repo.filesAt(REL, revisionOf(DEMO))).toBeNull();

    const again = await repo.commitPath(REL, DEMO, "workbench demo @1");
    expect(await repo.history(REL)).toEqual([
      { revision: revisionOf(DEMO), commit: again.commit, savedAt: T1.toISOString() },
    ]);
  });

  it("a listed revision gives back exactly its files; one not listed is null", async () => {
    const repo = open();
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    await repo.commitPath(REL, EDITED, "workbench demo @2");

    expect(texts(await repo.filesAt(REL, revisionOf(DEMO)))).toEqual(texts(DEMO));
    expect(texts(await repo.filesAt(REL, revisionOf(EDITED)))).toEqual(texts(EDITED));
    expect(await repo.filesAt(REL, "000000000000")).toBeNull();
    expect(await repo.filesAt("workbenches/other", revisionOf(DEMO))).toBeNull();
  });

  it.each(["state.json", ".harness/ifaces.json", "node_modules/dep/index.js", "../outside.ts"])(
    "restoring a version that holds %s is refused before anything is written",
    async (rel) => {
      const folderDir = path.join(dir, REL);
      await fs.mkdir(folderDir, { recursive: true });
      await fs.writeFile(path.join(folderDir, "package.json"), "{}");
      await fs.writeFile(path.join(folderDir, "index.ts"), "mine");
      const folder = (await readFolder(folderDir, "demo"))!;

      await expect(
        restoreSource(folder, source({ "index.ts": "theirs", [rel]: "x" })),
      ).rejects.toThrow("not workbench source");
      expect(await fs.readFile(path.join(folderDir, "index.ts"), "utf8")).toBe("mine");
    },
  );
});

describe("what a person's git sees", () => {
  async function writeOnDisk(files: SourceFile[]): Promise<void> {
    await fs.rm(path.join(dir, REL), { recursive: true, force: true });
    for (const f of files) {
      await fs.mkdir(path.dirname(path.join(dir, REL, f.rel)), { recursive: true });
      await fs.writeFile(path.join(dir, REL, f.rel), f.body);
    }
  }
  /** Every path under the folder whose HEAD, working tree and index do not all agree. */
  const unclean = async () =>
    (await git.statusMatrix({ fs: nodeFs, dir, filepaths: ["workbenches"] }))
      .filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
      .map(([file]) => file);

  it("the folder reads clean after a commit, an edit that drops a file, and a removal", async () => {
    const repo = open();
    await writeOnDisk(DEMO);
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    expect(await unclean()).toEqual([]);

    await writeOnDisk(EDITED);
    await repo.commitPath(REL, EDITED, "workbench demo @2");
    expect(await unclean()).toEqual([]);

    await fs.rm(path.join(dir, REL), { recursive: true });
    await repo.removePath(REL, "workbench demo: removed");
    expect(await unclean()).toEqual([]);
  });

  it("a broken index never fails a commit; the line is logged", async () => {
    const repo = open();
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    await fs.rm(path.join(dir, ".git", "index"), { force: true });
    await fs.mkdir(path.join(dir, ".git", "index"));

    expect((await repo.commitPath(REL, EDITED, "workbench demo @2")).changed).toBe(true);
    expect((await repo.history(REL)).map((v) => v.revision)).toEqual([
      revisionOf(EDITED),
      revisionOf(DEMO),
    ]);
    expect(logged.some((line) => line.includes("git index not updated"))).toBe(true);
  });

  it.each([
    { name: "an unreadable", head: async () => "garbage\n" },
    { name: "a detached", head: async () => `${await head()}\n` },
  ])("$name HEAD fails a commit and a history read", async ({ head: content }) => {
    const repo = open();
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    await fs.writeFile(path.join(dir, ".git", "HEAD"), await content());

    await expect(repo.commitPath(REL, EDITED, "workbench demo @2")).rejects.toThrow();
    await expect(repo.history(REL)).rejects.toThrow();
  });
});
