/**
 * Agent State imports that fail part-way, and the links a package may carry.
 *
 * - Given a package whose agent_state is a link, or holds a link that leaves agent_state, points
 *   at nothing or was absolute, the import is a 400 and the Agent's State, vault and folder are
 *   as they were.
 * - Given a package with a relative link inside agent_state, an Agent created from it reads
 *   through the link, and its export creates a second Agent that keeps the link.
 * - Given a current vault that cannot be read, the import fails before the State is touched;
 *   once the vault is readable again the retry imports and the vault survives.
 * - Given the new State cannot be moved in, the previous State and vault are put back and the
 *   retry imports.
 * - Given the new State cannot be moved in and the previous one cannot be moved back, both stay
 *   in the import's staging directory and the server log names it; moving it back by hand lets
 *   the retry import with the vault intact.
 * - Given a committed import whose staging directory cannot be removed, the import still reports
 *   its version, the log names the leftover, and an unconfirmed re-import is a 409.
 * - Given snapshot packing fails, no .tmp- file is left beside the snapshots and the next export
 *   succeeds.
 *
 * Failures are injected at one boundary, `node:fs/promises`; every other call goes through.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentDir, agentStateDir, agentVaultPath, snapshotsDir } from "@prismshadow/penguin-core";
import type { AgentImportResponse } from "../src/api/types.js";
import { apiClient, canCreateSymlink, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const projectId = "default_project";
const CONFIG = 'system_prompt: "candidate"\nversion: 2\n';

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: injected`), { code });
}

/** Fails `fs.rename` with `code` for the calls `when` picks. */
function failRename(code: string, when: (from: string, to: string) => boolean) {
  const real = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation((from, to) =>
    when(String(from), String(to)) ? Promise.reject(fsError(code)) : real(from, to),
  );
}

/** `pick`, answering true for the first call it matches and false ever after. */
function once(pick: (from: string, to: string) => boolean) {
  let fired = false;
  return (from: string, to: string) => !fired && pick(from, to) && (fired = true);
}

/** Writes a valid v2 State with a lesson into `<src>/agent_state`. */
async function writeCandidate(src: string): Promise<void> {
  await fs.mkdir(path.join(src, "agent_state", "skills"), { recursive: true });
  await fs.writeFile(path.join(src, "agent_state", "system_config.yaml"), CONFIG);
  await fs.writeFile(path.join(src, "agent_state", "lesson.md"), "Keep this lesson\n");
}

describe("Agent State import recovery", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const logged: string[] = [];
  const created: string[] = [];
  let ids = 0;
  let packages = 0;
  let candidate: { dataBase64: string };

  async function pack(build: (src: string) => Promise<void>, entries = ["agent_state"]) {
    const src = path.join(t.root, `package_${++packages}`);
    await fs.mkdir(src, { recursive: true });
    await build(src);
    await tar.create({ gzip: true, cwd: src, file: `${src}.tar.gz` }, entries);
    return (await fs.readFile(`${src}.tar.gz`)).toString("base64");
  }

  async function createAgent(dataBase64?: string) {
    const id = `recovery_${++ids}`;
    const res = await admin.post(`/api/projects/${projectId}/agents`, { agentId: id, dataBase64 });
    expect(res.status).toBe(201);
    created.push(id);
    const base = `/api/projects/${projectId}/agents/${id}`;
    const state = agentStateDir(t.root, projectId, id);
    return { id, base, state, vault: agentVaultPath(t.root, projectId, id) };
  }

  /** A template Agent with a vault, and what its State looked like before the test. */
  async function agentWithVault() {
    const agent = await createAgent();
    const put = await admin.put(`${agent.base}/vault`, {
      entries: [{ key: "TOKEN", value: "kept" }],
    });
    expect(put.status).toBe(200);
    const config = await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8");
    return { ...agent, config, vaultBytes: await fs.readFile(agent.vault) };
  }

  const stagingOf = async (id: string) =>
    (await fs.readdir(agentDir(t.root, projectId, id))).filter((n) => n.startsWith(".import-"));

  beforeAll(async () => {
    t = await createTestApp({ log: (line) => logged.push(line) });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    candidate = { dataBase64: await pack(writeCandidate) };
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    logged.length = 0;
    for (const id of created.splice(0)) await t.deps.agentService.deleteAgent(projectId, id);
  });

  describe.skipIf(!canCreateSymlink())("package links", () => {
    it.each([
      {
        name: "agent_state is itself a link",
        entries: ["payload", "agent_state"],
        build: async (src: string) => {
          await fs.mkdir(path.join(src, "payload"));
          await fs.writeFile(path.join(src, "payload", "system_config.yaml"), CONFIG);
          await fs.symlink("payload", path.join(src, "agent_state"), "dir");
        },
      },
      {
        name: "a link leaves agent_state for a file the package carries beside it",
        entries: ["config.yaml", "agent_state"],
        build: async (src: string) => {
          await fs.writeFile(path.join(src, "config.yaml"), CONFIG);
          await fs.mkdir(path.join(src, "agent_state"));
          await fs.symlink("../config.yaml", path.join(src, "agent_state", "system_config.yaml"));
        },
      },
      {
        name: "a link points at nothing",
        entries: ["agent_state"],
        build: async (src: string) => {
          await writeCandidate(src);
          const link = path.join(src, "agent_state", "skills", "linked");
          await fs.symlink("../../nowhere", link, "dir");
        },
      },
      {
        name: "a link was absolute",
        entries: ["agent_state"],
        build: async (src: string) => {
          await writeCandidate(src);
          await fs.mkdir(path.join(src, "guidance"));
          const link = path.join(src, "agent_state", "skills", "linked");
          await fs.symlink(path.join(src, "guidance"), link, "dir");
        },
      },
    ])(
      "a package where $name is refused and the Agent is untouched",
      async ({ build, entries }) => {
        const agent = await agentWithVault();
        const dataBase64 = await pack(build, entries);

        const res = await admin.post(`${agent.base}/import`, { dataBase64 });

        expect(res.status).toBe(400);
        expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
          agent.config,
        );
        expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
        expect(await stagingOf(agent.id)).toEqual([]);
      },
    );

    it("a relative link inside agent_state survives creating an Agent, its export and a second creation", async () => {
      const dataBase64 = await pack(async (src) => {
        await writeCandidate(src);
        await fs.mkdir(path.join(src, "agent_state", "guidance"));
        await fs.writeFile(path.join(src, "agent_state", "guidance", "SKILL.md"), "# Guidance\n");
        const link = path.join(src, "agent_state", "skills", "linked");
        await fs.symlink("../guidance", link, "dir");
      });
      const linkOf = (state: string) => path.join(state, "skills", "linked");

      const first = await createAgent(dataBase64);
      await expect(fs.readFile(path.join(linkOf(first.state), "SKILL.md"), "utf8")).resolves.toBe(
        "# Guidance\n",
      );
      const exported = await admin.get(`${first.base}/export`);
      expect(exported.status).toBe(200);
      const second = await createAgent(
        Buffer.from(await exported.arrayBuffer()).toString("base64"),
      );

      expect((await fs.lstat(linkOf(second.state))).isSymbolicLink()).toBe(true);
      await expect(fs.readFile(path.join(linkOf(second.state), "SKILL.md"), "utf8")).resolves.toBe(
        "# Guidance\n",
      );
    });
  });

  it("an unreadable vault stops the import before the State is touched, and the repaired vault survives the retry", async () => {
    const agent = await agentWithVault();
    await fs.rm(agent.vault);
    await fs.mkdir(agent.vault);
    await fs.writeFile(path.join(agent.vault, "entry"), "inside");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(500);
    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
      agent.config,
    );
    expect(await fs.readFile(path.join(agent.vault, "entry"), "utf8")).toBe("inside");
    expect(await stagingOf(agent.id)).toEqual([]);

    await fs.rm(agent.vault, { recursive: true });
    await fs.writeFile(agent.vault, agent.vaultBytes);
    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(200);
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
  });

  it("when the new State cannot be moved in, the previous State and vault are put back and the retry imports", async () => {
    const agent = await agentWithVault();
    failRename(
      "EACCES",
      once((from) => from.includes(".import-") && path.basename(from) === "agent_state"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(500);
    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
      agent.config,
    );
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
    expect(await stagingOf(agent.id)).toEqual([]);

    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(200);
  });

  it("when the new State cannot be moved in and the old one cannot be moved back, both stay in staging and the log names it", async () => {
    const agent = await agentWithVault();
    failRename("EACCES", (_from, to) => to.endsWith(path.join(agent.id, "agent_state")));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(500);
    expect(errors.mock.calls.flat().join("\n")).toContain("replaced-agent_state");
    const staging = await stagingOf(agent.id);
    expect(staging).toHaveLength(1);
    const kept = path.join(agentDir(t.root, projectId, agent.id), staging[0]!);
    const trash = path.join(kept, "replaced-agent_state");
    expect(await fs.readFile(path.join(trash, "system_config.yaml"), "utf8")).toBe(agent.config);
    expect(await fs.readFile(path.join(trash, ".vault.toml"))).toEqual(agent.vaultBytes);

    // The operator follows the log: move the previous State back and drop the staging folder.
    vi.restoreAllMocks();
    await fs.rename(trash, agent.state);
    await fs.rm(kept, { recursive: true });
    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(200);
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
  });

  it("a committed import whose staging cannot be removed still reports its version", async () => {
    const agent = await agentWithVault();
    const realRm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation((p, opts) =>
      path.basename(String(p)).startsWith(".import-")
        ? Promise.reject(fsError("EBUSY"))
        : realRm(p, opts),
    );

    const res = await admin.post(`${agent.base}/import`, candidate);

    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentImportResponse).version).toBe(2);
    expect(await fs.readFile(path.join(agent.state, "lesson.md"), "utf8")).toBe(
      "Keep this lesson\n",
    );
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
    expect(logged.some((line) => line.includes(".import-"))).toBe(true);
    // It was committed: the same package again is "not newer", not a second import.
    expect((await admin.post(`${agent.base}/import`, candidate)).status).toBe(409);
  });

  it("a snapshot whose packing fails leaves no .tmp- file, and the next export succeeds", async () => {
    const agent = await createAgent();
    failRename(
      "ENOSPC",
      once((from) => from.includes(".tmp-")),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await admin.get(`${agent.base}/export`)).status).toBe(500);
    const dir = snapshotsDir(t.root, projectId, agent.id);
    expect((await fs.readdir(dir)).filter((n) => n.includes(".tmp-"))).toEqual([]);

    const res = await admin.get(`${agent.base}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(`${agent.id}-v1.tar.gz`);
  });
});
