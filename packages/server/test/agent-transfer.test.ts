/**
 * Agent State export/import integration tests: export auto-packages (excluding .vault.toml), any member can export, only the owner can
 * import, importing the same or an older version requires confirmation (409 -> succeeds
 * after confirm), import replaces agent_state while keeping the current vault, invalid
 * packages return 400, and snapshots are written to snapshots/v<N>.tar.gz.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentStateDir, snapshotsDir } from "@prismshadow/penguin-core";
import type {
  AgentImportResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent export/import", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-snap", name: "Snapshot project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/agents/default_agent`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("reimport same version: confirm required, agent_state replaced, vault kept", async () => {
    // First set a vault key (must be preserved after import).
    expect(
      (await owner.put(`${base}/vault`, { entries: [{ key: "TOKEN", value: "secret-1" }] })).status,
    ).toBe(200);

    // Members can export; the snapshot is auto-packaged and written to snapshots/v1.tar.gz.
    const exportRes = await member.get(`${base}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toBe("application/gzip");
    expect(exportRes.headers.get("content-disposition")).toContain("default_agent-v1.tar.gz");
    const archive = Buffer.from(await exportRes.arrayBuffer());
    expect(archive.byteLength).toBeGreaterThan(0);
    const snapFile = path.join(snapshotsDir(t.root, projectId, "default_agent"), "v1.tar.gz");
    await expect(fs.access(snapFile)).resolves.toBeUndefined();
    // The snapshot excludes the vault (rough gzip check: the archive contents don't contain the plaintext value).
    expect(archive.includes(Buffer.from("secret-1"))).toBe(false);

    // Leave a change marker in agent_state after exporting.
    const marker = path.join(agentStateDir(t.root, projectId, "default_agent"), "marker.txt");
    await fs.writeFile(marker, "dirty", "utf8");

    // Importing the same version (v1): owner only; without confirm -> 409, with confirm it succeeds and replaces agent_state.
    const body = { dataBase64: archive.toString("base64") };
    expect((await member.post(`${base}/import`, body)).status).toBe(403);
    expect((await owner.post(`${base}/import`, body)).status).toBe(409);
    const imported = await owner.post(`${base}/import`, { ...body, confirm: true });
    expect(imported.status).toBe(200);
    expect(((await imported.json()) as AgentImportResponse).version).toBe(1);
    await expect(fs.access(marker)).rejects.toThrow(); // The marker has been overwritten.

    // The current vault is preserved (not from the package, and not cleared either).
    const vault = (await (await owner.get(`${base}/vault`)).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
  });

  it("newer-version package imports directly, persists version; invalid package 400", async () => {
    // Bump the current agent_state's version to 3, then export to get the v3 package.
    const configPath = path.join(
      agentStateDir(t.root, projectId, "default_agent"),
      "system_config.yaml",
    );
    const yaml = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, yaml.replace(/^version: .*$/m, "version: 3"), "utf8");
    const archive = Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer());

    // Roll version back to 1: the v3 package is newer than current, so it imports directly without confirmation.
    await fs.writeFile(configPath, yaml.replace(/^version: .*$/m, "version: 1"), "utf8");
    const res = await owner.post(`${base}/import`, { dataBase64: archive.toString("base64") });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentImportResponse).version).toBe(3);

    expect(
      (await owner.post(`${base}/import`, { dataBase64: Buffer.from("junk").toString("base64") }))
        .status,
    ).toBe(400);
  });

  it("a .vault.toml in the package is ignored; the current vault survives import", async () => {
    expect(
      (await owner.put(`${base}/vault`, { entries: [{ key: "TOKEN", value: "current" }] })).status,
    ).toBe(200);

    // Manually craft a v9 package containing a forged agent_state/.vault.toml.
    const src = path.join(t.root, "crafted");
    await fs.mkdir(path.join(src, "agent_state"), { recursive: true });
    await fs.writeFile(
      path.join(src, "agent_state", "system_config.yaml"),
      'system_prompt: "hi"\nversion: 9\n',
      "utf8",
    );
    await fs.writeFile(path.join(src, "agent_state", ".vault.toml"), 'EVIL = "1"\n', "utf8");
    const crafted = path.join(t.root, "crafted.tar.gz");
    await tar.create({ gzip: true, cwd: src, file: crafted }, ["agent_state"]);

    // v9 is newer than the current v1, so it imports directly without confirmation.
    const res = await owner.post(`${base}/import`, {
      dataBase64: (await fs.readFile(crafted)).toString("base64"),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentImportResponse).version).toBe(9);

    const vault = (await (await owner.get(`${base}/vault`)).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
  });
});
