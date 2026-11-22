/**
 * The server and the data root's `projects/` level (PRFC-0034), on data roots built in the old
 * layout by the test — never a real root:
 *
 * - A start migrates the root before it serves: its Projects are listed from `projects/`, the
 *   stored Session Workspaces under a moved folder are rewritten, and the Project opens.
 * - A Project called `projects` keeps the server from starting, naming the Project and the fix.
 * - A new Project's sample Benchmarks are written into the Evaluation Center's data folder, and the
 *   list names that folder and each Benchmark's, for the prompts that must not derive them.
 * - A Project whose `system_agent` is an Agent of the user's lists its Benchmarks from the old
 *   folder.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  benchmarksDir,
  legacyBenchmarksDir,
  listProjectDirs,
  projectDir,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { openDatabase } from "@prismshadow/penguin-library-db";
import type { BenchmarksResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";

let t: TestApp | undefined;

afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
}

describe("a server start on a data root in the old layout", () => {
  it("moves its Projects under projects/ before serving, with the Workspaces web.db stores", async () => {
    const SESSION = "session-2026-11-01-10-00-00-abcdef01";
    let oldWorkspace = "";
    t = await createTestApp({
      durableDatabase: true,
      beforeSeed: async (root) => {
        await write(path.join(root, "default_project", ".project_config.toml"), "");
        oldWorkspace = path.join(
          root,
          "default_project",
          "agents",
          "default_agent",
          "workspaces",
          "tmp-0a1b2c3d",
        );
        await fs.mkdir(oldWorkspace, { recursive: true });
        const db = openDatabase(path.join(root, "web.db"));
        db.prepare(
          "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at) VALUES (?, 'default_project', 'default_agent', 'deepseek', 'deepseek-flash', ?, ?)",
        ).run(SESSION, oldWorkspace, "2026-11-01T10:00:00.000Z");
        db.close();
      },
    });

    expect((await listProjectDirs(t.root)).map((p) => p.id)).toEqual(["default_project"]);
    expect((await fs.lstat(path.join(t.root, "default_project"))).isSymbolicLink()).toBe(true);
    const row = t.deps.db
      .prepare("SELECT workspace FROM sessions WHERE session_id = ?")
      .get(SESSION) as { workspace: string };
    expect(row.workspace).toBe(
      path.join(
        projectDir(t.root, "default_project"),
        "agents",
        "default_agent",
        "workspaces",
        "tmp-0a1b2c3d",
      ),
    );
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const agents = (await (await admin.get("/api/projects/default_project/agents")).json()) as {
      agents: { agentId: string }[];
    };
    expect(agents.agents.map((a) => a.agentId)).toContain("default_agent");
  });

  it("does not start while a Project is called projects, and says what to do", async () => {
    await expect(
      createTestApp({
        beforeSeed: async (root) => {
          await write(path.join(root, "projects", ".project_config.toml"), "");
          await write(path.join(root, "acme", ".project_config.toml"), "");
        },
      }),
    ).rejects.toThrow(
      /a Project named "projects".*Nothing was moved\. Start the previous version, move this Project's Agents/s,
    );
  });
});

describe("Benchmarks in the Evaluation Center's data folder", () => {
  it("are written there for a new Project, and the list names the folder and each Benchmark's", async () => {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.post("/api/projects", { projectId: "evals", name: "Evals" })).status).toBe(
      201,
    );

    const list = (await (
      await admin.get("/api/projects/evals/benchmarks")
    ).json()) as BenchmarksResponse;

    const folder = benchmarksDir(t.root, "evals");
    expect(folder).toBe(
      path.join(projectDir(t.root, "evals"), "agents", "system_agent", "app", "data", "benchmark"),
    );
    expect(list.dir).toBe(folder);
    const example = list.benchmarks.find((b) => b.id === "example-benchmark");
    expect(example?.dir).toBe(path.join(folder, "example-benchmark"));
    await expect(
      fs.access(path.join(folder, "example-benchmark", "benchmark_config.toml")),
    ).resolves.toBeUndefined();
  });

  it("stay in the old folder of a Project whose system_agent is an Agent of the user's", async () => {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.post("/api/projects", { projectId: "mine", name: "Mine" })).status).toBe(
      201,
    );
    // The Agent holding the id carries no `system: true`: it is the user's own (compat C1).
    const config = systemConfigPath(t.root, "mine", "system_agent");
    const own = parseYaml(await fs.readFile(config, "utf8")) as Record<string, unknown>;
    delete own.system;
    await fs.writeFile(config, stringifyYaml(own), "utf8");
    const legacy = legacyBenchmarksDir(t.root, "mine");
    await write(
      path.join(legacy, "kept", "benchmark_config.toml"),
      'id = "kept"\ntitle = "Kept"\nstatus = "published"\n',
    );

    const list = (await (
      await admin.get("/api/projects/mine/benchmarks")
    ).json()) as BenchmarksResponse;

    expect(list.dir).toBe(legacy);
    expect(list.benchmarks.map((b) => b.id)).toEqual(["kept"]);
  });
});
