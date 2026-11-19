/**
 * The Agent State repository: a bare git repository beside `agent_state/`, where a workbench's
 * versions are the commits that touched its folder. Its behaviour is one suite any engine runs
 * (./helpers/agent-state-repo-scenarios.ts), run here with the built-in engine; what follows it
 * is the built-in engine's own, and the folder side of a restore.
 *
 * - A name git refuses is judged as isomorphic-git judges it when it reads a tree.
 * - Given object files a crash left empty, the next commit of those objects writes them again,
 *   and every workbench's history still reads.
 * - Given a contributed engine, it writes the commits of folders from the size it is worth it at,
 *   and reads large versions' files back; the comparison, the history walk, removals and
 *   anything smaller stay built-in. One that cannot run at all is replaced by the built-in engine
 *   for that step and reported once, and one whose git refuses a write fails the write as the
 *   built-in engine would.
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
import type { AgentStateEngine } from "@prismshadow/penguin-core/plugin";
import {
  AgentStateRepo,
  agentStateRepoDir,
  builtinEngine,
  isGitName,
} from "../src/workbenches/repo.js";
import { readFolder, readLoadedSource, restoreSource } from "../src/workbenches/store.js";
import {
  agentStateRepoScenarios,
  DEMO,
  EDITED,
  objectIds,
  REL,
  revisionOf,
  source,
  T1,
  texts,
} from "./helpers/agent-state-repo-scenarios.js";

agentStateRepoScenarios(
  { afterEach, beforeEach, describe, expect, it },
  { label: "built-in", engine: () => undefined },
);

/** The Agent's directory, holding `agent_state/` and the repository beside it. */
let dir: string;
let gitdir: string;
let now: Date;
let logged: string[];
const quiet = { env: {}, home: os.tmpdir(), readFile: () => null };
const open = (
  engine?: AgentStateEngine,
  opts: {
    onEngineUnavailable?: (e: AgentStateEngine) => void;
    engineFrom?: { commit?: number; read?: number };
  } = {},
) =>
  new AgentStateRepo({
    gitdir,
    now: () => now,
    log: (line) => logged.push(line),
    engine,
    ...opts,
    identity: quiet,
  });
/** A contributed engine, handed every step whatever the folder's size. */
const always = { commit: 1, read: 1 };

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

describe("the built-in engine", () => {
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

  it("object files a crash left empty are written again by the next commit of them", async () => {
    const v1 = source({ "package.json": "{}", "index.ts": "one" });
    const v2 = source({ "package.json": "{}", "index.ts": "two" });
    const other = source({ "package.json": "{}" });
    // A scratch repository with the same history tells which objects version 2 writes.
    const scratch = path.join(dir, "scratch.git");
    const twin = new AgentStateRepo({
      gitdir: scratch,
      now: () => now,
      log: () => {},
      identity: quiet,
    });
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
});

describe("a contributed engine", () => {
  /** The built-in engine under another name, counting what it is asked to do. */
  function counting(fail?: () => Error) {
    const calls: string[] = [];
    const engine: AgentStateEngine = {
      name: "counting",
      async commit(c) {
        calls.push(`commit ${c.rel}`);
        const err = fail?.();
        if (err) throw err;
        return builtinEngine.commit(c);
      },
      async readBlobs(at, oids) {
        calls.push(`readBlobs ${oids.length}`);
        const err = fail?.();
        if (err) throw err;
        return builtinEngine.readBlobs(at, oids);
      },
    };
    return { engine, calls };
  }
  const unavailable = () =>
    Object.assign(new Error("spawn git ENOENT"), { engineUnavailable: true as const });

  it("writes the commits and reads the versions' blobs back; the comparison, the walk and removals stay built-in", async () => {
    const { engine, calls } = counting();
    const repo = open(engine, { engineFrom: always });
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    await repo.commitPath(REL, DEMO, "workbench demo @1 again");
    await repo.history(REL);
    expect(texts(await repo.filesAt(REL, revisionOf(DEMO)))).toEqual(texts(DEMO));
    await repo.removePath(REL, "workbench demo: removed");

    expect(calls).toEqual([`commit ${REL}`, `readBlobs ${DEMO.length}`]);
  });

  it("is not handed a folder smaller than the size it says it is faster from", async () => {
    const { engine, calls } = counting();
    const repo = open({ ...engine, fasterFrom: { commit: 7, read: 7 } });
    await repo.commitPath(REL, DEMO, "workbench demo @1");
    expect(texts(await repo.filesAt(REL, revisionOf(DEMO)))).toEqual(texts(DEMO));
    expect(calls).toEqual([]);

    const larger = [...DEMO, ...source({ "more.ts": "1" })];
    await repo.commitPath(REL, larger, "workbench demo @2");
    expect(texts(await repo.filesAt(REL, revisionOf(larger)))).toEqual(texts(larger));
    expect(calls).toEqual([`commit ${REL}`, `readBlobs ${larger.length}`]);
  });

  it("one that cannot run is replaced by the built-in engine for that step, reported once, and not asked again", async () => {
    const { engine, calls } = counting(unavailable);
    const dropped: AgentStateEngine[] = [];
    const repo = open(engine, { engineFrom: always, onEngineUnavailable: (e) => dropped.push(e) });

    expect((await repo.commitPath(REL, DEMO, "workbench demo @1")).changed).toBe(true);
    expect(texts(await repo.filesAt(REL, revisionOf(DEMO)))).toEqual(texts(DEMO));
    expect((await repo.commitPath(REL, EDITED, "workbench demo @2")).changed).toBe(true);

    expect(calls).toEqual([`commit ${REL}`]);
    expect(dropped).toEqual([engine]);
    expect(logged.filter((line) => line.includes("counting could not run"))).toEqual([
      "counting could not run (spawn git ENOENT); the built-in engine takes over",
    ]);
    expect((await open().history(REL)).map((v) => v.revision)).toEqual([
      revisionOf(EDITED),
      revisionOf(DEMO),
    ]);
  });

  it("one whose git refuses the write fails it, and nothing is written in its place", async () => {
    const { engine } = counting(() => new Error("fatal: cannot lock ref 'refs/heads/main'"));
    await open().commitPath(REL, DEMO, "workbench demo @1");
    const tip = await git.resolveRef({ fs: nodeFs, gitdir, ref: "HEAD" });

    await expect(
      open(engine, { engineFrom: always }).commitPath(REL, EDITED, "workbench demo @2"),
    ).rejects.toThrow("cannot lock ref");
    expect(await git.resolveRef({ fs: nodeFs, gitdir, ref: "HEAD" })).toBe(tip);
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
