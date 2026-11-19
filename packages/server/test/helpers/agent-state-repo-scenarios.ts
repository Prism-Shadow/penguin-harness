/**
 * The Agent State repository's behaviour, as one suite any engine can be run through: the
 * server's own test runs it with the built-in engine (workbench-repo.test.ts), and an engine
 * plugin runs it with its own (plugins/agent-state-git). Whatever an engine writes has to read
 * back, list and restore exactly as the built-in engine's does.
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
 * - Given a folder holding a name git refuses (a `.git` spelling, a backslash, `.` behind
 *   characters HFS+ ignores), it is not source and not in the revision; a commit passed one
 *   leaves it out with a log line; the history, later commits and the removal all still work.
 * - Given a tree already holding such a name (written by another tool), the history, commits
 *   and the removal still work, the entry left out with a log line.
 * - Given a staging folder an interrupted creation left an hour ago, the next creation removes
 *   it; a younger one stays.
 * - Given an unreadable HEAD, a detached one, or an empty or invalid branch ref, a commit and a
 *   history read are errors, never a fresh history.
 * - Who a version is by: with no identity configured, PenguinHarness <penguin@localhost>; the
 *   global and the repository's config fill each field on its own, a role's own key winning;
 *   the role-specific environment variables win over config, and `EMAIL` comes after it; an
 *   `include` is not followed; no config file changes. A member who asked for the version is
 *   its author, the server its committer.
 * - An engine other than the built-in one writes the very same commits, object for object.
 *
 * The caller hands in its own `describe` / `it` / `expect` / hooks: a plugin package running this
 * file through a path import has a vitest of its own, and only that one is collecting tests.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import type * as Vitest from "vitest";
import type { AgentStateEngine } from "@prismshadow/penguin-core/plugin";
import {
  AgentStateRepo,
  agentStateRepoDir,
  blobOid,
  treeId,
  type SourceFile,
} from "../../src/workbenches/repo.js";
import { readFolder, readLoadedSource } from "../../src/workbenches/store.js";
import type { IdentitySources } from "../../src/workbenches/git-identity.js";

export const REL = "workbenches/demo";
export const T1 = new Date("2026-11-03T08:00:00.000Z");
export const T2 = new Date("2026-11-03T09:30:00.000Z");

export const source = (files: Record<string, string>): SourceFile[] =>
  Object.entries(files).map(([rel, text]) => ({ rel, body: Buffer.from(text) }));
export const revisionOf = (files: SourceFile[]) =>
  treeId(files.map((f) => ({ rel: f.rel, oid: blobOid(f.body) })));
export const texts = (files: SourceFile[] | null) =>
  Object.fromEntries((files ?? []).map((f) => [f.rel, Buffer.from(f.body).toString()]));

/**
 * `ui.css` beside `ui/` and two names whose UTF-16 order differs from their code point order:
 * git sorts a directory as if its name ended in `/`, and compares bytes.
 */
export const DEMO = source({
  "package.json": '{"name":"demo"}',
  "index.ts": "export default {};",
  "ui.css": "body{}",
  "ui/index.html": "<h1>v1</h1>",
  "\u{1F600}.txt": "astral",
  "ａ.txt": "fullwidth",
});
export const EDITED = source({
  "package.json": '{"name":"demo"}',
  "index.ts": "export default { edited: true };",
  "ui/index.html": "<h1>v2</h1>",
  "lib/util.ts": "export const x = 1;",
});

const ZWNJ = String.fromCodePoint(0x200c);

/** Every loose object file of a repository, as its id. */
export async function objectIds(at: string): Promise<string[]> {
  const out: string[] = [];
  for (const prefix of await fs.readdir(path.join(at, "objects"))) {
    if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
    for (const rest of await fs.readdir(path.join(at, "objects", prefix))) out.push(prefix + rest);
  }
  return out.sort();
}

/** The test functions of the vitest that runs the suite. */
export type TestApi = Pick<
  typeof Vitest,
  "describe" | "it" | "expect" | "beforeEach" | "afterEach"
>;

/** What the scenarios run against. */
export interface ScenarioEngine {
  /** Names the run: `built-in`, or the plugin's engine. */
  label: string;
  /** The engine under test, asked for when a repository is opened; undefined is the built-in one. */
  engine: () => AgentStateEngine | undefined;
}

export function agentStateRepoScenarios(t: TestApi, scenario: ScenarioEngine): void {
  t.describe(`the Agent State repository (${scenario.label} engine)`, () => scenarios(t, scenario));
}

function scenarios(t: TestApi, { engine }: ScenarioEngine): void {
  const { afterEach, beforeEach, describe, expect, it } = t;
  /** The Agent's directory, holding `agent_state/` and the repository beside it. */
  let dir: string;
  let gitdir: string;
  let now: Date;
  let logged: string[];
  /** The server's environment and home as the identity is read from them: empty unless a test sets them. */
  let env: Record<string, string | undefined>;
  let home: string;
  const identity = (): IdentitySources => ({
    env,
    home,
    readFile: (file) => {
      try {
        return nodeFs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
  });
  const open = (caps?: { versions?: number; commits?: number }, at = gitdir) =>
    new AgentStateRepo({
      gitdir: at,
      now: () => now,
      log: (line) => logged.push(line),
      caps,
      engine: engine(),
      // Every step goes to the engine under test, however small the folder.
      engineFrom: { commit: 1, read: 1 },
      identity: identity(),
    });
  const head = () => git.resolveRef({ fs: nodeFs, gitdir, ref: "HEAD" });
  const readCommit = async () =>
    (await git.readCommit({ fs: nodeFs, gitdir, oid: await head() })).commit;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-repo-"));
    await fs.mkdir(path.join(dir, "agent_state"));
    gitdir = agentStateRepoDir(dir);
    home = path.join(dir, "home");
    await fs.mkdir(home);
    env = {};
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

      const commit = await readCommit();
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
      const tip = await head();
      const { commit } = await git.readCommit({ ...nodeRepo, oid: tip });
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
          parent: [tip],
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

  describe("who a version is by", () => {
    const lines = async () => {
      const { author, committer } = await readCommit();
      return {
        author: `${author.name} <${author.email}>`,
        committer: `${committer.name} <${committer.email}>`,
      };
    };

    it("with no identity anywhere, PenguinHarness <penguin@localhost> on both lines", async () => {
      await open().commitPath(REL, DEMO, "workbench demo @1");

      expect(await lines()).toEqual({
        author: "PenguinHarness <penguin@localhost>",
        committer: "PenguinHarness <penguin@localhost>",
      });
    });

    it("the global and the repository's config fill each field on their own, without being written", async () => {
      const repo = open();
      await repo.commitPath(REL, DEMO, "workbench demo @1");
      const global = path.join(home, ".gitconfig");
      const local = path.join(gitdir, "config");
      await fs.writeFile(global, '[user]\n\tname = "Global Name" ; a comment\n');
      await fs.appendFile(local, "[author]\n\temail = author@local.example\n");
      const before = [await fs.readFile(global), await fs.readFile(local)];

      await repo.commitPath(REL, EDITED, "workbench demo @2");

      expect(await lines()).toEqual({
        author: "Global Name <author@local.example>",
        committer: "Global Name <penguin@localhost>",
      });
      expect([await fs.readFile(global), await fs.readFile(local)]).toEqual(before);
    });

    it("a role's environment variables win over config, EMAIL comes after config, and an include is not followed", async () => {
      const included = path.join(home, "included.gitconfig");
      await fs.writeFile(included, "[user]\n\tname = Included Name\n");
      const global = path.join(home, "custom.gitconfig");
      await fs.writeFile(
        global,
        `[include]\n\tpath = ${included}\n[user]\n\temail = global@example.com\n`,
      );
      env = {
        GIT_CONFIG_GLOBAL: global,
        GIT_AUTHOR_NAME: "Env Author",
        GIT_COMMITTER_EMAIL: "env@example.com",
        EMAIL: "generic@example.com",
      };

      await open().commitPath(REL, DEMO, "workbench demo @1");

      expect(await lines()).toEqual({
        author: "Env Author <global@example.com>",
        committer: "PenguinHarness <env@example.com>",
      });
    });

    it("a member who asked for the version is its author, and the server its committer", async () => {
      await fs.writeFile(
        path.join(home, ".gitconfig"),
        "[user]\n\tname = Server Account\n\temail = ops@example.com\n",
      );
      const repo = open();

      await repo.commitPath(REL, DEMO, "workbench demo @1", { by: { name: "Ada <Lovelace>" } });
      expect(await lines()).toEqual({
        author: "Ada Lovelace <ops@example.com>",
        committer: "Server Account <ops@example.com>",
      });

      await repo.removePath(REL, "workbench demo: removed", { by: { name: "Grace" } });
      expect((await lines()).author).toBe("Grace <ops@example.com>");
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

      const demo = await repo.filesAt(REL, revisionOf(DEMO));
      // A depth-first walk of git's entry order: `ui.css` before `ui/`, by bytes.
      expect(demo?.map((f) => f.rel)).toEqual([
        "index.ts",
        "package.json",
        "ui.css",
        "ui/index.html",
        "ａ.txt",
        "\u{1F600}.txt",
      ]);
      expect(texts(demo)).toEqual(texts(DEMO));
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
      {
        name: "an invalid branch ref",
        file: "refs/heads/main",
        content: async () => "nonsense\n",
      },
    ])("$name fails a commit and a history read", async ({ file, content }) => {
      const repo = open();
      await repo.commitPath(REL, DEMO, "workbench demo @1");
      await fs.writeFile(path.join(gitdir, file), await content());

      await expect(repo.commitPath(REL, EDITED, "workbench demo @2")).rejects.toThrow();
      await expect(repo.history(REL)).rejects.toThrow();
    });
  });

  describe.skipIf(engine() === undefined)("the same commits as the built-in engine", () => {
    it("every step of a history writes the commit and the objects the built-in engine writes", async () => {
      const twin = path.join(dir, "twin.git");
      const builtin = new AgentStateRepo({
        gitdir: twin,
        now: () => now,
        log: () => {},
        identity: identity(),
      });
      const steps: Array<(repo: AgentStateRepo) => Promise<unknown>> = [
        (repo) => repo.commitPath(REL, DEMO, "workbench demo @1"),
        (repo) => repo.commitPath("workbenches/other", EDITED, "workbench other @1"),
        (repo) => repo.commitPath(REL, EDITED, "workbench demo @2", { by: { name: "Ada" } }),
        (repo) => repo.removePath("workbenches/other", "workbench other: removed"),
        (repo) => repo.removePath(REL, "workbench demo: removed"),
        (repo) => repo.commitPath(REL, DEMO, "workbench demo @1"),
      ];
      const tips = (at: string) => git.resolveRef({ fs: nodeFs, gitdir: at, ref: "HEAD" });
      for (const step of steps) {
        now = new Date(now.getTime() + 61_000);
        await step(open());
        await step(builtin);
        expect(await head()).toBe(await tips(twin));
      }
      expect(await objectIds(gitdir)).toEqual(await objectIds(twin));
    });
  });
}
