/**
 * Agent State transfers through the authenticated HTTP API.
 *
 * - Given two unconfirmed imports of the same newer version, when both arrive together,
 *   one succeeds and the other needs confirmation; the original snapshot and vault survive.
 * - Given two filesystem aliases for one Agent, when both import the same newer version,
 *   they share one transfer queue and the second import requires confirmation.
 * - Given an absent Agent followed by creation and overlapping malformed and valid imports,
 *   missing transfers return 404 and failures release the queue for committed exports.
 * - Given a vault path that cannot be read as a file, when a package is imported,
 *   the current state survives; repairing the vault lets the same package be retried.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { agentDir, agentStateDir, snapshotsDir } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("concurrent Agent State transfers", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  const projectId = "transfer_owner-transfers";
  let archive: Buffer;
  const createdAgents: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    const user = await provisionUser(t.app, "transfer_owner");
    owner = apiClient(t.app, user.cookie);
    const project = await owner.post("/api/projects", { projectId, name: "Transfers" });
    if (project.status !== 201) throw new Error(`Project creation failed: ${await project.text()}`);
    const source = path.join(t.root, "candidate");
    await fs.mkdir(path.join(source, "agent_state"), { recursive: true });
    await fs.writeFile(
      path.join(source, "agent_state", "system_config.yaml"),
      'system_prompt: "candidate"\nversion: 2\n',
    );
    await fs.writeFile(path.join(source, "agent_state", "lesson.md"), "Retained lesson\n");
    const file = path.join(t.root, "candidate.tar.gz");
    await tar.create({ gzip: true, cwd: source, file }, ["agent_state"]);
    archive = await fs.readFile(file);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  afterEach(async () => {
    for (const agentId of createdAgents.splice(0)) {
      const res = await owner.delete(`/api/projects/${projectId}/agents/${agentId}`);
      if (!res.ok) throw new Error(`Agent cleanup failed: ${await res.text()}`);
    }
    await fs.rm(path.join(t.root, "prior"), { recursive: true, force: true });
  });

  async function createAgent(agentId: string): Promise<string> {
    const res = await owner.post(`/api/projects/${projectId}/agents`, { agentId });
    if (res.status !== 201) throw new Error(`Agent creation failed: ${await res.text()}`);
    createdAgents.push(agentId);
    return `/api/projects/${projectId}/agents/${agentId}`;
  }

  it("concurrent imports of v2 commit once and require confirmation for the second", async () => {
    const agentId = "same_version";
    const base = await createAgent(agentId);
    const state = agentStateDir(t.root, projectId, agentId);
    const original = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
    const vault = 'TOKEN = "preserved"\n';
    await fs.writeFile(path.join(state, ".vault.toml"), vault);
    const body = { dataBase64: archive.toString("base64") };
    const responses = await Promise.all([
      owner.post(`${base}/import`, body),
      owner.post(`${base}/import`, body),
    ]);
    const statuses = responses.map((r) => r.status).sort();
    if (statuses.join(",") !== "200,409") {
      throw new Error(`Expected one commit and one conflict, received ${statuses}`);
    }
    if ((await fs.readFile(path.join(state, ".vault.toml"), "utf8")) !== vault) {
      throw new Error("Concurrent import changed the current vault");
    }
    const prior = path.join(t.root, "prior");
    await fs.mkdir(prior);
    await tar.extract({
      file: path.join(snapshotsDir(t.root, projectId, agentId), "v1.tar.gz"),
      cwd: prior,
    });
    if (
      (await fs.readFile(path.join(prior, "agent_state", "system_config.yaml"), "utf8")) !==
      original
    ) {
      throw new Error("The pre-import snapshot no longer contains the original state");
    }
    if ((await fs.readFile(path.join(state, "lesson.md"), "utf8")) !== "Retained lesson\n") {
      throw new Error("The successful import did not retain the candidate lesson");
    }
  });

  it("filesystem aliases share the same version check and transfer queue", async () => {
    const agentId = "alias_target";
    const base = await createAgent(agentId);
    const aliasId = "alias_link";
    const alias = agentDir(t.root, projectId, aliasId);
    await fs.symlink(agentDir(t.root, projectId, agentId), alias, "junction");
    try {
      const body = { dataBase64: archive.toString("base64") };
      const responses = await Promise.all([
        owner.post(`${base}/import`, body),
        owner.post(`/api/projects/${projectId}/agents/${aliasId}/import`, body),
      ]);
      const statuses = responses.map((res) => res.status).sort();
      if (statuses.join(",") !== "200,409") {
        throw new Error(`Aliased imports bypassed version confirmation: ${statuses}`);
      }
    } finally {
      await fs.rm(alias, { recursive: true, force: true });
    }
  });

  it("a failed import releases queued transfers and exports the committed version", async () => {
    const agentId = "retry_transfer";
    const missingBase = `/api/projects/${projectId}/agents/${agentId}`;
    const missing = await Promise.all([
      owner.post(`${missingBase}/import`, { dataBase64: archive.toString("base64") }),
      owner.get(`${missingBase}/export`),
    ]);
    if (missing.some((res) => res.status !== 404)) {
      throw new Error(
        `Missing Agent transfers must return 404: ${missing.map((res) => res.status)}`,
      );
    }
    const base = await createAgent(agentId);
    const results = await Promise.all([
      owner.post(`${base}/import`, { dataBase64: Buffer.from("invalid").toString("base64") }),
      owner.post(`${base}/import`, { dataBase64: archive.toString("base64") }),
    ]);
    if (results[0].status !== 400 || results[1].status !== 200) {
      throw new Error(`Failed import blocked recovery: ${results.map((r) => r.status)}`);
    }
    const exports = await Promise.all([owner.get(`${base}/export`), owner.get(`${base}/export`)]);
    for (const res of exports) {
      if (res.status !== 200 || !res.headers.get("content-disposition")?.includes("-v2.tar.gz")) {
        throw new Error(`Export did not serve v2: ${res.status}`);
      }
    }
    const bytes = await Promise.all([exports[0].arrayBuffer(), exports[1].arrayBuffer()]);
    const archiveBytes = Buffer.from(bytes[0]);
    if (!archiveBytes.equals(Buffer.from(bytes[1])))
      throw new Error("Concurrent exports changed a version snapshot");
    const imported = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "export_consumer",
      dataBase64: archiveBytes.toString("base64"),
    });
    if (imported.status !== 201)
      throw new Error(`Export could not seed an Agent: ${await imported.text()}`);
    createdAgents.push("export_consumer");
    const copied = agentStateDir(t.root, projectId, "export_consumer");
    if ((await fs.readFile(path.join(copied, "lesson.md"), "utf8")) !== "Retained lesson\n") {
      throw new Error("The exported candidate lost its lesson when imported again");
    }
  });

  it("an unreadable vault stops replacement and a repaired vault survives the retry", async () => {
    const agentId = "vault_recovery";
    const base = await createAgent(agentId);
    const state = agentStateDir(t.root, projectId, agentId);
    const config = path.join(state, "system_config.yaml");
    const original = await fs.readFile(config, "utf8");
    const vault = path.join(state, ".vault.toml");
    await fs.mkdir(vault);
    await fs.writeFile(path.join(vault, "recoverable"), "original secret");
    const body = { dataBase64: archive.toString("base64") };
    const rejected = await owner.post(`${base}/import`, body);
    if (rejected.status !== 500)
      throw new Error(`Unreadable vault was accepted: ${rejected.status}`);
    if (
      (await fs.readFile(config, "utf8")) !== original ||
      (await fs.readFile(path.join(vault, "recoverable"), "utf8")) !== "original secret"
    ) {
      throw new Error("A failed import changed the original state or vault");
    }
    await fs.rm(vault, { recursive: true });
    await fs.writeFile(vault, 'TOKEN = "recovered"\n');
    const retried = await owner.post(`${base}/import`, body);
    if (retried.status !== 200 || (await fs.readFile(vault, "utf8")) !== 'TOKEN = "recovered"\n') {
      throw new Error("Repairing the vault did not allow the same import to recover");
    }
  });
});
