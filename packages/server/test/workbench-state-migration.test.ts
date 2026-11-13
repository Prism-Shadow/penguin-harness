/**
 * An Agent's workbenches move from the place they had before Agent State into it, with the
 * versions recorded there, and the old place becomes a link to the new one.
 *
 * - Given an Agent in the old layout, its workbenches arrive under `agent_state/workbenches/` with
 *   `state.json` byte-identical, the old copies are kept in the journal's backup, and the old
 *   place is a link to the new one.
 * - Given its recorded versions, the history lists them newest first with the times they were
 *   saved; the folder's own edit, never loaded, is not among them.
 * - Given an Agent already on the new layout, nothing is written, journal included.
 * - Given a folder an Agent is still writing, nothing moves while its files are fresh, whether or
 *   not it has a package.json yet; once it has settled, all of it moves and the link appears.
 * - Given settled entries that are not workbenches (a `.DS_Store`, an invalid name, a folder without
 *   a package.json), they go to the backup and the link still appears; a fresh one waits.
 * - Given an id taken in Agent State, by any case, that folder stays in a real old directory,
 *   reported once, while the free ones move in with their versions; a stray file arriving later
 *   is kept beside the one backed up before.
 * - Given a run stopped after committing and before moving, the next one finishes it and records
 *   no version twice.
 * - Given the link, a file written through the old place lands in Agent State, an edit of a moved
 *   workbench included, and a link whose target was swapped away gets the target back.
 * - Given the link, removing it never removes the workbenches through it.
 * - Given a recorded workbench whose folder is gone, no version of it is imported.
 * - Given a Workflow-era Agent, one run takes `workflows/` to `agent_state/workbenches/`: what
 *   the conversion has just written needs no settling.
 * - Given two callers at once, both see one finished migration and each version once.
 * - Given a `versions.json` entry that is not a readable version, the readable ones are imported
 *   and the rest is reported.
 * - Given a repository that cannot be written, the workbench still moves and the copies are kept.
 *
 * Through the server:
 * - The Agents list migrates an Agent before counting its workbenches.
 * - The Agent's plugin list migrates first and shows the workbench a plugin installed.
 * - A plugin install (the route) or update (company mode) on an un-migrated Agent migrates first:
 *   the install updates the moved folder, keeping its data, and leaves the link as it is.
 * - The history route lists the imported versions, and rolling back to the oldest restores its files.
 * - A settled workbench written to the old place after the Agent's were listed is listed next time.
 * - An id taken in Agent State leaves the old folder in place, and the list still answers.
 * - A snapshot import on an un-migrated Agent moves its workbenches in first (they are in the
 *   backup taken before the import), and the link still leads to the imported State's; after
 *   importing a State without workbenches, a write through the old place lands at once.
 * - Deleting a linked Agent removes every entry once: the purge does not walk the link.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentDir, agentStateDir, snapshotsDir } from "@prismshadow/penguin-core";
import * as tar from "tar";
import type {
  AgentDeleteResponse,
  AgentDeletionInfo,
  AgentDeletionResponse,
  AgentsResponse,
  WorkbenchInfo,
  WorkbenchVersion,
} from "../src/api/types.js";
import { FsLimiter, purgeTree } from "../src/services/tree-purge.js";
import { migrateWorkbenches } from "../src/workbenches/migrate.js";
import { migrateWorkbenchesIntoState, SETTLE_MS } from "../src/workbenches/migrate-state.js";
import { AgentStateRepo, agentStateRepoDir } from "../src/workbenches/repo.js";
import { readFolder } from "../src/workbenches/store.js";
import { apiClient, createTestApp, provisionUser, type TestApp } from "./helpers.js";

/** The versions the old history recorded, oldest first. */
const RECORDED = [
  { savedAt: "2026-09-01T10:00:00.000Z", index: "export default 1;\n", page: "<h1>one</h1>" },
  { savedAt: "2026-09-02T10:00:00.000Z", index: "export default 2;\n", page: "<h1>two</h1>" },
];
const EDIT = "export default 3;\n";
/** The workbench's data, in a formatting of its own: it must arrive byte for byte. */
const STATE = '{ "count": 7,\n  "note": "kept" }\n';
const JOURNAL = ".workbench-migration";

/** Dates everything under `dir` back past the settle time, as files left alone since the upgrade. */
async function age(dir: string): Promise<void> {
  const then = new Date(Date.now() - 2 * SETTLE_MS);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await age(file);
    await fs.utimes(file, then, then);
  }
}

/**
 * Writes workbench `id` (default `demo`) as the layout before Agent State left it: each version of
 * RECORDED copied into `workbenches-history/<id>/<revision>/` and listed in its `versions.json`
 * (newest first), and the live folder at the newest version — or, with `edit`, past it — beside
 * its state and the server's dot-directories, settled unless `fresh`. Returns the history copies,
 * oldest first.
 */
async function oldLayout(
  agent: string,
  opts: { edit?: boolean; id?: string; fresh?: boolean } = {},
): Promise<string[]> {
  const id = opts.id ?? "demo";
  const live = path.join(agent, "workbenches", id);
  const history = path.join(agent, "workbenches-history", id);
  const entries: unknown[] = [];
  const copies: string[] = [];
  for (const [i, version] of RECORDED.entries()) {
    const files = {
      "package.json": JSON.stringify({ name: "Demo", version: `1.0.${i}` }),
      "index.ts": version.index,
      "ui/index.html": version.page,
    };
    // The old store named a copy after its own content hash; any 12-hex name is a revision.
    const revision = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 12);
    const copy = path.join(history, revision);
    for (const [rel, body] of Object.entries(files)) {
      for (const dir of [live, copy]) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fs.writeFile(path.join(dir, rel), body);
      }
    }
    copies.push(copy);
    entries.unshift({
      revision,
      savedAt: version.savedAt,
      name: "Demo",
      version: `1.0.${i}`,
      uiRev: null,
      files: Object.keys(files).sort(),
    });
  }
  await fs.writeFile(path.join(history, "versions.json"), JSON.stringify(entries, null, 2));
  if (opts.edit !== false) await fs.writeFile(path.join(live, "index.ts"), EDIT);
  await fs.writeFile(path.join(live, "state.json"), STATE);
  await fs.mkdir(path.join(live, ".harness"), { recursive: true });
  await fs.writeFile(path.join(live, ".harness", "ifaces.json"), "{}");
  if (opts.fresh !== true) await age(live);
  return copies;
}

const oldPlace = (agent: string, ...rel: string[]) => path.join(agent, "workbenches", ...rel);
const inState = (agent: string, id: string, ...rel: string[]) =>
  path.join(agent, "agent_state", "workbenches", id, ...rel);
const moved = (agent: string, ...rel: string[]) => inState(agent, "demo", ...rel);
const backedUp = (copy: string) =>
  copy.replace(
    `${path.sep}workbenches-history${path.sep}`,
    `${path.sep}${JOURNAL}${path.sep}backup${path.sep}workbenches-history${path.sep}`,
  );
const revisionOf = async (dir: string) => (await readFolder(dir, "demo"))!.revision;
const history = (agent: string, id = "demo") =>
  new AgentStateRepo({
    gitdir: agentStateRepoDir(agent),
    now: () => new Date(),
    log: () => {},
  }).history(`workbenches/${id}`);
const missing = (file: string) => expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
/** The old place is a link that leads to the Agent's workbenches folder. */
async function expectLinked(agent: string): Promise<void> {
  expect((await fs.lstat(oldPlace(agent))).isSymbolicLink()).toBe(true);
  expect(await fs.realpath(oldPlace(agent))).toBe(
    await fs.realpath(path.join(agent, "agent_state", "workbenches")),
  );
}

describe("moving workbenches into Agent State", () => {
  let agent: string;
  beforeEach(async () => {
    agent = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-state-migration-"));
  });
  afterEach(async () => {
    await fs.rm(agent, { recursive: true, force: true });
  });

  it("puts an old-layout Agent's workbenches into agent_state and links the old place", async () => {
    const copies = await oldLayout(agent);
    await migrateWorkbenches(agent);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await fs.readFile(moved(agent, "index.ts"), "utf8")).toBe(EDIT);
    expect(await fs.readFile(moved(agent, ".harness", "ifaces.json"), "utf8")).toBe("{}");
    await expectLinked(agent);
    await missing(path.join(agent, "workbenches-history"));
    // The old copies stay on disk for recovery.
    for (const copy of copies) {
      expect(await fs.readFile(path.join(backedUp(copy), "index.ts"), "utf8")).toMatch(/default/);
    }
  });

  it("lists the recorded versions newest first with their times, and not the unloaded edit", async () => {
    const copies = await oldLayout(agent);
    await migrateWorkbenches(agent);
    const versions = await history(agent);
    expect(versions.map((v) => v.revision)).toEqual([
      await revisionOf(backedUp(copies[1]!)),
      await revisionOf(backedUp(copies[0]!)),
    ]);
    expect(versions.map((v) => Date.parse(v.savedAt))).toEqual([
      Date.parse(RECORDED[1]!.savedAt),
      Date.parse(RECORDED[0]!.savedAt),
    ]);
    // The edit is recorded by the first load that succeeds, not by the move.
    expect(versions.map((v) => v.revision)).not.toContain(await revisionOf(moved(agent)));
  });

  it("leaves an Agent already on the new layout alone, journal included", async () => {
    await fs.mkdir(moved(agent), { recursive: true });
    await fs.writeFile(moved(agent, "package.json"), "{}");
    await migrateWorkbenches(agent);
    expect(await fs.readdir(agent)).toEqual(["agent_state"]);
    expect(await fs.readdir(path.join(agent, "agent_state"))).toEqual(["workbenches"]);
  });

  it("moves a folder an Agent is writing only once it has settled", async () => {
    const todo = oldPlace(agent, "todo");
    await fs.mkdir(path.join(todo, "ui"), { recursive: true });
    await fs.writeFile(path.join(todo, "ui", "index.html"), "<h1>todo</h1>");
    await migrateWorkbenches(agent);
    expect(await fs.readdir(todo)).toEqual(["ui"]);
    await fs.writeFile(path.join(todo, "package.json"), JSON.stringify({ name: "Todo" }));
    await fs.writeFile(path.join(todo, "index.ts"), "export default {};\n");
    await migrateWorkbenches(agent);
    expect((await fs.readdir(todo)).sort()).toEqual(["index.ts", "package.json", "ui"]);
    expect((await fs.lstat(oldPlace(agent))).isDirectory()).toBe(true);
    await age(todo);
    await migrateWorkbenches(agent);
    expect((await fs.readdir(inState(agent, "todo"))).sort()).toEqual([
      "index.ts",
      "package.json",
      "ui",
    ]);
    await expectLinked(agent);
  });

  it("keeps settled entries that are not workbenches in the backup, and still links", async () => {
    await oldLayout(agent);
    await fs.writeFile(oldPlace(agent, ".DS_Store"), "finder");
    await fs.mkdir(oldPlace(agent, "not an id"));
    await fs.writeFile(oldPlace(agent, "not an id", "notes.txt"), "kept");
    await age(oldPlace(agent));
    await migrateWorkbenches(agent);
    const kept = path.join(agent, JOURNAL, "backup", "workbenches");
    expect(await fs.readFile(path.join(kept, ".DS_Store"), "utf8")).toBe("finder");
    expect(await fs.readFile(path.join(kept, "not an id", "notes.txt"), "utf8")).toBe("kept");
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    await expectLinked(agent);
  });

  it("keeps a folder without a package.json in the backup once settled; a fresh one waits", async () => {
    const notes = oldPlace(agent, "notes");
    await fs.mkdir(notes, { recursive: true });
    await fs.writeFile(path.join(notes, "draft.md"), "draft");
    await migrateWorkbenches(agent);
    expect(await fs.readFile(path.join(notes, "draft.md"), "utf8")).toBe("draft");
    expect((await fs.lstat(oldPlace(agent))).isDirectory()).toBe(true);
    await age(oldPlace(agent));
    await migrateWorkbenches(agent);
    const kept = path.join(agent, JOURNAL, "backup", "workbenches", "notes", "draft.md");
    expect(await fs.readFile(kept, "utf8")).toBe("draft");
    await expectLinked(agent);
  });

  it("moves the free ids and leaves one taken by any case in a real old directory, reported once", async () => {
    const taken = await oldLayout(agent);
    const free = await oldLayout(agent, { id: "other" });
    await fs.mkdir(inState(agent, "Demo"), { recursive: true });
    await fs.writeFile(inState(agent, "Demo", "package.json"), "mine");
    const lines: string[] = [];
    for (let run = 0; run < 2; run++) {
      await migrateWorkbenchesIntoState(agent, { log: (line) => lines.push(line) });
    }
    expect(await fs.readFile(inState(agent, "Demo", "package.json"), "utf8")).toBe("mine");
    expect(await fs.readFile(oldPlace(agent, "demo", "index.ts"), "utf8")).toBe(EDIT);
    expect((await fs.lstat(oldPlace(agent))).isDirectory()).toBe(true);
    expect(await history(agent)).toEqual([]);
    expect(await fs.stat(taken[0]!)).toBeTruthy();
    expect(lines.filter((line) => line.includes("left in place"))).toHaveLength(1);
    expect(await fs.readFile(inState(agent, "other", "state.json"), "utf8")).toBe(STATE);
    await missing(oldPlace(agent, "other"));
    expect(await history(agent, "other")).toHaveLength(2);
    expect(await fs.stat(backedUp(free[0]!))).toBeTruthy();
    // The directory stays real, so stray files keep arriving; none overwrites the one before.
    const kept = path.join(agent, JOURNAL, "backup", "workbenches");
    for (const text of ["first", "second"]) {
      await fs.writeFile(oldPlace(agent, ".DS_Store"), text);
      await age(oldPlace(agent));
      await migrateWorkbenchesIntoState(agent);
    }
    expect(await fs.readFile(path.join(kept, ".DS_Store"), "utf8")).toBe("first");
    expect(await fs.readFile(path.join(kept, ".DS_Store.1"), "utf8")).toBe("second");
  });

  it("finishes a run stopped after committing and before moving, recording no version twice", async () => {
    const copies = await oldLayout(agent);
    await migrateWorkbenches(agent);
    const recorded = await history(agent);
    // Back where a run stopped before its renames left them, with the versions committed.
    await fs.unlink(oldPlace(agent));
    await fs.rename(path.join(agent, "agent_state", "workbenches"), oldPlace(agent));
    await fs.mkdir(path.join(agent, "workbenches-history"));
    await fs.rename(path.dirname(backedUp(copies[0]!)), path.dirname(copies[0]!));
    await migrateWorkbenches(agent);
    expect(await history(agent)).toEqual(recorded);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    await expectLinked(agent);
  });

  it("lands what is written through the old place in Agent State, and keeps the link's target", async () => {
    await oldLayout(agent);
    await migrateWorkbenches(agent);
    // As an Agent's file tools write from an installed Skill copy from before Agent State.
    await fs.mkdir(oldPlace(agent, "fresh", "ui"), { recursive: true });
    await fs.writeFile(oldPlace(agent, "fresh", "package.json"), JSON.stringify({ name: "F" }));
    const staged = oldPlace(agent, "demo", "index.ts.tmp");
    await fs.writeFile(staged, "export default 5;\n");
    await fs.rename(staged, oldPlace(agent, "demo", "index.ts"));
    expect(await fs.readFile(inState(agent, "fresh", "package.json"), "utf8")).toContain("F");
    expect(await fs.readFile(moved(agent, "index.ts"), "utf8")).toBe("export default 5;\n");
    await expectLinked(agent);
    // An Agent State import can swap in a State without workbenches: the next access restores
    // the link's target.
    await fs.rm(path.join(agent, "agent_state", "workbenches"), { recursive: true });
    await migrateWorkbenches(agent);
    await expectLinked(agent);
  });

  const removers: Array<[string, (link: string) => Promise<unknown>]> = [
    ["a recursive rm", (link) => fs.rm(link, { recursive: true, force: true })],
    [
      "the Agent deletion's purge",
      async (link) => expect(await purgeTree(link, { limiter: new FsLimiter(4) })).toBeNull(),
    ],
  ];
  it.each(removers)("never removes the workbenches through the link: %s", async (_, remove) => {
    await oldLayout(agent);
    await migrateWorkbenches(agent);
    await expectLinked(agent);
    await remove(oldPlace(agent));
    await missing(oldPlace(agent));
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
  });

  it("imports no version of a recorded workbench whose folder is gone", async () => {
    const copies = await oldLayout(agent);
    await fs.rm(oldPlace(agent, "demo"), { recursive: true });
    await migrateWorkbenches(agent);
    await missing(agentStateRepoDir(agent));
    expect(await fs.stat(copies[0]!)).toBeTruthy();
    await expectLinked(agent);
  });

  it("takes a Workflow-era Agent from workflows/ to agent_state/workbenches/ in one run", async () => {
    const old = path.join(agent, "workflows", "demo");
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(
      path.join(old, "package.json"),
      JSON.stringify({ name: "Demo", penguin: { modules: [{ name: "Workflow" }] } }),
    );
    await fs.writeFile(
      path.join(old, "index.ts"),
      'import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";\n',
    );
    await fs.writeFile(path.join(old, "state.json"), STATE);
    // Just written, but by the conversion, not an Agent: it moves on in the same run.
    await migrateWorkbenches(agent);
    expect(await fs.readFile(moved(agent, "index.ts"), "utf8")).toContain("WorkbenchPackage");
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    await missing(path.join(agent, "workflows"));
    await expectLinked(agent);
  });

  it("gives two callers at once one finished migration, each version recorded once", async () => {
    await oldLayout(agent);
    await Promise.all([migrateWorkbenches(agent), migrateWorkbenches(agent)]);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await history(agent)).toHaveLength(2);
  });

  /** How `versions.json` is broken, the versions listed afterwards and the entries reported. */
  const broken: Array<[string, (listed: unknown[]) => string, number, number]> = [
    ["an unparsable versions.json", () => "{", 0, 1],
    ["a versions.json that is not a list", () => "{}", 0, 1],
    [
      "entries that are not recorded versions",
      (listed) =>
        JSON.stringify([
          ...listed,
          { revision: "../../outside", savedAt: "2026-08-01T00:00:00.000Z" },
          { revision: "0123456789ab", savedAt: "2026-08-01T00:00:00.000Z" },
          { revision: (listed[0] as { revision: string }).revision, savedAt: "not a time" },
        ]),
      2,
      3,
    ],
  ];
  it.each(broken)(
    "imports what is readable and reports the rest: %s",
    async (_, rewrite, listedAfter, reported) => {
      await oldLayout(agent);
      const index = path.join(agent, "workbenches-history", "demo", "versions.json");
      await fs.writeFile(index, rewrite(JSON.parse(await fs.readFile(index, "utf8")) as unknown[]));
      const lines: string[] = [];
      await migrateWorkbenchesIntoState(agent, { log: (line) => lines.push(line) });
      expect(await history(agent)).toHaveLength(listedAfter);
      expect(lines.filter((line) => line.includes("demo"))).toHaveLength(reported);
      expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    },
  );

  it("still moves the workbench when its versions cannot be recorded, keeping the copies", async () => {
    const copies = await oldLayout(agent);
    await fs.mkdir(agentStateRepoDir(agent), { recursive: true });
    await fs.writeFile(path.join(agentStateRepoDir(agent), "HEAD"), "not a ref\n");
    const lines: string[] = [];
    await migrateWorkbenchesIntoState(agent, { log: (line) => lines.push(line) });
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await fs.stat(backedUp(copies[0]!))).toBeTruthy();
    expect(lines.join("\n")).toContain("demo: old versions not imported");
  });
});

describe(
  "the server migrates an Agent before it touches its workbenches",
  { timeout: 30_000 },
  () => {
    const PROJECT = "owner-migrate";
    let t: TestApp;
    let owner: ReturnType<typeof apiClient>;
    let agents = 0;
    beforeAll(async () => {
      t = await createTestApp();
      owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
      const created = await owner.post("/api/projects", { projectId: PROJECT, name: "migrate" });
      expect(created.status, await created.text()).toBe(201);
    });
    afterAll(async () => {
      await t.cleanup();
    });

    /** A new Agent of the Project; most scenarios then write its workbenches in the old layout. */
    async function newAgent(): Promise<{ agentId: string; dir: string; route: string }> {
      agents += 1;
      const agentId = `old_${agents}`;
      const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId });
      expect(made.status, await made.text()).toBe(201);
      return {
        agentId,
        dir: agentDir(t.root, PROJECT, agentId),
        route: `/api/projects/${PROJECT}/agents/${agentId}`,
      };
    }

    async function listOf(route: string): Promise<WorkbenchInfo[]> {
      const res = await owner.get(`${route}/workbenches`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { workbenches: WorkbenchInfo[] }).workbenches;
    }

    /** The support plugin's workbench as an install left it in the old layout, with its data. */
    async function oldSupport(dir: string): Promise<string> {
      const old = path.join(dir, "workbenches", "support");
      await fs.mkdir(old, { recursive: true });
      await fs.writeFile(
        path.join(old, "package.json"),
        JSON.stringify({ name: "support", penguin: { version: "2026.1.1", modules: [] } }),
      );
      await fs.writeFile(
        path.join(old, ".plugin.json"),
        JSON.stringify({
          name: "support",
          plugin: "penguin-support",
          version: "2026.1.1",
          files: ["package.json"],
        }),
      );
      await fs.writeFile(path.join(old, "state.json"), STATE);
      await age(old);
      return path.join(dir, "agent_state", "workbenches", "support");
    }

    it("counts an un-migrated Agent's workbench in the Agents list, migrating it first", async () => {
      const { agentId, dir } = await newAgent();
      await oldLayout(dir);
      const res = await owner.get(`/api/projects/${PROJECT}/agents`);
      expect(res.status).toBe(200);
      const { agents: listed } = (await res.json()) as AgentsResponse;
      expect(listed.find((a) => a.agentId === agentId)?.workbenchCount).toBe(1);
      expect(await fs.readFile(moved(dir, "state.json"), "utf8")).toBe(STATE);
    });

    it("shows the workbench a plugin installed in the Agent's plugin list, migrating it first", async () => {
      const { dir, route } = await newAgent();
      await oldSupport(dir);
      const res = await owner.get(`${route}/plugins`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        workbenches: [{ name: "support", plugin: "penguin-support", version: "2026.1.1" }],
      });
    });

    const installs: Array<[string, (route: string, agentId: string) => Promise<unknown>]> = [
      [
        "installing through the plugins route",
        async (route) => {
          const res = await owner.post(`${route}/plugins`, { names: ["penguin-support"] });
          expect(res.status, await res.text()).toBe(201);
        },
      ],
      [
        "a company-mode update",
        (_route, agentId) => t.deps.agentService.updatePlugin(PROJECT, agentId, "penguin-support"),
      ],
    ];
    it.each(installs)("updates the moved workbench, keeping its data: %s", async (_, install) => {
      const { agentId, dir, route } = await newAgent();
      const support = await oldSupport(dir);
      await install(route, agentId);
      expect(await fs.readFile(path.join(support, "state.json"), "utf8")).toBe(STATE);
      expect(await fs.stat(path.join(support, "index.ts"))).toBeTruthy();
      await expectLinked(dir);
    });

    it("lists the imported versions in the history route and rolls back to the oldest", async () => {
      const { dir, route } = await newAgent();
      await oldLayout(dir);
      const base = `${route}/workbenches/demo`;
      const res = await owner.get(`${base}/history`);
      expect(res.status).toBe(200);
      const { versions } = (await res.json()) as { versions: WorkbenchVersion[] };
      expect(versions.map((v) => Date.parse(v.savedAt))).toEqual([
        Date.parse(RECORDED[1]!.savedAt),
        Date.parse(RECORDED[0]!.savedAt),
      ]);
      const back = await owner.post(`${base}/rollback`, { revision: versions.at(-1)!.revision });
      expect(back.status, await back.text()).toBe(200);
      expect(await fs.readFile(moved(dir, "index.ts"), "utf8")).toBe(RECORDED[0]!.index);
      expect(await fs.readFile(moved(dir, "ui", "index.html"), "utf8")).toBe(RECORDED[0]!.page);
      expect(await fs.readFile(moved(dir, "state.json"), "utf8")).toBe(STATE);
    });

    it("lists a settled workbench written to the old place after the Agent's were listed", async () => {
      const { dir, route } = await newAgent();
      expect(await listOf(route)).toEqual([]);
      await oldLayout(dir, { id: "late" });
      expect((await listOf(route)).map((w) => w.id)).toEqual(["late"]);
      const res = await owner.get(`${route}/workbenches/late/history`);
      expect(((await res.json()) as { versions: WorkbenchVersion[] }).versions).toHaveLength(2);
      await expectLinked(dir);
    });

    it("keeps listing when an id taken in Agent State leaves the old folder in place", async () => {
      const { dir, route } = await newAgent();
      await fs.mkdir(moved(dir), { recursive: true });
      await fs.writeFile(moved(dir, "package.json"), JSON.stringify({ name: "Mine" }));
      await oldLayout(dir);
      expect((await listOf(route)).map((w) => [w.id, w.name])).toEqual([["demo", "Mine"]]);
      expect(await fs.readFile(oldPlace(dir, "demo", "state.json"), "utf8")).toBe(STATE);
    });

    it("moves an un-migrated Agent's workbenches in before a snapshot import replaces its state", async () => {
      const { agentId, dir, route } = await newAgent();
      await oldLayout(dir);
      const source = await newAgent();
      const pkg = path.join(agentStateDir(t.root, PROJECT, source.agentId), "workbenches", "pkg");
      await fs.mkdir(pkg, { recursive: true });
      await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "Pkg" }));
      const archive = Buffer.from(await (await owner.get(`${source.route}/export`)).arrayBuffer());
      const imported = await owner.post(`${route}/import`, {
        dataBase64: archive.toString("base64"),
        confirm: true,
      });
      expect(imported.status, await imported.text()).toBe(200);
      // What the Agent had is in the backup taken before its state was replaced.
      const snapshots = snapshotsDir(t.root, PROJECT, agentId);
      const [backup] = (await fs.readdir(snapshots)).filter((f) => f.startsWith("import-backup-"));
      const entries: string[] = [];
      await tar.list({
        file: path.join(snapshots, backup!),
        onReadEntry: (entry) => void entries.push(entry.path),
      });
      expect(entries).toContain("agent_state/workbenches/demo/state.json");
      // The link leads to the imported State's workbenches.
      await expectLinked(dir);
      expect(await fs.readFile(oldPlace(dir, "pkg", "package.json"), "utf8")).toContain("Pkg");
      expect((await listOf(route)).map((w) => w.id)).toEqual(["pkg"]);
      // A State without workbenches: a write through the old place right after still lands.
      const empty = await newAgent();
      const bare = Buffer.from(await (await owner.get(`${empty.route}/export`)).arrayBuffer());
      const again = await owner.post(`${route}/import`, {
        dataBase64: bare.toString("base64"),
        confirm: true,
      });
      expect(again.status, await again.text()).toBe(200);
      await fs.mkdir(oldPlace(dir, "after"), { recursive: true });
      await fs.writeFile(oldPlace(dir, "after", "package.json"), JSON.stringify({ name: "A" }));
      expect(await fs.readFile(inState(dir, "after", "package.json"), "utf8")).toContain("A");
      await expectLinked(dir);
    });

    it("deletes a linked Agent entry by entry, without walking the link", async () => {
      const { agentId, dir } = await newAgent();
      await oldLayout(dir);
      await owner.get(`/api/projects/${PROJECT}/agents`);
      await expectLinked(dir);
      const res = await owner.delete(`/api/projects/${PROJECT}/agents/${agentId}`);
      expect(res.status).toBe(202);
      const { deletion } = (await res.json()) as AgentDeleteResponse;
      let last: AgentDeletionInfo | undefined;
      await vi.waitFor(
        async () => {
          const read = await owner.get(
            `/api/projects/${PROJECT}/agent-deletions/${deletion.deletionId}`,
          );
          last = ((await read.json()) as AgentDeletionResponse).deletion;
          expect(["done", "failed"]).toContain(last.phase);
        },
        { timeout: 20_000, interval: 10 },
      );
      expect(last).toMatchObject({ phase: "done" });
      expect(last!.removed).toBe(last!.total);
    });
  },
);
