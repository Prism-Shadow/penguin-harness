/**
 * AppData (PRFC-0036): a system app's own folders in a Project, as a server module reaches them —
 * a plugin module booted into the real platform tree, requiring the host's interface, and one
 * declaring its own view of it, as a plugin built outside this repository does.
 *
 * - Given a Project, an app's folders are the system Agent's agent-level ones for that app id —
 *   data and cache under `agents/system_agent/app/`, state under `run/` — each a real directory
 *   by the time it is handed out; asking again answers the same.
 * - The Evaluation Center's `benchmark` app's data is the folder the Project's Benchmarks are
 *   listed from: a Benchmark created through its route is there.
 * - Given a Project made before the system Agent existed, asking gives it its system Agent first,
 *   and the folders sit under it.
 * - Given a Project whose `system_agent` is the user's own Agent, another app is refused 409
 *   `system_agent_held` and nothing is written into that Agent; the `benchmark` app still answers
 *   the Benchmarks folder, its cache outside that Agent.
 * - A link where one of the folders belongs is refused, and nothing is written through it.
 * - An id that is not one plain segment is 400; a Project the server does not have is 404.
 * - A plugin declaring its own view of AppData is wired to the host's; one whose view asks for a
 *   member this host lacks is left out of the generation, its reason naming the requirement —
 *   how a host older than AppData refuses the plugins that need it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentDir,
  benchmarksDir,
  legacyBenchmarksDir,
  runDir,
  SYSTEM_AGENT_ID,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable, ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { BenchmarkCreateRequest } from "../src/api/types.js";
import table from "../src/ifaces.json" with { type: "json" };
import { PluginHost } from "../src/plugin/host.js";
import type { AppData } from "../src/services/app-data.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HOST_KEY = "@prismshadow/penguin-server#AppData";
const PROJECT = "default_project";

/** A plugin module that requires `iface` and hands what it was given to the test. */
function requiring(name: string, iface: string, seen: { appData?: AppData }): ModuleDef {
  return {
    manifest: parseManifest({
      name,
      requires: { appData: { iface } },
      provides: {},
      contributes: {},
      children: [],
    }),
    create({ use }) {
      seen.appData = use.appData as AppData;
      return { api: {} };
    },
  };
}

/** The host's AppData declaration, as a plugin's build copies it into its own table under its own key. */
function viewTable(key: string, extraMember?: string): IfaceTable {
  const host = (table as unknown as IfaceTable).ifaces[HOST_KEY]!;
  const methods = { ...host.methods };
  if (extraMember !== undefined) methods[extraMember] = host.methods.dataPaths!;
  return { ifaces: { [key]: { ...host, methods } }, types: {} };
}

const isDir = async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;

describe("AppData", () => {
  let t: TestApp;
  const direct: { appData?: AppData } = {};
  const viewed: { appData?: AppData } = {};
  const newer: { appData?: AppData } = {};
  const host = new PluginHost();

  beforeAll(async () => {
    host.use({
      specifier: "@acme/direct",
      modules: [requiring("AcmeDirect", HOST_KEY, direct)],
      replaces: [],
    });
    host.use({
      specifier: "@acme/view",
      modules: [requiring("AcmeView", "@acme/view#AppData", viewed)],
      replaces: [],
      ifaces: viewTable("@acme/view#AppData"),
    });
    host.use({
      specifier: "@acme/newer",
      modules: [requiring("AcmeNewer", "@acme/newer#AppData", newer)],
      replaces: [],
      ifaces: viewTable("@acme/newer#AppData", "dataPathsAtLevel"),
    });
    t = await createTestApp({ plugins: host });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const appData = () => direct.appData!;

  it("hands out the system Agent's agent-level folders of the app, made before they are returned", async () => {
    const paths = await appData().dataPaths(PROJECT, "deck");
    const system = agentDir(t.root, PROJECT, SYSTEM_AGENT_ID);
    expect(paths.dataDir).toBe(path.join(system, "app", "data", "deck"));
    expect(paths.cacheDir).toBe(path.join(system, "app", "cache", "deck"));
    expect(path.relative(runDir(t.root), paths.stateDir).split(path.sep)).toHaveLength(3);
    for (const dir of Object.values(paths)) expect(await isDir(dir)).toBe(true);
    if (process.platform !== "win32") {
      expect((await fs.stat(paths.dataDir)).mode & 0o777).toBe(0o700);
    }
    expect(await appData().dataPaths(PROJECT, "deck")).toEqual(paths);
  });

  it("answers the Benchmarks folder for the benchmark app", async () => {
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const created = await admin.post(`/api/projects/${PROJECT}/benchmarks`, {
      id: "report-writing",
      title: "Report writing",
      runs: 1,
      cases: [{ id: "CASE-001-x", title: "X", statement: "Do X.", rubric: "- 100 pts: X." }],
    } satisfies BenchmarkCreateRequest);
    expect(created.status).toBe(201);
    const { dataDir } = await appData().dataPaths(PROJECT, "benchmark");
    expect(dataDir).toBe(benchmarksDir(t.root, PROJECT));
    expect(await isDir(path.join(dataDir, "report-writing"))).toBe(true);
  });

  it("gives a Project made before the system Agent its system Agent first", async () => {
    const { user } = await provisionUser(t.app, "olden");
    const project = `${user.userId}-default_project`;
    await fs.rm(agentDir(t.root, project, SYSTEM_AGENT_ID), { recursive: true, force: true });
    const paths = await appData().dataPaths(project, "deck");
    expect(await fs.readFile(systemConfigPath(t.root, project, SYSTEM_AGENT_ID), "utf8")).toMatch(
      /^system: true$/m,
    );
    expect(paths.dataDir).toBe(
      path.join(agentDir(t.root, project, SYSTEM_AGENT_ID), "app", "data", "deck"),
    );
  });

  it("writes nothing into the user's own system_agent: another app is 409, benchmark keeps its folder", async () => {
    const { user } = await provisionUser(t.app, "keeper");
    const project = `${user.userId}-default_project`;
    const theirs = agentDir(t.root, project, SYSTEM_AGENT_ID);
    // The user's Agent that held the id before the system Agent existed: no `system: true`.
    await fs.rm(theirs, { recursive: true, force: true });
    await fs.mkdir(path.join(theirs, "agent_state"), { recursive: true });
    await fs.writeFile(systemConfigPath(t.root, project, SYSTEM_AGENT_ID), "name: Mine\n");

    await expect(appData().dataPaths(project, "deck")).rejects.toMatchObject({
      status: 409,
      code: "system_agent_held",
    });
    const bench = await appData().dataPaths(project, "benchmark");
    expect(bench.dataDir).toBe(legacyBenchmarksDir(t.root, project));
    expect(await isDir(bench.dataDir)).toBe(true);
    for (const dir of [bench.cacheDir, bench.stateDir]) {
      expect(path.relative(theirs, dir).startsWith("..")).toBe(true);
      expect(await isDir(dir)).toBe(true);
    }
    expect(await fs.readdir(theirs)).toEqual(["agent_state"]);
  });

  it("refuses a link where a folder belongs, and writes nothing through it", async () => {
    const { user } = await provisionUser(t.app, "linker");
    const project = `${user.userId}-default_project`;
    const away = path.join(t.root, "away");
    await fs.mkdir(away, { recursive: true });
    const apps = path.join(agentDir(t.root, project, SYSTEM_AGENT_ID), "app");
    await fs.rm(apps, { recursive: true, force: true });
    await fs.symlink(away, apps, "dir");
    await expect(appData().dataPaths(project, "deck")).rejects.toThrow(/link or a file/);
    expect(await fs.readdir(away)).toEqual([]);
  });

  it("is 400 for an id that is not one segment and 404 for a Project the server does not have", async () => {
    await expect(appData().dataPaths(PROJECT, "../deck")).rejects.toMatchObject({ status: 400 });
    await expect(appData().dataPaths("../x", "deck")).rejects.toMatchObject({ status: 400 });
    await expect(appData().dataPaths("nowhere", "deck")).rejects.toMatchObject({
      status: 404,
      code: "project_not_found",
    });
    expect(await isDir(path.join(t.root, "nowhere"))).toBe(false);
  });

  it("wires a plugin's own view to the host's, and leaves out one asking for more than it offers", async () => {
    expect((await viewed.appData!.dataPaths(PROJECT, "deck")).dataDir).toBe(
      (await appData().dataPaths(PROJECT, "deck")).dataDir,
    );
    // Never created, and said where an administrator looks: the plugin's error record.
    expect(newer.appData).toBeUndefined();
    const recorded = t.deps.errorsRepo
      .recent(PROJECT, { includeGlobal: true })
      .filter((e) => e.code.startsWith("unsatisfied:"));
    expect(recorded.map((e) => e.code)).toEqual(["unsatisfied:@acme/newer"]);
    expect(recorded[0]!.message).toMatch(/requires\.appData/);
  });
});
