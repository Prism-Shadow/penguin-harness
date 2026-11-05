/**
 * Agent archive overwrites that fail part-way, and what is left of them afterwards.
 *
 * - Given a current vault that cannot be read, the overwrite fails before the State is touched;
 *   once the vault is readable again the retry imports and the vault survives.
 * - Given the new State cannot be moved in, the previous State, its vault and the parts it kept
 *   are put back, and the retry imports.
 * - Given a part the overwrite keeps cannot be moved across, the previous State is put back whole.
 * - Given the new State cannot be moved in and the previous one cannot be moved back, the answer is
 *   a 500 naming the folder that holds them and the backup; nothing of the Agent's is removed,
 *   and the next import of the Agent puts it all back before it imports.
 * - Given a server that stopped between the swap's renames, its next start puts the previous
 *   State and its kept parts back, and the Agent lists again.
 * - Given a stale staging folder beside the Agents, the next import sweeps it; one marked as
 *   holding an Agent's State is kept.
 * - Given a hand-written overwrite whose swap fails, the Agent's live config is as it was.
 * - Given a Session that cannot be moved in after the State was swapped, the import still answers
 *   201 with its report and the backup, the Session is skipped as invalid, and none of its files
 *   is left behind.
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
import {
  agentDir,
  agentStateDir,
  agentVaultPath,
  agentsDir,
  snapshotsDir,
} from "@prismshadow/penguin-core";
import type { AgentArchiveImportResponse, AgentsResponse } from "../src/api/types.js";
import { SWAP_MARK } from "../src/services/state-swap.js";
import { apiClient, createTestApp, loginAdmin, restartTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const projectId = "default_project";

const PARTS = {
  skills: true,
  hooks: true,
  memory: false,
  workbenches: true,
  workbenchData: true,
  schedules: false,
  traces: { kind: "none" },
};

/** A zip under `candidate/`: a v2 State that leaves memory out, so the overwrite keeps the Agent's own. */
function candidate(extra: Record<string, Uint8Array> = {}, manifest: object = {}): Uint8Array {
  return zipSync({
    "candidate/manifest.json": strToU8(
      JSON.stringify({
        format: "penguin-agent-zip/1",
        agentId: "candidate",
        parts: PARTS,
        vaultKeys: [],
        redacted: [],
        ...manifest,
      }),
    ),
    "candidate/agent_state/system_config.yaml": strToU8('system_prompt: "candidate"\nversion: 2\n'),
    "candidate/agent_state/AGENTS.md": strToU8("# Candidate\n"),
    "candidate/agent_state/lesson.md": strToU8("Keep this lesson\n"),
    ...extra,
  });
}
const CANDIDATE = candidate();

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

/** The swap's last rename: the new State, staged as `incoming`, becoming the Agent's. */
const movingIn = (state: string) => (from: string, to: string) =>
  path.basename(from) === "incoming" && to === state;

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
    return { id, base, state, vault, config, vaultBytes: await fs.readFile(vault) };
  }

  const overwrite = (id: string, zip = CANDIDATE) =>
    admin.upload(`/api/projects/${projectId}/agents/import?agentId=${id}&overwrite=1`, zip);
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
    for (const id of created.splice(0)) {
      await t.deps.agentService.deleteAgent(projectId, id).catch(() => undefined);
    }
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
    failRename("EACCES", once(movingIn(agent.state)));
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

  it("when nothing can be moved back, the answer names the folder that holds it all and the backup, and the next import puts it back first", async () => {
    const agent = await agentWithVault();
    // The new State does not move in, and the previous State does not move back either.
    failRename("EACCES", (_from, to) => to === agent.state);

    const res = await overwrite(agent.id);

    expect(res.status).toBe(500);
    const { error } = (await res.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("import_rollback_failed");
    const [folder] = await stagingOf(agent.id);
    expect(error.message).toContain(path.join(agentDir(t.root, projectId, agent.id), folder!));
    expect(error.message).toMatch(/snapshots\/import-backup-v1-/);
    const kept = path.join(agentDir(t.root, projectId, agent.id), folder!);
    await expect(fs.access(path.join(kept, SWAP_MARK))).resolves.toBeUndefined();
    expect(
      await fs.readFile(path.join(kept, "replaced-agent_state", "system_config.yaml"), "utf8"),
    ).toBe(agent.config);
    expect(await fs.readFile(path.join(kept, "replaced-agent_state", ".vault.toml"))).toEqual(
      agent.vaultBytes,
    );
    expect(
      await fs.readFile(path.join(kept, "incoming", "memory", "user", "mine.md"), "utf8"),
    ).toBe("my memory\n");

    vi.restoreAllMocks();
    expect((await overwrite(agent.id)).status).toBe(201);
    expect(await fs.readFile(path.join(agent.state, "memory", "user", "mine.md"), "utf8")).toBe(
      "my memory\n",
    );
    expect(await fs.readFile(agent.vault)).toEqual(agent.vaultBytes);
    expect(await stagingOf(agent.id)).toEqual([]);
  });

  it("a stale staging folder beside the Agents is swept by the next import, unless it is marked as holding a State", async () => {
    const agents = agentsDir(t.root, projectId);
    const stale = path.join(agents, ".import-0000000000aa");
    const marked = path.join(agents, ".import-0000000000bb");
    for (const dir of [stale, marked]) {
      await fs.mkdir(path.join(dir, "extracted"), { recursive: true });
      await fs.utimes(dir, new Date(0), new Date(0));
    }
    await fs.writeFile(path.join(marked, SWAP_MARK), "{}");
    await fs.utimes(marked, new Date(0), new Date(0));
    const agent = await agentWithVault();

    expect((await overwrite(agent.id)).status).toBe(201);

    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(path.join(marked, SWAP_MARK))).resolves.toBeUndefined();
    await fs.rm(marked, { recursive: true });
  });

  it("a hand-written overwrite whose swap fails leaves the Agent's live config as it was", async () => {
    const agent = await agentWithVault();
    const put = await admin.put(`${agent.base}/config`, {
      config: {
        name: "Mine",
        mcpServers: [
          { name: "github", config: { command: "node", env: { GITHUB_TOKEN: "mine" } } },
        ],
      },
    });
    expect(put.status).toBe(200);
    const before = await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8");
    const zip = zipSync({
      "hand/manifest.json": strToU8(
        JSON.stringify({
          format: "penguin-agent-zip/1",
          agentId: "hand",
          name: "Hand",
          definition: {
            mcpServers: [
              { name: "github", config: { command: "node", env: { GITHUB_TOKEN: "" } } },
            ],
          },
        }),
      ),
      "hand/agent_state/AGENTS.md": strToU8("# Hand\n"),
    });
    failRename("EACCES", once(movingIn(agent.state)));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await overwrite(agent.id, zip)).status).toBe(500);

    expect(await fs.readFile(path.join(agent.state, "system_config.yaml"), "utf8")).toBe(before);
  });

  it("a Session that cannot be moved in after the swap is skipped as invalid, and the import still answers with its report", async () => {
    const agent = await agentWithVault();
    const sid = "session-2026-10-01-09-00-00-0000dddd";
    const meta = {
      timestamp: "2026-10-01T09:00:00.000Z",
      type: "session_meta",
      payload: {
        session_id: sid,
        model_id: "m",
        provider: "custom",
        model_context_window: 1000,
        system_prompt: "",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
        source: "user",
      },
    };
    const zip = candidate(
      {
        "candidate/traces/sessions.json": strToU8(
          JSON.stringify([
            {
              sessionId: sid,
              files: 1,
              createdAt: "2026-10-01T09:00:00.000Z",
              lastActiveAt: "2026-10-01T09:00:00.000Z",
              title: "t",
              archivedAt: null,
              keptAt: null,
              approvalMode: "allow-all",
              thinkingLevel: null,
              client: "web",
              workspace: "/tmp/w",
              provider: "custom",
              modelId: "m",
            },
          ]),
        ),
        [`candidate/traces/2026-10-01/${sid}_001.jsonl`]: strToU8(`${JSON.stringify(meta)}\n`),
      },
      { parts: { ...PARTS, traces: { kind: "last", count: 1 } } },
    );
    const traces = path.join(agentDir(t.root, projectId, agent.id), "traces");
    failRename("ENOSPC", (_from, to) => to.startsWith(traces));

    const res = await overwrite(agent.id, zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.backup).toMatch(/^snapshots\/import-backup-v1-/);
    expect(body.skippedTraces).toEqual([
      { sessionId: sid, reason: "invalid", detail: expect.stringContaining("ENOSPC") },
    ]);
    expect(body.imported.traces).toEqual({ sessions: 0, files: 0 });
    expect(await fs.readFile(path.join(agent.state, "AGENTS.md"), "utf8")).toBe("# Candidate\n");
    const left = await fs.readdir(traces, { recursive: true }).catch(() => [] as string[]);
    expect(left.filter((name) => String(name).includes(sid))).toEqual([]);
    expect(t.deps.sessionsRepo.findById(sid)).toBeNull();
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

describe("Agent archive: a server that stopped mid-swap", () => {
  it("its next start puts the previous State and its kept parts back, and the Agent lists again", async () => {
    let t = await createTestApp({ durableDatabase: true, log: () => {} });
    try {
      let admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
      expect(
        (await admin.post(`/api/projects/${projectId}/agents`, { agentId: "stopped" })).status,
      ).toBe(201);
      const state = agentStateDir(t.root, projectId, "stopped");
      await fs.writeFile(path.join(state, "memory", "user", "mine.md"), "my memory\n");
      const config = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");
      // The process stops between the renames: nothing after the State moved aside happens.
      failRename("EIO", (_from, to) => to === state);
      const stopped = await admin.upload(
        `/api/projects/${projectId}/agents/import?agentId=stopped&overwrite=1`,
        CANDIDATE,
      );
      expect(stopped.status).toBe(500);
      vi.restoreAllMocks();
      await expect(fs.access(state)).rejects.toThrow();

      t = await restartTestApp(t, { log: () => {} });

      admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
      const list = (await (
        await admin.get(`/api/projects/${projectId}/agents`)
      ).json()) as AgentsResponse;
      expect(list.agents.map((a) => a.agentId)).toContain("stopped");
      expect(await fs.readFile(path.join(state, "system_config.yaml"), "utf8")).toBe(config);
      expect(await fs.readFile(path.join(state, "memory", "user", "mine.md"), "utf8")).toBe(
        "my memory\n",
      );
      const left = (await fs.readdir(agentDir(t.root, projectId, "stopped"))).filter((n) =>
        n.startsWith(".import-"),
      );
      expect(left).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await t.cleanup();
    }
  });
});
