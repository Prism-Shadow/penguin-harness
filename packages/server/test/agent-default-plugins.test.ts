/** Plugin selection on the create route shared by the Web App, CLI and recruitment. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentPluginsInstallResponse, PluginLibraryResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENTS = "/api/projects/default_project/agents";

describe("plugin selection for ordinary new Agents", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const create = async (body: Record<string, unknown>) => {
    const res = await admin.post(AGENTS, body);
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const hooksOf = async (agentId: string) => {
    const res = await admin.get(`${AGENTS}/${agentId}/plugins`);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentPluginsInstallResponse).hooks.map((h) => h.name).sort();
  };
  const skillsOf = async (agentId: string) => {
    const res = await admin.get(`${AGENTS}/${agentId}/plugins`);
    return ((await res.json()) as AgentPluginsInstallResponse).skills.map((s) => s.name);
  };

  it("creates an ordinary Agent without optional plugins when none were selected", async () => {
    await create({ agentId: "plain_one" });
    expect(await hooksOf("plain_one")).toEqual([]);
    expect(await skillsOf("plain_one")).toEqual([]);
  });

  it("installs explicitly selected modes and skills", async () => {
    await create({ agentId: "picked_one", plugins: ["trace-lookup", "plan", "goal"] });
    expect(await hooksOf("picked_one")).toEqual(["goal", "plan"]);
    expect(await skillsOf("picked_one")).toContain("trace-lookup");
  });

  it("installs exactly the named plugins with defaultPlugins: false, and none for none", async () => {
    await create({ agentId: "chosen_one", plugins: ["goal"], defaultPlugins: false });
    expect(await hooksOf("chosen_one")).toEqual(["goal"]);
    await create({ agentId: "bare_one", defaultPlugins: false });
    expect(await hooksOf("bare_one")).toEqual([]);
  });

  it("refuses a defaultPlugins that is not a boolean, creating nothing", async () => {
    const res = await admin.post(AGENTS, { agentId: "odd_one", defaultPlugins: "no" });
    expect(res.status).toBe(400);
    expect((await admin.get(`${AGENTS}/odd_one/config`)).status).toBe(404);
  });

  it("gives an imported Agent no defaults: it keeps the plugins its package carries", async () => {
    await create({ agentId: "exported_one", defaultPlugins: false });
    const zip = await admin.get(`${AGENTS}/exported_one/archive`);
    expect(zip.status).toBe(200);
    const imported = await admin.upload(
      `${AGENTS}/import?agentId=imported_one`,
      new Uint8Array(await zip.arrayBuffer()),
    );
    expect(imported.status, await imported.clone().text()).toBe(201);
    expect(await hooksOf("imported_one")).toEqual([]);
  });

  it("keeps optional modes discoverable and unselected in the creation catalog", async () => {
    const res = await admin.get("/api/plugins");
    const listed = ((await res.json()) as PluginLibraryResponse).groups.flatMap((g) => g.plugins);
    expect(listed.map((plugin) => plugin.name)).toEqual(expect.arrayContaining(["goal", "plan"]));
    expect(
      listed
        .filter((p) => p.defaultInstall === true)
        .map((p) => p.name)
        .sort(),
    ).toEqual([]);
  });
});
