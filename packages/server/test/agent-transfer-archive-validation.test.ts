/**
 * Agent State archives through the authenticated HTTP API and real filesystem.
 *
 * - Given a package with a missing State, non-file config, or non-relocatable config links,
 *   when it is imported, it is rejected before replacing the current State and vault;
 *   a subsequent valid import and export still work.
 * - Given a package with an internal config symlink or hardlink and an internal skill symlink,
 *   when it seeds an Agent, both files remain usable after staging is removed.
 * - Given a long config link chain, when the filesystem cannot read it, import preserves the
 *   current State; a readable chain remains usable through import and export.
 * - Given a committed import whose old State cannot be removed,
 *   when cleanup fails, the response still reports the committed version and later transfers work.
 */
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { agentDir, agentStateDir } from "@prismshadow/penguin-core";
import { apiClient, canCreateSymlink, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const permissionsEnforced = process.platform !== "win32" && process.getuid?.() !== 0;
const linksSupported = canCreateSymlink();

describe("Agent State archive boundaries", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const projectId = "default_project";
  const vault = 'TOKEN = "preserved"\n';
  const config = 'system_prompt: "candidate"\nversion: 2\n';
  let validBody: { dataBase64: string };
  const createdAgents: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const source = path.join(t.root, "valid-archive");
    await fs.mkdir(path.join(source, "agent_state"), { recursive: true });
    await fs.writeFile(path.join(source, "agent_state", "system_config.yaml"), config);
    await fs.writeFile(path.join(source, "agent_state", "lesson.md"), "Retained lesson\n");
    const file = path.join(t.root, "valid.tar.gz");
    await tar.create({ gzip: true, cwd: source, file }, ["agent_state"]);
    validBody = { dataBase64: (await fs.readFile(file)).toString("base64") };
  });

  afterAll(async () => {
    await t.cleanup();
  });

  afterEach(async () => {
    for (const agentId of createdAgents.splice(0)) {
      await t.deps.agentService.deleteAgent(projectId, agentId);
    }
  });

  async function createAgent(agentId: string): Promise<string> {
    const response = await admin.post(`/api/projects/${projectId}/agents`, { agentId });
    if (response.status !== 201) throw new Error(`Agent creation failed: ${await response.text()}`);
    createdAgents.push(agentId);
    return `/api/projects/${projectId}/agents/${agentId}`;
  }

  it
    .skipIf(!linksSupported)
    .each([
      "state_root",
      "config_sibling",
      "config_chain",
      "config_absolute",
      "config_cycle",
      "config_directory",
      "missing_state",
    ] as const)("%s cannot replace the current State with an unusable package", async (kind) => {
    const agentId = `archive_${kind}`;
    const base = await createAgent(agentId);
    const state = agentStateDir(t.root, projectId, agentId);
    const original = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
    await fs.writeFile(path.join(state, ".vault.toml"), vault);
    const source = await fs.mkdtemp(path.join(t.root, `${kind}-`));
    let entries: string[];
    if (kind === "state_root") {
      await fs.mkdir(path.join(source, "payload"));
      await fs.writeFile(path.join(source, "payload", "system_config.yaml"), config);
      await fs.symlink("payload", path.join(source, "agent_state"), "dir");
      entries = ["payload", "agent_state"];
    } else if (kind === "config_sibling") {
      await fs.mkdir(path.join(source, "agent_state"));
      await fs.writeFile(path.join(source, "config.yaml"), config);
      await fs.symlink("../config.yaml", path.join(source, "agent_state", "system_config.yaml"));
      entries = ["config.yaml", "agent_state"];
    } else if (kind === "config_chain") {
      await fs.mkdir(path.join(source, "agent_state", "settings"), { recursive: true });
      await fs.writeFile(path.join(source, "agent_state", "settings", "config.yaml"), config);
      await fs.symlink("agent_state/settings", path.join(source, "alias"), "dir");
      await fs.symlink(
        "../alias/config.yaml",
        path.join(source, "agent_state", "system_config.yaml"),
      );
      // The config link precedes its alias, so extraction accepts the chain; its final
      // realpath lies inside State while its resolution still depends on the sibling.
      entries = ["agent_state/settings/config.yaml", "agent_state/system_config.yaml", "alias"];
    } else if (kind === "config_absolute") {
      await fs.mkdir(path.join(source, "agent_state"));
      await fs.writeFile(path.join(source, "config.yaml"), config);
      await fs.symlink(
        path.join(source, "config.yaml"),
        path.join(source, "agent_state", "system_config.yaml"),
      );
      entries = ["agent_state"];
    } else if (kind === "config_cycle") {
      await fs.mkdir(path.join(source, "agent_state"));
      await fs.symlink(
        "system_config.yaml",
        path.join(source, "agent_state", "system_config.yaml"),
      );
      entries = ["agent_state"];
    } else if (kind === "config_directory") {
      await fs.mkdir(path.join(source, "agent_state", "system_config.yaml"), { recursive: true });
      entries = ["agent_state"];
    } else {
      await fs.writeFile(path.join(source, "README.md"), "No Agent State in this package\n");
      entries = ["README.md"];
    }
    const archive = path.join(t.root, `${kind}.tar.gz`);
    await tar.create({ gzip: true, cwd: source, file: archive }, entries);
    const rejected = await admin.post(`${base}/import`, {
      dataBase64: (await fs.readFile(archive)).toString("base64"),
    });
    if (rejected.status !== 400) {
      throw new Error(`Non-relocatable State was accepted: ${rejected.status}`);
    }
    if (
      (await fs.readFile(path.join(state, "system_config.yaml"), "utf8")) !== original ||
      (await fs.readFile(path.join(state, ".vault.toml"), "utf8")) !== vault
    ) {
      throw new Error("Rejected archive changed the current State or vault");
    }
    const imported = await admin.post(`${base}/import`, validBody);
    const exported = await admin.get(`${base}/export`);
    if (
      imported.status !== 200 ||
      exported.status !== 200 ||
      !exported.headers.get("content-disposition")?.includes("-v2.tar.gz") ||
      (await fs.readFile(path.join(state, "lesson.md"), "utf8")) !== "Retained lesson\n"
    ) {
      throw new Error("Rejected archive prevented a subsequent valid transfer");
    }
  });

  it.skipIf(!linksSupported).each(["hardlink", "symlink", "directory_link"] as const)(
    "%s config and internal skill links survive archive seeding",
    async (kind) => {
      const source = await fs.mkdtemp(path.join(t.root, "linked-archive-"));
      const state = path.join(source, "agent_state");
      await fs.mkdir(path.join(state, "settings"), { recursive: true });
      await fs.writeFile(path.join(state, "settings", "config.yaml"), config);
      if (kind === "hardlink") {
        await fs.link(
          path.join(state, "settings", "config.yaml"),
          path.join(state, "system_config.yaml"),
        );
      } else if (kind === "symlink") {
        await fs.symlink("settings/config.yaml", path.join(state, "system_config.yaml"));
      } else {
        await fs.mkdir(path.join(state, "settings", "nested"));
        await fs.symlink("settings/nested", path.join(state, "alias"), "dir");
        await fs.symlink("alias/../config.yaml", path.join(state, "system_config.yaml"));
      }
      await fs.mkdir(path.join(state, "guidance"));
      await fs.writeFile(path.join(state, "guidance", "SKILL.md"), "# Retained skill\n");
      await fs.mkdir(path.join(state, "skills"));
      await fs.symlink("../guidance", path.join(state, "skills", "linked"), "dir");
      const file = path.join(t.root, "linked.tar.gz");
      const entries =
        kind === "directory_link"
          ? [
              "agent_state/settings",
              "agent_state/system_config.yaml",
              "agent_state/alias",
              "agent_state/guidance",
              "agent_state/skills",
            ]
          : ["agent_state"];
      await tar.create({ gzip: true, cwd: source, file }, entries);
      const response = await admin.post(`/api/projects/${projectId}/agents`, {
        agentId: "linked_archive_consumer",
        dataBase64: (await fs.readFile(file)).toString("base64"),
      });
      if (response.status !== 201)
        throw new Error(`Linked package was rejected: ${await response.text()}`);
      createdAgents.push("linked_archive_consumer");
      const imported = agentStateDir(t.root, projectId, "linked_archive_consumer");
      if (
        (await fs.readFile(path.join(imported, "system_config.yaml"), "utf8")) !== config ||
        (await fs.readFile(path.join(imported, "skills", "linked", "SKILL.md"), "utf8")) !==
          "# Retained skill\n"
      ) {
        throw new Error("Moving the imported State broke its retained files");
      }
    },
  );

  it.skipIf(!linksSupported)(
    "long config links respect the filesystem's readable State boundary",
    async () => {
      const agentId = "config_long_chain";
      const base = await createAgent(agentId);
      const state = agentStateDir(t.root, projectId, agentId);
      const original = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
      await fs.writeFile(path.join(state, ".vault.toml"), vault);
      const source = await fs.mkdtemp(path.join(t.root, "long-config-chain-"));
      const incoming = path.join(source, "agent_state");
      await fs.mkdir(incoming);
      await fs.writeFile(path.join(incoming, "config.yaml"), config);
      const links = [
        "system_config.yaml",
        ...Array.from({ length: 31 }, (_, index) => `config-link-${index}`),
      ];
      for (const [index, name] of links.entries()) {
        await fs.symlink(links[index + 1] ?? "config.yaml", path.join(incoming, name));
      }
      let readable = true;
      try {
        if ((await fs.readFile(path.join(incoming, "system_config.yaml"), "utf8")) !== config) {
          throw new Error("The long configuration chain read unexpected content");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ELOOP") throw error;
        readable = false;
      }
      const file = path.join(t.root, "long-config-chain.tar.gz");
      await tar.create({ gzip: true, cwd: source, file }, [
        ...links.map((name) => `agent_state/${name}`),
        "agent_state/config.yaml",
      ]);
      const response = await admin.post(`${base}/import`, {
        dataBase64: (await fs.readFile(file)).toString("base64"),
      });
      if (readable) {
        if (response.status !== 200)
          throw new Error(`Readable config chain was rejected: ${await response.text()}`);
        const exported = await admin.get(`${base}/export`);
        if (
          exported.status !== 200 ||
          (await fs.readFile(path.join(state, "system_config.yaml"), "utf8")) !== config
        ) {
          throw new Error("The imported long configuration chain cannot be consumed");
        }
      } else if (
        response.status !== 400 ||
        (await fs.readFile(path.join(state, "system_config.yaml"), "utf8")) !== original
      ) {
        throw new Error(`Unreadable config chain replaced the current State: ${response.status}`);
      }
      if ((await fs.readFile(path.join(state, ".vault.toml"), "utf8")) !== vault) {
        throw new Error("The configuration chain transfer changed the current vault");
      }
    },
  );

  it.skipIf(!permissionsEnforced)(
    "cleanup failure preserves the committed import result",
    async () => {
      const agentId = "cleanup_commit";
      const base = await createAgent(agentId);
      const state = agentStateDir(t.root, projectId, agentId);
      const protectedDir = path.join(state, "protected");
      await fs.mkdir(protectedDir);
      await fs.writeFile(path.join(protectedDir, "old.txt"), "Original state\n");
      const vaultPath = path.join(state, ".vault.toml");
      execFileSync("mkfifo", [vaultPath]);
      const response = Promise.resolve(admin.post(`${base}/import`, validBody));
      const opening = fs.open(vaultPath, "w");
      const reached = await Promise.race([
        opening.then((writer) => ({ writer })),
        response.then((finished) => ({ finished })),
      ]);
      if ("finished" in reached) {
        const reader = await fs.open(vaultPath, constants.O_RDWR | constants.O_NONBLOCK);
        await (await opening).close();
        await reader.close();
        throw new Error(
          `Import finished before reading its vault: ${await reached.finished.text()}`,
        );
      }
      const writer = reached.writer;
      let closed = false;
      let staging: string | undefined;
      try {
        await fs.unlink(vaultPath);
        await fs.writeFile(vaultPath, vault, { mode: 0o600 });
        const baseDir = agentDir(t.root, projectId, agentId);
        const name = (await fs.readdir(baseDir)).find((entry) => entry.startsWith(".import-"));
        if (name === undefined) throw new Error("The pending import has no staging directory");
        staging = path.join(baseDir, name);
        await fs.chmod(protectedDir, 0o555);
        await writer.writeFile(vault);
        await writer.close();
        closed = true;
        const committed = await response;
        if (committed.status !== 200) {
          throw new Error(`Committed import reported failure: ${committed.status}`);
        }
        if (
          (await fs.readFile(path.join(state, "system_config.yaml"), "utf8")) !== config ||
          (await fs.readFile(vaultPath, "utf8")) !== vault
        ) {
          throw new Error("Cleanup failure changed the committed State or vault");
        }
        const repeated = await admin.post(`${base}/import`, validBody);
        const exported = await admin.get(`${base}/export`);
        if (repeated.status !== 409 || exported.status !== 200) {
          throw new Error("Cleanup failure did not release the committed version's transfer queue");
        }
      } finally {
        if (!closed) await writer.close();
        await response;
        if (staging !== undefined) {
          await fs
            .chmod(path.join(staging, "replaced-agent_state", "protected"), 0o755)
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
          await fs.rm(staging, { recursive: true, force: true });
        }
      }
    },
  );
});
