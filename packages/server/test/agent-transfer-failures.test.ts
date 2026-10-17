/**
 * Agent State transfers through real filesystem failures and platform replacement.
 *
 * - Given an unreadable State directory, when snapshot packing fails, no partial archive
 *   remains; restoring access lets the next export complete.
 * - Given an import whose replacement loses filesystem permission, rollback restores the
 *   original State and vault, and repairing access lets the same package be retried.
 * - Given an import whose replacement and rollback both lose filesystem permission,
 *   its reported recovery location holds the original State and vault for a successful retry.
 * - Given an import waiting for its vault, when plugin configuration reassembles the server,
 *   another import and an export wait for its committed version while another Agent progresses;
 *   the exported package creates an Agent with that version.
 *
 * FIFO barriers require POSIX; macOS ACLs separately control creating and removing a
 * directory entry, so the rollback scenario uses that platform's real permission checks.
 */
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import { agentDir, agentStateDir, snapshotsDir } from "@prismshadow/penguin-core";
import type { AgentCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const permissionsEnforced = process.platform !== "win32" && process.getuid?.() !== 0;

describe("Agent State transfer recovery", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const projectId = "default_project";
  const originalVault = 'TOKEN = "preserved"\n';
  let body: { dataBase64: string };
  const createdAgents: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const source = path.join(t.root, "candidate");
    await fs.mkdir(path.join(source, "agent_state"), { recursive: true });
    await fs.writeFile(
      path.join(source, "agent_state", "system_config.yaml"),
      'system_prompt: "candidate"\nversion: 2\n',
    );
    const archive = path.join(t.root, "candidate.tar.gz");
    await tar.create({ gzip: true, cwd: source, file: archive }, ["agent_state"]);
    body = { dataBase64: (await fs.readFile(archive)).toString("base64") };
  });

  afterAll(async () => {
    await t.cleanup();
  });

  afterEach(async () => {
    for (const agentId of createdAgents.splice(0)) {
      const response = await admin.delete(`/api/projects/${projectId}/agents/${agentId}`);
      if (!response.ok) throw new Error(`Agent cleanup failed: ${await response.text()}`);
    }
  });

  async function createAgent(agentId: string): Promise<string> {
    const response = await admin.post(`/api/projects/${projectId}/agents`, { agentId });
    if (response.status !== 201) throw new Error(`Agent creation failed: ${await response.text()}`);
    createdAgents.push(agentId);
    return `/api/projects/${projectId}/agents/${agentId}`;
  }

  async function holdImportAtVault(agentId: string, base: string) {
    const vault = path.join(agentStateDir(t.root, projectId, agentId), ".vault.toml");
    execFileSync("mkfifo", [vault]);
    const response = Promise.resolve(admin.post(`${base}/import`, body));
    const opening = fs.open(vault, "w");
    const reached = await Promise.race([
      opening.then((writer) => ({ writer })),
      response.then((finished) => ({ finished })),
    ]);
    if ("finished" in reached) {
      const reader = await fs.open(vault, constants.O_RDWR | constants.O_NONBLOCK);
      await (await opening).close();
      await reader.close();
      throw new Error(`Import finished before reading its vault: ${await reached.finished.text()}`);
    }
    const writer = reached.writer;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      try {
        await writer.writeFile(originalVault);
      } finally {
        await writer.close();
      }
    };
    try {
      // The open read keeps the FIFO alive; subsequent requests see the real vault file.
      await fs.unlink(vault);
      await fs.writeFile(vault, originalVault, { mode: 0o600 });
    } catch (error) {
      await release();
      await response;
      throw error;
    }
    return { response, release, vault };
  }

  it.skipIf(!permissionsEnforced)(
    "a failed snapshot leaves no partial archive and exports recover",
    async () => {
      const agentId = "packing_failure";
      const base = await createAgent(agentId);
      const blocked = path.join(agentStateDir(t.root, projectId, agentId), "unreadable");
      await fs.mkdir(blocked);
      await fs.writeFile(path.join(blocked, "lesson.md"), "Keep this lesson\n");
      await fs.chmod(blocked, 0);
      try {
        const failed = await admin.get(`${base}/export`);
        if (failed.status !== 500)
          throw new Error(`Unreadable state was exported: ${failed.status}`);
        const files = await fs.readdir(snapshotsDir(t.root, projectId, agentId));
        if (files.length !== 0) throw new Error(`Failed packing left snapshot files: ${files}`);
      } finally {
        await fs.chmod(blocked, 0o700);
      }
      const recovered = await admin.get(`${base}/export`);
      if (recovered.status !== 200) throw new Error(`Export did not recover: ${recovered.status}`);
      const imported = await admin.post(`/api/projects/${projectId}/agents`, {
        agentId: "packing_consumer",
        dataBase64: Buffer.from(await recovered.arrayBuffer()).toString("base64"),
      });
      if (imported.status !== 201)
        throw new Error(`Recovered snapshot was invalid: ${await imported.text()}`);
      createdAgents.push("packing_consumer");
      const lesson = path.join(
        agentStateDir(t.root, projectId, "packing_consumer"),
        "unreadable",
        "lesson.md",
      );
      if ((await fs.readFile(lesson, "utf8")) !== "Keep this lesson\n") {
        throw new Error("The recovered snapshot lost the previously unreadable lesson");
      }
    },
  );

  it.skipIf(!permissionsEnforced)(
    "a failed replacement restores the original State and vault before a retry",
    async () => {
      const agentId = "replacement_failure";
      const base = await createAgent(agentId);
      const state = agentStateDir(t.root, projectId, agentId);
      const original = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
      const held = await holdImportAtVault(agentId, base);
      let staging: string | undefined;
      let protectedParent: string | undefined;
      try {
        const agent = agentDir(t.root, projectId, agentId);
        const staged = (await fs.readdir(agent)).filter((name) => name.startsWith(".import-"));
        const name = staged[0];
        if (staged.length !== 1 || name === undefined)
          throw new Error("Import did not stage one package");
        staging = path.join(agent, name);
        protectedParent = path.join(staging, "extracted");
        await fs.chmod(protectedParent, 0o555);
        await held.release();
        const failed = await held.response;
        if (failed.status !== 500)
          throw new Error(`Blocked directory replacement succeeded: ${failed.status}`);
        if (
          (await fs.readFile(path.join(state, "system_config.yaml"), "utf8")) !== original ||
          (await fs.readFile(held.vault, "utf8")) !== originalVault
        ) {
          throw new Error("Failed replacement did not restore the original State and vault");
        }
        await fs.chmod(protectedParent, 0o755);
        protectedParent = undefined;
        const retried = await admin.post(`${base}/import`, body);
        if (retried.status !== 200 || (await fs.readFile(held.vault, "utf8")) !== originalVault) {
          throw new Error("Repairing replacement access did not allow a vault-preserving retry");
        }
      } finally {
        await held.release();
        await held.response;
        if (protectedParent !== undefined) await fs.chmod(protectedParent, 0o755);
        if (staging !== undefined) await fs.rm(staging, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "darwin" || !permissionsEnforced)(
    "failed replacement and rollback report a recoverable State and vault",
    async () => {
      const agentId = "rollback_failure";
      const base = await createAgent(agentId);
      const state = agentStateDir(t.root, projectId, agentId);
      const original = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
      const held = await holdImportAtVault(agentId, base);
      const errors = vi.spyOn(console, "error");
      let staging: string | undefined;
      let aclApplied = false;
      let protectedParent: string | undefined;
      try {
        const agent = agentDir(t.root, projectId, agentId);
        const staged = (await fs.readdir(agent)).filter((name) => name.startsWith(".import-"));
        const name = staged[0];
        if (staged.length !== 1 || name === undefined)
          throw new Error("Import did not stage one package");
        staging = path.join(agent, name);
        protectedParent = path.join(staging, "extracted");
        await fs.chmod(protectedParent, 0o555);
        execFileSync("chmod", ["+a", "everyone deny delete_child", staging]);
        aclApplied = true;
        await held.release();
        const failed = await held.response;
        if (failed.status !== 500)
          throw new Error(`Blocked directory replacement succeeded: ${failed.status}`);
        const message = errors.mock.calls
          .flatMap((args) => args.map(String))
          .find((line) => line.includes("Recovery copy: "));
        const recovery = message?.split("Recovery copy: ")[1]?.split("\n")[0];
        if (recovery === undefined)
          throw new Error("Failed rollback did not report a recovery location");
        if (
          (await fs.readFile(path.join(recovery, "system_config.yaml"), "utf8")) !== original ||
          (await fs.readFile(path.join(recovery, ".vault.toml"), "utf8")) !== originalVault
        ) {
          throw new Error("Failed rollback discarded the original State or vault");
        }
        execFileSync("chmod", ["-N", staging]);
        aclApplied = false;
        await fs.chmod(protectedParent, 0o755);
        protectedParent = undefined;
        await fs.rename(recovery, state);
        const retried = await admin.post(`${base}/import`, body);
        if (retried.status !== 200 || (await fs.readFile(held.vault, "utf8")) !== originalVault) {
          throw new Error("Restoring the recovery copy did not allow a vault-preserving retry");
        }
      } finally {
        errors.mockRestore();
        await held.release();
        await held.response;
        if (aclApplied && staging !== undefined) execFileSync("chmod", ["-N", staging]);
        if (protectedParent !== undefined) await fs.chmod(protectedParent, 0o755);
        if (staging !== undefined) await fs.rm(staging, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "plugin reassembly orders imports and exports while another Agent progresses",
    async () => {
      const agentId = "reassembly_transfer";
      const base = await createAgent(agentId);
      const peer = await createAgent("reassembly_peer");
      const held = await holdImportAtVault(agentId, base);
      let second: Promise<Response> | undefined;
      let exported: Promise<Response> | undefined;
      try {
        // Removing an on-disk plugin declaration reassembles the real platform without
        // installing a package or contacting the network.
        await t.deps.projectConfigService.setPluginTables(projectId, {
          all: { "@transfer/unused": {} },
          machines: {},
        });
        const changed = await admin.put(`/api/projects/${projectId}/plugins/installed`, {
          plugins: [],
        });
        if (changed.status !== 200)
          throw new Error(`Plugin change failed: ${await changed.text()}`);
        second = Promise.resolve(admin.post(`${base}/import`, body));
        exported = Promise.resolve(admin.get(`${base}/export`));
        const independent = await admin.post(`${peer}/import`, body);
        if (independent.status !== 200)
          throw new Error(`Another Agent was blocked: ${await independent.text()}`);
        const peerExport = await admin.get(`${peer}/export`);
        if (
          peerExport.status !== 200 ||
          !peerExport.headers.get("content-disposition")?.includes("-v2.tar.gz")
        ) {
          throw new Error("The independent Agent did not export its committed version");
        }
        await held.release();
        const [first, queued, snapshot] = await Promise.all([held.response, second, exported]);
        if (first.status !== 200 || queued.status !== 409) {
          throw new Error(
            `Reassembly bypassed version confirmation: ${first.status},${queued.status}`,
          );
        }
        if ((await fs.readFile(held.vault, "utf8")) !== originalVault) {
          throw new Error("Reassembly changed the imported Agent's vault");
        }
        if (
          snapshot.status !== 200 ||
          !snapshot.headers.get("content-disposition")?.includes("-v2.tar.gz")
        ) {
          throw new Error(`Queued export did not serve the committed version: ${snapshot.status}`);
        }
        const imported = await admin.post(`/api/projects/${projectId}/agents`, {
          agentId: "reassembly_consumer",
          dataBase64: Buffer.from(await snapshot.arrayBuffer()).toString("base64"),
        });
        if (imported.status !== 201)
          throw new Error(`Queued export could not seed an Agent: ${await imported.text()}`);
        createdAgents.push("reassembly_consumer");
        const copied = (await imported.json()) as AgentCreateResponse;
        if (copied.agent.version !== 2) {
          throw new Error(`Queued export contained a stale version: ${copied.agent.version}`);
        }
      } finally {
        await held.release();
        await held.response;
        if (second !== undefined) await second;
        if (exported !== undefined) await exported;
      }
    },
  );
});
