/**
 * Agent archive overwrites that fail part-way.
 *
 * - Given a current vault that cannot be read, the overwrite fails before the State is touched;
 *   once the vault is readable again the retry imports and the vault survives.
 * - Given the new State cannot be moved in, the previous State, its vault and the parts it kept
 *   are put back, and the retry imports.
 * - Given a part the overwrite keeps cannot be moved across, the previous State is put back whole.
 * - Given the new State cannot be moved in and the previous one cannot be moved back, both stay
 *   in the swap's staging directory and the server log names it; moving it back by hand lets the
 *   retry import with the vault intact.
 * - Given a committed overwrite whose staging directory cannot be removed, the import still
 *   answers with its version and the log names the leftover.
 * - Given the backup cannot be packed, no .tmp- file is left beside the snapshots, nothing is
 *   replaced, and the next overwrite succeeds.
 *
 * Failures are injected at one boundary, `node:fs/promises`; every other call goes through.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentDir, agentStateDir, agentVaultPath, snapshotsDir } from "@prismshadow/penguin-core";
import type { AgentArchiveImportResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const projectId = "default_project";

/** A v2 State that leaves memory out, so the overwrite keeps the Agent's own. */
const CANDIDATE = zipSync({
  "candidate/manifest.json": strToU8(
    JSON.stringify({
      format: "penguin-agent-zip/1",
      agentId: "candidate",
      parts: {
        skills: true,
        hooks: true,
        memory: false,
        workbenches: true,
        workbenchData: true,
        schedules: false,
        traces: { kind: "none" },
      },
      vaultKeys: [],
      redacted: [],
    }),
  ),
  "candidate/agent_state/system_config.yaml": strToU8('system_prompt: "candidate"\nversion: 2\n'),
  "candidate/agent_state/AGENTS.md": strToU8("# Candidate\n"),
  "candidate/agent_state/lesson.md": strToU8("Keep this lesson\n"),
});

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

describe("Agent archive overwrite recovery", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const logged: string[] = [];
  const created: string[] = [];
  let ids = 0;

  /** A template Agent with a vault and a memory topic, and what its State looked like before the test. */
  async function agentWithVault() {
    const id = `recovery_${++ids}`;
    expect((await admin.post(`/api/projects/${projectId}/agents`, { agentId: id })).status).toBe(
      201,
    );
    created.push(id);
    const base = `/api/projects/${projectId}/agents/${id}`;
    const state = agentStateDir(t.root, projectId, id);
    const vault = agentVaultPath(t.root, projectId, id);
    expect(
      (await admin.put(`${base}/vault`, { entries: [{ key: "TOKEN", value: "kept" }] })).status,
    ).toBe(200);
    await fs.writeFile(path.join(state, "memory", "user", "mine.md"), "my memory\n");
    const config = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
    return { id, state, vault, config, vaultBytes: await fs.readFile(vault) };
  }

  const overwrite = (id: string) =>
    admin.upload(`/api/projects/${projectId}/agents/import?agentId=${id}&overwrite=1`, CANDIDATE);
  const stagingOf = async (id: string) =>
    (await fs.readdir(agentDir(t.root, projectId, id))).filter((n) => n.startsWith(".import-"));

  beforeAll(async () => {
    t = await createTestApp({ log: (line) => logged.push(line) });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    logged.length = 0;
    for (const id of created.splice(0)) await t.deps.agentService.deleteAgent(projectId, id);
  });

  it("an unreadable vault stops the overwrite before the State is touched, and the repaired vault survives the retry", async () => {
    const agent = await agentWithVault();
    await fs.rm(agent.vault);
    await fs.mkdir(agent.vault);
    await fs.writeFile(path.join(agent.vault, "entry"), "inside");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await overwrite(agent.id)).status).toBe(500);
    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
      agent.config,
    );
    expect(await fs.readFile(path.join(agent.vault, "entry"), "utf8")).toBe("inside");
    expect(await stagingOf(agent.id)).toEqual([]);

    await fs.rm(agent.vault, { recursive: true });
    await fs.writeFile(agent.vault, agent.vaultBytes);
    expect((await overwrite(agent.id)).status).toBe(201);
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
  });

  it("when the new State cannot be moved in, the previous State, vault and kept parts are put back and the retry imports", async () => {
    const agent = await agentWithVault();
    failRename(
      "EACCES",
      once((from) => from.includes(".import-") && path.basename(from) === "agent_state"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await overwrite(agent.id)).status).toBe(500);
    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
      agent.config,
    );
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
    expect(await fs.readFile(path.join(agent.state, "memory", "user", "mine.md"), "utf8")).toBe(
      "my memory\n",
    );
    expect(await stagingOf(agent.id)).toEqual([]);

    expect((await overwrite(agent.id)).status).toBe(201);
    expect(await fs.readFile(path.join(agent.state, "memory", "user", "mine.md"), "utf8")).toBe(
      "my memory\n",
    );
  });

  it("when a kept part cannot be moved across, the previous State is put back whole", async () => {
    const agent = await agentWithVault();
    failRename(
      "EBUSY",
      once((from) => from.includes("replaced-agent_state") && path.basename(from) === "memory"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await overwrite(agent.id)).status).toBe(500);
    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
      agent.config,
    );
    expect(await fs.readFile(path.join(agent.state, "memory", "user", "mine.md"), "utf8")).toBe(
      "my memory\n",
    );
    await expect(fs.access(path.join(agent.state, "lesson.md"))).rejects.toThrow();
  });

  it("when the new State cannot be moved in and the old one cannot be moved back, both stay in staging and the log names it", async () => {
    const agent = await agentWithVault();
    failRename("EACCES", (_from, to) => to.endsWith(path.join(agent.id, "agent_state")));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await overwrite(agent.id)).status).toBe(500);
    expect(errors.mock.calls.flat().join("\n")).toContain("replaced-agent_state");
    const staging = await stagingOf(agent.id);
    expect(staging).toHaveLength(1);
    const kept = path.join(agentDir(t.root, projectId, agent.id), staging[0]!);
    const trash = path.join(kept, "replaced-agent_state");
    expect(await fs.readFile(path.join(trash, "system_config.yaml"), "utf8")).toBe(agent.config);
    expect(await fs.readFile(path.join(trash, ".vault.toml"))).toEqual(agent.vaultBytes);
    expect(await fs.readFile(path.join(trash, "memory", "user", "mine.md"), "utf8")).toBe(
      "my memory\n",
    );

    // The operator follows the log: move the previous State back and drop the staging folder.
    vi.restoreAllMocks();
    await fs.rename(trash, agent.state);
    await fs.rm(kept, { recursive: true });
    expect((await overwrite(agent.id)).status).toBe(201);
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
  });

  it("a committed overwrite whose staging cannot be removed still answers with its version", async () => {
    const agent = await agentWithVault();
    const realRm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation((p, opts) =>
      path.basename(String(p)).startsWith(".import-") &&
      path.dirname(String(p)) === agentDir(t.root, projectId, agent.id)
        ? Promise.reject(fsError("EBUSY"))
        : realRm(p, opts),
    );

    const res = await overwrite(agent.id);

    expect(res.status).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).version).toBe(2);
    expect(await fs.readFile(path.join(agent.state, "lesson.md"), "utf8")).toBe(
      "Keep this lesson\n",
    );
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
    expect(logged.some((line) => line.includes(".import-"))).toBe(true);
  });

  it("a backup that cannot be packed leaves no .tmp- file and replaces nothing, and the next overwrite succeeds", async () => {
    const agent = await agentWithVault();
    failRename(
      "ENOSPC",
      once((from) => from.includes(".tmp-")),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await overwrite(agent.id)).status).toBe(500);
    const dir = snapshotsDir(t.root, projectId, agent.id);
    expect((await fs.readdir(dir)).filter((n) => n.includes(".tmp-"))).toEqual([]);
    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(
      agent.config,
    );

    expect((await overwrite(agent.id)).status).toBe(201);
  });
});
