/**
 * Copying an Agent: POST /api/projects/:p/agents with `copyFrom`.
 *
 * - A member copies an Agent of the Project: the copy has the source's current Agent State —
 *   files, name, description and version — and none of its vault, Sessions or API exposure.
 * - The copy is of the State as it is now, not of a stored snapshot of the same version, and
 *   nothing is written to the source: its snapshots/ and its files stay as they were.
 * - Explicit name and description win over the source's.
 * - `copyFrom` excludes a snapshot package (400 `copy_with_snapshot`) and seeding (400
 *   `copy_with_plugins`); a source that does not exist is 404 `agent_not_found` and a taken id
 *   409 `agent_exists`, and neither leaves an Agent behind.
 * - Someone outside the Project cannot copy its Agents.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentStateDir, snapshotsDir } from "@prismshadow/penguin-core";
import type {
  AgentCreateResponse,
  AgentsResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("copying an agent", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let agents: string;
  let source: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_a")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_b")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "outsider_c")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own, with a tuned default_agent as the source.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", {
        projectId: `owner_a-copy_${projects}`,
        name: "Copy project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    agents = `/api/projects/${projectId}/agents`;
    source = `${agents}/default_agent`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
    expect(
      (
        await owner.put(`${source}/config`, {
          config: { name: "Baseline", description: "The tuned baseline" },
        })
      ).status,
    ).toBe(200);
  });

  const stateFile = (agentId: string, name: string) =>
    path.join(agentStateDir(t.root, projectId, agentId), name);
  const listed = async () =>
    ((await (await owner.get(agents)).json()) as AgentsResponse).agents.map((a) => a.agentId);
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it("gives a member a copy of the source's State, without its vault, Sessions or API exposure", async () => {
    const config = stateFile("default_agent", "system_config.yaml");
    const yaml = await fs.readFile(config, "utf8");
    await fs.writeFile(config, yaml.replace(/^version: .*$/m, "version: 4"), "utf8");
    await fs.writeFile(stateFile("default_agent", "marker.txt"), "baseline", "utf8");
    expect(
      (await owner.put(`${source}/vault`, { entries: [{ key: "TOKEN", value: "secret-1" }] }))
        .status,
    ).toBe(200);

    const res = await member.post(agents, { agentId: "baseline_copy", copyFrom: "default_agent" });
    expect(res.status).toBe(201);
    const copy = ((await res.json()) as AgentCreateResponse).agent;
    expect(copy).toMatchObject({
      agentId: "baseline_copy",
      name: "Baseline",
      description: "The tuned baseline",
      version: 4,
      vaultKeyCount: 0,
      sessionCount: 0,
      apiEnabled: false,
    });
    await expect(fs.readFile(stateFile("baseline_copy", "marker.txt"), "utf8")).resolves.toBe(
      "baseline",
    );
    const vault = (await (
      await owner.get(`${agents}/baseline_copy/vault`)
    ).json()) as VaultResponse;
    expect(vault.entries).toEqual([]);
    expect(await listed()).toContain("baseline_copy");
  });

  it("copies the State as it is now, and writes nothing to the source", async () => {
    // A stored snapshot of the current version, then an edit under that same version: an
    // export would hand back the stored package, a copy must not.
    expect((await owner.get(`${source}/export`)).status).toBe(200);
    const snapshots = snapshotsDir(t.root, projectId, "default_agent");
    const before = (await fs.readdir(snapshots)).sort();
    await fs.writeFile(
      stateFile("default_agent", "marker.txt"),
      "edited after the snapshot",
      "utf8",
    );

    expect(
      (await owner.post(agents, { agentId: "fresh_copy", copyFrom: "default_agent" })).status,
    ).toBe(201);
    await expect(fs.readFile(stateFile("fresh_copy", "marker.txt"), "utf8")).resolves.toBe(
      "edited after the snapshot",
    );
    expect((await fs.readdir(snapshots)).sort()).toEqual(before);
    await expect(fs.readFile(stateFile("default_agent", "marker.txt"), "utf8")).resolves.toBe(
      "edited after the snapshot",
    );
    // The copy starts with no snapshots of its own, as a package seed does.
    await expect(fs.access(snapshotsDir(t.root, projectId, "fresh_copy"))).rejects.toThrow();
  });

  it("takes an explicit name and description over the source's", async () => {
    const res = await owner.post(agents, {
      agentId: "named_copy",
      name: "Method B",
      description: "Baseline for method B",
      copyFrom: "default_agent",
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as AgentCreateResponse).agent).toMatchObject({
      name: "Method B",
      description: "Baseline for method B",
    });
  });

  it("refuses a copy beside a snapshot package or seeding, and creates nothing", async () => {
    const archive = Buffer.from(await (await owner.get(`${source}/export`)).arrayBuffer());
    const withPackage = await owner.post(agents, {
      agentId: "mixed_copy",
      copyFrom: "default_agent",
      dataBase64: archive.toString("base64"),
    });
    expect(withPackage.status).toBe(400);
    expect(await errorCode(withPackage)).toBe("copy_with_snapshot");

    const withPlugins = await owner.post(agents, {
      agentId: "mixed_copy",
      copyFrom: "default_agent",
      plugins: ["goal"],
    });
    expect(withPlugins.status).toBe(400);
    expect(await errorCode(withPlugins)).toBe("copy_with_plugins");
    expect(await listed()).not.toContain("mixed_copy");
  });

  it("answers 404 for a source that does not exist and 409 for a taken id, leaving no Agent behind", async () => {
    const missing = await owner.post(agents, { agentId: "orphan_copy", copyFrom: "no_such_agent" });
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe("agent_not_found");
    const invalid = await owner.post(agents, { agentId: "orphan_copy", copyFrom: "../escape" });
    expect(invalid.status).toBe(404);
    expect(await listed()).not.toContain("orphan_copy");
    // The id is free: nothing was left on disk under it.
    expect((await owner.post(agents, { agentId: "orphan_copy" })).status).toBe(201);

    const taken = await owner.post(agents, { agentId: "orphan_copy", copyFrom: "default_agent" });
    expect(taken.status).toBe(409);
    expect(await errorCode(taken)).toBe("agent_exists");
  });

  it("refuses someone outside the Project", async () => {
    const res = await outsider.post(agents, { agentId: "stolen_copy", copyFrom: "default_agent" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await listed()).not.toContain("stolen_copy");
  });
});
