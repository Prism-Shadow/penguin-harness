/**
 * An Agent's workbenches move into its Agent State once, with the versions recorded before.
 *
 * - Given an Agent in the old layout, one migration puts its workbenches under
 *   `agent_state/workbenches/` with `state.json` byte-identical, and keeps the old copies in the
 *   journal's backup.
 * - Given its recorded versions, the history lists them newest first with the times they were
 *   saved; an edit the live folder carries is the newest version, and a live folder equal to the
 *   newest recorded version is listed once.
 * - Given an Agent already on the new layout, nothing is written, journal included.
 * - Given both the old and the new folder, the migration refuses, naming the fix, and moves nothing.
 * - Given a run stopped before its end mark, the next one finishes it and records no version twice;
 *   once finished, it never runs again, so a later edit is not recorded by it.
 * - Given a run stopped before the workbench moved, a folder made at the new place meanwhile is
 *   still refused; once moved aside, the run finishes.
 * - Given a recorded workbench whose folder is gone, no version of it is imported.
 * - Given a Workflow-era Agent, one migration takes `workflows/` to `agent_state/workbenches/`.
 * - Given two callers at once, both see one finished migration and each version once.
 * - Given a `versions.json` entry that is not a readable version, the readable ones are imported
 *   and the rest is reported.
 * - Given a repository that cannot be written, the workbench still moves and the copies stay in
 *   the backup.
 *
 * Through the server:
 * - The Agents list migrates an Agent before counting its workbenches.
 * - The Agent's plugin list migrates first and shows the workbench a plugin installed.
 * - A plugin install (the route) or update (company mode) on an un-migrated Agent migrates first:
 *   the install updates the moved folder, keeping its data, instead of creating a new one.
 * - The history route lists the imported versions, and rolling back to the oldest restores its files.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentDir } from "@prismshadow/penguin-core";
import type { AgentsResponse, WorkbenchVersion } from "../src/api/types.js";
import { migrateWorkbenches } from "../src/workbenches/migrate.js";
import { migrateWorkbenchesIntoState } from "../src/workbenches/migrate-state.js";
import { AgentStateRepo } from "../src/workbenches/repo.js";
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

/**
 * Writes `demo` as the layout before Agent State left it: each version of RECORDED copied into
 * `workbenches-history/demo/<revision>/` and listed in its `versions.json` (newest first), and the
 * live folder at the newest version — or, with `edit`, past it — beside its state and the
 * server's dot-directories. Returns the history copies, oldest first.
 */
async function oldLayout(agent: string, opts: { edit?: boolean } = {}): Promise<string[]> {
  const live = path.join(agent, "workbenches", "demo");
  const history = path.join(agent, "workbenches-history", "demo");
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
  return copies;
}

const moved = (agent: string, ...rel: string[]) =>
  path.join(agent, "agent_state", "workbenches", "demo", ...rel);
const backedUp = (copy: string) =>
  copy.replace(
    `${path.sep}workbenches-history${path.sep}`,
    `${path.sep}${JOURNAL}${path.sep}backup${path.sep}workbenches-history${path.sep}`,
  );
const revisionOf = async (dir: string) => (await readFolder(dir, "demo"))!.revision;
const history = (agent: string) =>
  new AgentStateRepo({
    stateDir: path.join(agent, "agent_state"),
    now: () => new Date(),
    log: () => {},
  }).history("workbenches/demo");
const missing = (file: string) => expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });

describe("moving workbenches into Agent State", () => {
  let agent: string;
  beforeEach(async () => {
    agent = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-state-migration-"));
  });
  afterEach(async () => {
    await fs.rm(agent, { recursive: true, force: true });
  });

  it("puts an old-layout Agent's workbenches into agent_state with their data byte-identical", async () => {
    const copies = await oldLayout(agent);
    await migrateWorkbenches(agent);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await fs.readFile(moved(agent, "index.ts"), "utf8")).toBe(EDIT);
    expect(await fs.readFile(moved(agent, ".harness", "ifaces.json"), "utf8")).toBe("{}");
    await missing(path.join(agent, "workbenches"));
    await missing(path.join(agent, "workbenches-history"));
    // The old copies stay on disk for recovery.
    for (const copy of copies) {
      expect(await fs.readFile(path.join(backedUp(copy), "index.ts"), "utf8")).toMatch(/default/);
    }
  });

  it.each([
    ["an edit the live folder carries is the newest version", true, 3],
    ["a live folder equal to the newest recorded version is listed once", false, 2],
  ])("lists the recorded versions newest first with their times: %s", async (_, edit, count) => {
    const copies = await oldLayout(agent, { edit });
    await migrateWorkbenches(agent);
    const versions = await history(agent);
    expect(versions).toHaveLength(count);
    expect(versions[0]!.revision).toBe(await revisionOf(moved(agent)));
    const recorded = versions.slice(-2);
    expect(recorded.map((v) => v.revision)).toEqual([
      await revisionOf(backedUp(copies[1]!)),
      await revisionOf(backedUp(copies[0]!)),
    ]);
    expect(recorded.map((v) => Date.parse(v.savedAt))).toEqual([
      Date.parse(RECORDED[1]!.savedAt),
      Date.parse(RECORDED[0]!.savedAt),
    ]);
  });

  it("leaves an Agent already on the new layout alone, journal included", async () => {
    await fs.mkdir(moved(agent), { recursive: true });
    await fs.writeFile(moved(agent, "package.json"), "{}");
    await migrateWorkbenches(agent);
    expect(await fs.readdir(agent)).toEqual(["agent_state"]);
    expect(await fs.readdir(path.join(agent, "agent_state"))).toEqual(["workbenches"]);
  });

  it("refuses when the old and the new folder both exist, naming the fix and moving nothing", async () => {
    await oldLayout(agent);
    const mine = path.join(agent, "agent_state", "workbenches", "mine");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "package.json"), "keep");
    await expect(migrateWorkbenches(agent)).rejects.toThrow(
      /agent_state\/workbenches already exists .*Move it aside before retrying/,
    );
    expect(await fs.readFile(path.join(mine, "package.json"), "utf8")).toBe("keep");
    expect(await fs.readFile(path.join(agent, "workbenches", "demo", "index.ts"), "utf8")).toBe(
      EDIT,
    );
    expect(await fs.stat(path.join(agent, "workbenches-history", "demo"))).toBeTruthy();
    await missing(path.join(agent, JOURNAL));
  });

  it("finishes a run stopped before its end mark, recording no version twice", async () => {
    await oldLayout(agent);
    await migrateWorkbenches(agent);
    const recorded = await history(agent);
    // Stopped after its last commit: the folder is already in its new place, which the next run
    // must not mistake for a workbench made independently.
    await fs.rm(path.join(agent, JOURNAL, "state-complete"));
    await migrateWorkbenches(agent);
    expect(await history(agent)).toEqual(recorded);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    // Finished: an edit since is the next load's to record, not a migration's.
    await fs.writeFile(moved(agent, "index.ts"), "export default 4;\n");
    await migrateWorkbenches(agent);
    expect(await history(agent)).toEqual(recorded);
  });

  it("refuses, after a run stopped before the move, a folder made at the new place meanwhile", async () => {
    await oldLayout(agent);
    // Something in the journal's way stops the first run once it has started.
    await fs.mkdir(path.join(agent, JOURNAL));
    await fs.writeFile(path.join(agent, JOURNAL, "backup"), "");
    await expect(migrateWorkbenches(agent)).rejects.toThrow();
    await fs.rm(path.join(agent, JOURNAL, "backup"));
    const mine = path.join(agent, "agent_state", "workbenches", "mine");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "package.json"), "keep");
    await expect(migrateWorkbenches(agent)).rejects.toThrow("Move it aside before retrying");
    expect(await fs.readFile(path.join(mine, "package.json"), "utf8")).toBe("keep");
    expect(await fs.readFile(path.join(agent, "workbenches", "demo", "index.ts"), "utf8")).toBe(
      EDIT,
    );
    await fs.rm(path.join(agent, "agent_state", "workbenches"), { recursive: true });
    await migrateWorkbenches(agent);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await history(agent)).toHaveLength(3);
  });

  it("imports no version of a recorded workbench whose folder is gone", async () => {
    const copies = await oldLayout(agent);
    await fs.rm(path.join(agent, "workbenches", "demo"), { recursive: true });
    await migrateWorkbenches(agent);
    await missing(path.join(agent, "agent_state", ".git"));
    expect(await fs.stat(backedUp(copies[0]!))).toBeTruthy();
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
    await migrateWorkbenches(agent);
    expect(await fs.readFile(moved(agent, "index.ts"), "utf8")).toContain("WorkbenchPackage");
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    await missing(path.join(agent, "workflows"));
    await missing(path.join(agent, "workbenches"));
    expect((await history(agent)).map((v) => v.revision)).toEqual([await revisionOf(moved(agent))]);
  });

  it("gives two callers at once one finished migration, each version recorded once", async () => {
    await oldLayout(agent);
    await Promise.all([migrateWorkbenches(agent), migrateWorkbenches(agent)]);
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await history(agent)).toHaveLength(3);
  });

  /** How `versions.json` is broken, the versions listed afterwards and the entries reported. */
  const broken: Array<[string, (listed: unknown[]) => string, number, number]> = [
    ["an unparsable versions.json", () => "{", 1, 1],
    ["a versions.json that is not a list", () => "{}", 1, 1],
    [
      "entries that are not recorded versions",
      (listed) =>
        JSON.stringify([
          ...listed,
          { revision: "../../outside", savedAt: "2026-08-01T00:00:00.000Z" },
          { revision: "0123456789ab", savedAt: "2026-08-01T00:00:00.000Z" },
          { revision: (listed[0] as { revision: string }).revision, savedAt: "not a time" },
        ]),
      3,
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
      // The live folder is a version either way; the readable old ones come before it.
      expect(await history(agent)).toHaveLength(listedAfter);
      expect(lines.filter((line) => line.includes("demo"))).toHaveLength(reported);
    },
  );

  it("still moves the workbench when its versions cannot be recorded, keeping the copies", async () => {
    const copies = await oldLayout(agent);
    await fs.mkdir(path.join(agent, "agent_state", ".git"), { recursive: true });
    await fs.writeFile(path.join(agent, "agent_state", ".git", "HEAD"), "not a ref\n");
    const lines: string[] = [];
    await migrateWorkbenchesIntoState(agent, { log: (line) => lines.push(line) });
    expect(await fs.readFile(moved(agent, "state.json"), "utf8")).toBe(STATE);
    expect(await fs.stat(backedUp(copies[0]!))).toBeTruthy();
    expect(lines.join("\n")).toContain("demo");
    // Finished, not retried: a later import would land after the versions loads record.
    expect(await fs.stat(path.join(agent, JOURNAL, "state-complete"))).toBeTruthy();
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

    /** A new Agent of the Project, for its workbenches to be written in the old layout. */
    async function unmigrated(): Promise<{ agentId: string; dir: string; route: string }> {
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
      return path.join(dir, "agent_state", "workbenches", "support");
    }

    it("counts an un-migrated Agent's workbench in the Agents list, migrating it first", async () => {
      const { agentId, dir } = await unmigrated();
      await oldLayout(dir);
      const res = await owner.get(`/api/projects/${PROJECT}/agents`);
      expect(res.status).toBe(200);
      const { agents: listed } = (await res.json()) as AgentsResponse;
      expect(listed.find((a) => a.agentId === agentId)?.workbenchCount).toBe(1);
      expect(await fs.readFile(moved(dir, "state.json"), "utf8")).toBe(STATE);
    });

    it("shows the workbench a plugin installed in the Agent's plugin list, migrating it first", async () => {
      const { dir, route } = await unmigrated();
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
      const { agentId, dir, route } = await unmigrated();
      const support = await oldSupport(dir);
      await install(route, agentId);
      expect(await fs.readFile(path.join(support, "state.json"), "utf8")).toBe(STATE);
      expect(await fs.stat(path.join(support, "index.ts"))).toBeTruthy();
      await missing(path.join(dir, "workbenches"));
    });

    it("lists the imported versions in the history route and rolls back to the oldest", async () => {
      const { dir, route } = await unmigrated();
      await oldLayout(dir);
      const base = `${route}/workbenches/demo`;
      const res = await owner.get(`${base}/history`);
      expect(res.status).toBe(200);
      const { versions } = (await res.json()) as { versions: WorkbenchVersion[] };
      expect(versions.slice(1).map((v) => Date.parse(v.savedAt))).toEqual([
        Date.parse(RECORDED[1]!.savedAt),
        Date.parse(RECORDED[0]!.savedAt),
      ]);
      const back = await owner.post(`${base}/rollback`, { revision: versions.at(-1)!.revision });
      expect(back.status, await back.text()).toBe(200);
      expect(await fs.readFile(moved(dir, "index.ts"), "utf8")).toBe(RECORDED[0]!.index);
      expect(await fs.readFile(moved(dir, "ui", "index.html"), "utf8")).toBe(RECORDED[0]!.page);
      expect(await fs.readFile(moved(dir, "state.json"), "utf8")).toBe(STATE);
    });
  },
);
