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
 * - Given a file under a name git reserves, it is left out with a log line and the history
 *   still reads.
 * - Given an unreadable HEAD, a detached one, or an empty or invalid branch ref, a commit and a
 *   history read are errors, never a fresh history.
 * - Restoring a version: a file where a directory was, or the reverse, comes out exactly; a
 *   version that holds something other than source is refused before anything is written.
 * - The files handed to a commit are the ones that loaded: an edit since the folder was read
 *   gives none.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentStateRepo,
  agentStateRepoDir,
  blobOid,
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
  await fs.rm(dir, { recursive: true, force: true });
});

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

  it("a file under a name git reserves is left out with a log line, and the history still reads", async () => {
    const repo = open();
    const files = [...DEMO, ...source({ "git~1": "x", "ui/.GIT/config": "y" })];
    expect((await repo.commitPath(REL, files, "workbench demo @1")).changed).toBe(true);

    expect(logged.some((line) => line.includes("git~1") && line.includes("ui/.GIT/config"))).toBe(
      true,
    );
    expect(await repo.history(REL)).toHaveLength(1);
    expect(texts(await repo.filesAt(REL, revisionOf(DEMO)))).toEqual(texts(DEMO));
    expect(revisionOf(files)).toBe(revisionOf(DEMO));
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

  it.each(["state.json", ".harness/ifaces.json", "node_modules/dep/index.js", "../outside.ts"])(
    "a version that holds %s is refused before anything is written",
    async (rel) => {
      const folder = await folderWith({ "index.ts": "mine" });

      await expect(
        restoreSource(folder, source({ "index.ts": "theirs", [rel]: "x" })),
      ).rejects.toThrow("not workbench source");
      expect(await fs.readFile(path.join(folderDir(), "index.ts"), "utf8")).toBe("mine");
    },
  );

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
