/**
 * The Agent State repository: a bare git repository beside `agent_state/`, where a workbench's
 * versions are the commits that touched its folder.
 *
 * - Given a fresh Agent, the first commit creates `agent_state.git/` with its ignore rules for
 *   people, adds nothing to `agent_state/`, and lists one version whose revision is the folder's
 *   in-memory tree id: the id git wrote, names git orders unusually included.
 * - Given the same files again, nothing is recorded; an edit is a newer version, dated by the
 *   clock, or by the time the caller passes (to the whole second, as git keeps it).
 * - Given two folders committed at once, even through two instances, each lists exactly its
 *   own commit.
 * - Given no repository, the history is empty and removing creates nothing; after a removal the
 *   history is empty, and a folder made again lists only its new versions.
 * - Given a listed revision, its files come back exactly; a revision not listed is null.
 * - Given more versions than listed, the newest are; given a version older than the walk, the
 *   current one is still listed and can be restored.
 * - A name git refuses is judged as isomorphic-git judges it when it reads a tree.
 * - Given a folder holding such a name (a `.git` spelling, a backslash, `.` behind characters
 *   HFS+ ignores), it is not source and not in the revision; a commit passed one leaves it out
 *   with a log line; the history, later commits and the removal all still work.
 * - Given a tree already holding such a name (written by another tool), the history, commits
 *   and the removal still work, the entry left out with a log line.
 * - Given object files a crash left empty, the next commit of those objects writes them again,
 *   and every workbench's history still reads.
 * - Given a staging folder an interrupted creation left an hour ago, the next creation removes
 *   it; a younger one stays.
 * - Given an unreadable HEAD, a detached one, or an empty or invalid branch ref, a commit and a
 *   history read are errors, never a fresh history.
 * - Restoring a version: a file where a directory was, or the reverse, comes out exactly; a
 *   version that holds something other than source (`state.json` in any case, anything under
 *   it) is refused before anything is written; a move that fails puts every file back, and
 *   should that fail too, the error names where the previous files are kept; staging an hour
 *   old is cleared.
 * - The files handed to a commit are the ones that loaded: an edit since the folder was read
 *   gives none.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentStateRepo,
  agentStateRepoDir,
  blobOid,
  isGitName,
  treeId,
  type SourceFile,
} from "../src/workbenches/repo.js";
import { readFolder, readLoadedSource, restoreSource } from "../src/workbenches/store.js";

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

/** The Agent's directory, holding `agent_state/` and the repository beside it. */
let dir: string;
let gitdir: string;
let now: Date;
let logged: string[];
const open = (caps?: { versions?: number; commits?: number }) =>
  new AgentStateRepo({ gitdir, now: () => now, log: (line) => logged.push(line), caps });
const head = () => git.resolveRef({ fs: nodeFs, gitdir, ref: "HEAD" });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-repo-"));
  await fs.mkdir(path.join(dir, "agent_state"));
  gitdir = agentStateRepoDir(dir);
  now = T1;
  logged = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

/** Every loose object file of a repository, as its id. */
async function objectIds(at: string): Promise<string[]> {
  const out: string[] = [];
  for (const prefix of await fs.readdir(path.join(at, "objects"))) {
    if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
    for (const rest of await fs.readdir(path.join(at, "objects", prefix))) out.push(prefix + rest);
  }
  return out;
}

const ZWNJ = String.fromCodePoint(0x200c);
/** Names isomorphic-git's own tree check covers, refused and allowed alike. */
const NAMES = [
  ".git",
  ".GIT",
  ".git.",
  ".git ",
  ".git::$INDEX_ALLOCATION",
  `.g${ZWNJ}it`,
  "git~1",
  "GIT~9",
  ".git~2",
  ".",
  "..",
  `${ZWNJ}.`,
  `${ZWNJ}..`,
  "ui\\index.html",
  "git~0",
  "git~10",
  ".gitignore",
  ".github",
  "git",
  "...",
  "a.",
  "index.ts",
];

describe("recording versions", () => {
  it("the first commit creates the repository beside agent_state/, and lists the folder's tree id", async () => {
    const repo = open();
    expect((await repo.commitPath(REL, DEMO, "workbench demo @1")).changed).toBe(true);

    expect(await fs.readdir(path.join(dir, "agent_state"))).toEqual([]);
    expect(await git.currentBranch({ fs: nodeFs, gitdir })).toBe("main");
    expect(await fs.readFile(path.join(gitdir, "info", "exclude"), "utf8")).toContain(
      "workbenches/*/state.json",
    );
    const commit = await head();
    const written = await git.readTree({ fs: nodeFs, gitdir, oid: commit, filepath: REL });
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

    const { commit } = await git.readCommit({ fs: nodeFs, gitdir, oid: await head() });
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

  it("two folders committed at once, through two instances, each list exactly their own commit", async () => {
    const [a, b] = await Promise.all([
      open().commitPath("workbenches/a", DEMO, "workbench a @1"),
      open().commitPath("workbenches/b", EDITED, "workbench b @1"),
    ]);

    expect(a.commit).not.toBe(b.commit);
    expect((await open().history("workbenches/a")).map((v) => v.commit)).toEqual([a.commit]);
    expect((await open().history("workbenches/b")).map((v) => v.commit)).toEqual([b.commit]);
  });

  it.each(NAMES)("%j is refused exactly when isomorphic-git refuses it in a tree", async (name) => {
    const nodeRepo = { fs: nodeFs, gitdir: path.join(dir, "scratch.git") };
    await git.init({ ...nodeRepo, bare: true });
    const blob = await git.writeBlob({ ...nodeRepo, blob: Buffer.from("x") });
    const tree = await git.writeTree({
      ...nodeRepo,
      tree: [{ mode: "100644", path: name, oid: blob, type: "blob" }],
    });

    const read = git.readTree({ ...nodeRepo, oid: tree }).then(
      () => false,
      () => true,
    );

    expect(await read).toBe(isGitName(name));
  });

  // Windows reads a backslash as a separator and drops a trailing dot: neither name can exist there.
  it.skipIf(process.platform === "win32")(
    "a folder's file under a name git refuses is not source; a commit passed one leaves it out, and everything still works",
    async () => {
      const folderDir = path.join(dir, "agent_state", REL);
      const refused = ["git~1", "ui\\index.html", `${ZWNJ}.`];
      for (const name of [...refused, "package.json", "index.ts"]) {
        await fs.mkdir(folderDir, { recursive: true });
        await fs.writeFile(path.join(folderDir, name), "x");
      }
      const folder = (await readFolder(folderDir, "demo"))!;
      expect(folder.files).toEqual(["index.ts", "package.json"]);
      expect(folder.refused).toEqual([...refused].sort());

      const repo = open();
      const passed = [...(await readLoadedSource(folder))!, ...source({ [refused[1]!]: "x" })];
      expect((await repo.commitPath(REL, passed, "workbench demo @1")).changed).toBe(true);
      expect(logged.some((line) => line.includes(refused[1]!))).toBe(true);
      expect((await repo.history(REL)).map((v) => v.revision)).toEqual([folder.revision]);
      expect((await repo.commitPath(REL, EDITED, "workbench demo @2")).changed).toBe(true);
      await repo.removePath(REL, "workbench demo: removed");
      expect(await repo.history(REL)).toEqual([]);
    },
  );

  it("a tree already holding a name git refuses still lists, commits and removes, the entry left out", async () => {
    const repo = open();
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    // Another tool commits a file under a name git refuses.
    const nodeRepo = { fs: nodeFs, gitdir };
    const blob = await git.writeBlob({ ...nodeRepo, blob: Buffer.from("x") });
    const head = await git.resolveRef({ ...nodeRepo, ref: "HEAD" });
    const { commit } = await git.readCommit({ ...nodeRepo, oid: head });
    const root = await git.readTree({ ...nodeRepo, oid: commit.tree });
    const workbenches = await git.readTree({
      ...nodeRepo,
      oid: commit.tree,
      filepath: "workbenches",
    });
    const demo = await git.readTree({ ...nodeRepo, oid: commit.tree, filepath: REL });
    const badDemo = await git.writeTree({
      ...nodeRepo,
      tree: [...demo.tree, { mode: "100644", path: "ui\\index.html", oid: blob, type: "blob" }],
    });
    const badWorkbenches = await git.writeTree({
      ...nodeRepo,
      tree: workbenches.tree.map((e) => (e.path === "demo" ? { ...e, oid: badDemo } : e)),
    });
    const badRoot = await git.writeTree({
      ...nodeRepo,
      tree: root.tree.map((e) => (e.path === "workbenches" ? { ...e, oid: badWorkbenches } : e)),
    });
    const stamp = { name: "x", email: "x@x", timestamp: 1_800_000_000, timezoneOffset: 0 };
    const planted = await git.writeCommit({
      ...nodeRepo,
      commit: {
        message: "by hand\n",
        tree: badRoot,
        parent: [head],
        author: stamp,
        committer: stamp,
      },
    });
    await git.writeRef({ ...nodeRepo, ref: "refs/heads/main", value: planted, force: true });

    // The hand-made commit is a version of its own, read without the entry git refuses.
    const versions = await repo.history(REL);
    expect(versions).toHaveLength(2);
    expect(texts(await repo.filesAt(REL, versions[0]!.revision))).toEqual(texts(DEMO));
    expect(logged.some((line) => line.includes("ui\\\\index.html"))).toBe(true);
    expect((await repo.commitPath(REL, EDITED, "workbench demo @2")).changed).toBe(true);
    await repo.removePath(REL, "workbench demo: removed");
    expect(await repo.history(REL)).toEqual([]);
  });

  it("object files a crash left empty are written again by the next commit of them", async () => {
    const v1 = source({ "package.json": "{}", "index.ts": "one" });
    const v2 = source({ "package.json": "{}", "index.ts": "two" });
    const other = source({ "package.json": "{}" });
    // A scratch repository with the same history tells which objects version 2 writes.
    const scratch = path.join(dir, "scratch.git");
    const twin = new AgentStateRepo({ gitdir: scratch, now: () => now, log: () => {} });
    for (const repo of [open(), twin]) {
      await repo.commitPath(REL, v1, "workbench demo @1");
      await repo.commitPath("workbenches/other", other, "workbench other @1");
    }
    const before = new Set(await objectIds(scratch));
    await twin.commitPath(REL, v2, "workbench demo @2");
    const written = (await objectIds(scratch)).filter((oid) => !before.has(oid));
    expect(written.length).toBeGreaterThan(0);
    // The crash: those objects' files exist but are empty, and the branch never moved.
    for (const oid of written) {
      const file = path.join(gitdir, "objects", oid.slice(0, 2), oid.slice(2));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "");
    }

    const repo = open();
    expect((await repo.commitPath(REL, v2, "workbench demo @2")).changed).toBe(true);

    expect((await repo.history(REL)).map((v) => v.revision)).toEqual([
      revisionOf(v2),
      revisionOf(v1),
    ]);
    expect(await repo.history("workbenches/other")).toHaveLength(1);
    expect((await repo.commitPath("workbenches/other", v1, "workbench other @2")).changed).toBe(
      true,
    );
  });

  it("a staging folder an interrupted creation left an hour ago is removed by the next creation; a younger one stays", async () => {
    const stale = `${gitdir}.penguin-tmpold`;
    const young = `${gitdir}.penguin-tmpnew`;
    for (const leftover of [stale, young]) await fs.mkdir(leftover);
    const twoHoursAgo = new Date(T1.getTime() - 2 * 60 * 60 * 1000);
    await fs.utimes(stale, twoHoursAgo, twoHoursAgo);
    await fs.utimes(young, T1, T1);

    await open().commitPath(REL, DEMO, "workbench demo @1");

    await expect(fs.stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.stat(young)).isDirectory()).toBe(true);
  });
});

describe("listing and removing", () => {
  it("a removal empties the history, and a folder made again lists only its new versions", async () => {
    const repo = open();
    expect(await repo.history(REL)).toEqual([]);
    await repo.removePath(REL, "workbench demo: removed");
    await expect(fs.stat(gitdir)).rejects.toMatchObject({ code: "ENOENT" });

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

  it("lists the newest versions up to the cap, and the current one even when it is older than the walk", async () => {
    const edits = [1, 2, 3].map((n) => source({ "package.json": "{}", "index.ts": `${n}` }));
    for (const files of edits) await open().commitPath(REL, files, "workbench demo");
    expect((await open({ versions: 2 }).history(REL)).map((v) => v.revision)).toEqual([
      revisionOf(edits[2]!),
      revisionOf(edits[1]!),
    ]);

    // A neighbour busy enough to push this folder's only commit beyond the walk.
    for (const files of edits) await open().commitPath("workbenches/busy", files, "busy");
    const repo = open({ commits: 2 });
    expect((await repo.history(REL)).map((v) => v.revision)).toEqual([revisionOf(edits[2]!)]);
    expect(texts(await repo.filesAt(REL, revisionOf(edits[2]!)))).toEqual(texts(edits[2]!));
  });
});

describe("a repository that cannot be trusted", () => {
  it.each([
    { name: "an unreadable HEAD", file: "HEAD", content: async () => "garbage\n" },
    { name: "a detached HEAD", file: "HEAD", content: async () => `${await head()}\n` },
    { name: "an empty branch ref", file: "refs/heads/main", content: async () => "" },
    { name: "an invalid branch ref", file: "refs/heads/main", content: async () => "nonsense\n" },
  ])("$name fails a commit and a history read", async ({ file, content }) => {
    const repo = open();
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    await fs.writeFile(path.join(gitdir, file), await content());

    await expect(repo.commitPath(REL, EDITED, "workbench demo @2")).rejects.toThrow();
    await expect(repo.history(REL)).rejects.toThrow();
  });
});

describe("restoring a version into the folder", () => {
  const folderDir = () => path.join(dir, "agent_state", REL);
  async function folderWith(files: Record<string, string>) {
    await fs.rm(folderDir(), { recursive: true, force: true });
    for (const [rel, text] of Object.entries({ "package.json": "{}", ...files })) {
      await fs.mkdir(path.dirname(path.join(folderDir(), rel)), { recursive: true });
      await fs.writeFile(path.join(folderDir(), rel), text);
    }
    await fs.writeFile(path.join(folderDir(), "state.json"), '{"kept":true}');
    return (await readFolder(folderDir(), "demo"))!;
  }

  it.each<{ name: string; on: Record<string, string>; back: Record<string, string> }>([
    { name: "a file where a directory is", on: { "lib/a.ts": "a" }, back: { lib: "file" } },
    { name: "a directory where a file is", on: { lib: "file" }, back: { "lib/a.ts": "a" } },
  ])("puts back exactly $name, state.json untouched", async ({ on, back }) => {
    const folder = await folderWith(on);
    const version = source({ "package.json": "{}", ...back });

    await restoreSource(folder, version);

    const restored = (await readFolder(folderDir(), "demo"))!;
    expect(restored.files).toEqual(version.map((f) => f.rel).sort());
    expect(restored.revision).toBe(revisionOf(version));
    expect(await fs.readFile(path.join(folderDir(), "state.json"), "utf8")).toBe('{"kept":true}');
    expect((await fs.readdir(folderDir())).filter((n) => n.startsWith(".restore"))).toEqual([]);
  });

  it.each([
    "state.json",
    "STATE.JSON",
    "state.json/x.ts",
    ".harness/ifaces.json",
    "node_modules/dep/index.js",
    "../outside.ts",
  ])("a version that holds %s is refused before anything is written", async (rel) => {
    const folder = await folderWith({ "index.ts": "mine" });

    await expect(
      restoreSource(folder, source({ "index.ts": "theirs", [rel]: "x" })),
    ).rejects.toThrow("not workbench source");
    expect(await fs.readFile(path.join(folderDir(), "index.ts"), "utf8")).toBe("mine");
  });

  it("a folder's directory named state.json is not source either", async () => {
    await fs.mkdir(path.join(folderDir(), "state.json"), { recursive: true });
    await fs.writeFile(path.join(folderDir(), "state.json", "x.ts"), "x");
    await fs.writeFile(path.join(folderDir(), "package.json"), "{}");

    expect((await readFolder(folderDir(), "demo"))!.files).toEqual(["package.json"]);
  });

  /** Fails `fs.rename` with EACCES for the calls `when` picks. */
  function failRename(when: (from: string, to: string) => boolean) {
    const real = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation((from, to) =>
      when(String(from), String(to))
        ? Promise.reject(Object.assign(new Error("EACCES: injected"), { code: "EACCES" }))
        : real(from, to),
    );
  }
  const current = { "a.ts": "current", "extra.ts": "current", "ui/b.js": "current" };
  const contents = async () =>
    Object.fromEntries(
      await Promise.all(
        ["a.ts", "extra.ts", "ui/b.js", "state.json"].map(
          async (rel) => [rel, await fs.readFile(path.join(folderDir(), rel), "utf8")] as const,
        ),
      ),
    );

  it("a move that fails half way puts every file back", async () => {
    const folder = await folderWith(current);
    const before = await contents();
    // Another program holds `ui/b.js` open (Windows): it cannot be moved aside.
    failRename((from) => from.endsWith(path.join("ui", "b.js")));

    await expect(
      restoreSource(folder, source({ "package.json": "{}", "a.ts": "old", "ui/b.js": "old" })),
    ).rejects.toThrow("EACCES");

    expect(await contents()).toEqual(before);
    expect((await fs.readdir(folderDir())).filter((n) => n.startsWith(".restore"))).toEqual([]);
  });

  it("when putting back fails too, the error names where the previous files are kept", async () => {
    const folder = await folderWith(current);
    failRename(
      (from, to) =>
        from.endsWith(path.join("ui", "b.js")) ||
        (from.includes(".restore") && to.endsWith("a.ts")),
    );

    const failed = await restoreSource(
      folder,
      source({ "package.json": "{}", "a.ts": "old", "ui/b.js": "old" }),
    ).catch((err: Error) => err);

    expect(failed).toBeInstanceOf(AggregateError);
    const kept = /kept in (.+)\.$/.exec((failed as Error).message)![1]!;
    const names = await fs.readdir(kept);
    const bodies = await Promise.all(names.map((n) => fs.readFile(path.join(kept, n), "utf8")));
    expect(bodies).toContain("current");
  });

  it("staging a restore left an hour ago is cleared by the next restore", async () => {
    const folder = await folderWith({ "index.ts": "mine" });
    const stale = path.join(folderDir(), ".restore.penguin-tmpold");
    await fs.mkdir(stale);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(stale, twoHoursAgo, twoHoursAgo);

    await restoreSource(folder, source({ "package.json": "{}", "index.ts": "theirs" }));

    expect((await fs.readdir(folderDir())).filter((n) => n.startsWith(".restore"))).toEqual([]);
  });

  it("the files a commit is handed are the ones that loaded: an edit since gives none", async () => {
    const folder = await folderWith({ "index.ts": "loaded" });
    expect(texts(await readLoadedSource(folder))).toEqual({
      "package.json": "{}",
      "index.ts": "loaded",
    });

    await fs.writeFile(path.join(folderDir(), "index.ts"), "edited while compiling");
    expect(await readLoadedSource(folder)).toBeNull();
  });
});
