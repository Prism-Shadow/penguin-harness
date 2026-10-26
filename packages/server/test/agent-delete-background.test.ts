/**
 * Deleting an Agent whose folder is large, over the real app on a real temp root.
 *
 * - Given an Agent with a temporary Workspace full of files, when its owner deletes it, the
 *   answer (202) comes once the folder has left the agents directory: the Agent is in no list,
 *   no route accepts it, and its id can be taken again at once. The deletion then reports its
 *   removal to the end — the readings never go back, every entry counted is removed, and nothing
 *   of the old folder is left — while the new Agent under the same id is not touched.
 * - Given an entry the removal cannot remove, the Agent is still gone for the user; the deletion
 *   ends `failed` with the operating system's reason, naming the entry by its place in the folder,
 *   and what is left waits under `.deleting/`.
 *   When the server starts again, it removes what is left, under the same deletion id.
 * - Given a folder that cannot be moved, the delete is refused with 409 `agent_folder_busy` and
 *   nothing is deleted: the Agent still lists, opens, and keeps its Sessions.
 * - Given an index row whose folder lost its system_config.yaml (a delete an earlier server did
 *   not finish), the list leaves it out, so every listed Agent opens.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentDir, systemConfigPath } from "@prismshadow/penguin-core";
import type {
  AgentDeleteResponse,
  AgentDeletionInfo,
  AgentDeletionResponse,
  AgentsResponse,
} from "../src/api/types.js";
import { deletingDir } from "../src/services/agent-service.js";
import { apiClient, createTestApp, provisionUser, restartTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "olivia-default_project";
/** Permission bits do not stop root, and mean something else on Windows. */
const permissionsHold = process.platform !== "win32" && process.getuid?.() !== 0;

describe("deleting a large Agent", () => {
  let t: TestApp;
  let cookie: string;
  let api: ReturnType<typeof apiClient>;
  const agentsPath = `/api/projects/${PROJECT}/agents`;
  const root = () => t.deps.config.root;

  beforeAll(async () => {
    t = await createTestApp({ durableDatabase: true });
    cookie = (await provisionUser(t.app, "olivia")).cookie;
    api = apiClient(t.app, cookie);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  async function createAgent(agentId: string): Promise<void> {
    expect((await api.post(agentsPath, { agentId })).status).toBe(201);
  }

  async function listed(): Promise<string[]> {
    const res = await api.get(agentsPath);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentsResponse).agents.map((a) => a.agentId);
  }

  /** A temporary Workspace the way an install leaves one: many small files in nested folders. */
  async function fillWorkspace(agentId: string, dirs: number, filesPerDir: number): Promise<void> {
    const base = path.join(agentDir(root(), PROJECT, agentId), "workspaces", "ws_big");
    for (let d = 0; d < dirs; d++) {
      const dir = path.join(base, "node_modules", `pkg${d % 7}`, `lib${d}`);
      await fs.mkdir(dir, { recursive: true });
      for (let f = 0; f < filesPerDir; f++) {
        await fs.writeFile(path.join(dir, `f${f}.js`), "module.exports = 1;\n");
      }
    }
  }

  /** Every entry under `dir`, `dir` itself included. */
  async function countTree(dir: string): Promise<number> {
    let n = 1;
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      n += e.isDirectory() ? await countTree(path.join(dir, e.name)) : 1;
    }
    return n;
  }

  async function reading(deletionId: string, client = api): Promise<AgentDeletionInfo> {
    const res = await client.get(`/api/projects/${PROJECT}/agent-deletions/${deletionId}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentDeletionResponse).deletion;
  }

  /** Reads the deletion until it is over; every reading on the way, oldest first. */
  async function readUntilOver(deletionId: string, client = api): Promise<AgentDeletionInfo[]> {
    const seen: AgentDeletionInfo[] = [];
    await vi.waitFor(
      async () => {
        const now = await reading(deletionId, client);
        seen.push(now);
        expect(["done", "failed"]).toContain(now.phase);
      },
      { timeout: 20_000, interval: 5 },
    );
    return seen;
  }

  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    );

  it("lists only Agents the routes accept: a row whose folder lost its config is left out", async () => {
    await createAgent("half_gone");
    await fillWorkspace("half_gone", 2, 3);
    // What an interrupted recursive delete left: the small agent_state/ went first.
    await fs.rm(path.dirname(systemConfigPath(root(), PROJECT, "half_gone")), {
      recursive: true,
    });

    const ids = await listed();
    expect(ids).not.toContain("half_gone");
    for (const id of ids) {
      expect((await api.get(`${agentsPath}/${id}/config`)).status).toBe(200);
    }
  });

  it.skipIf(!permissionsHold)(
    "refuses a folder that cannot be moved, and deletes nothing",
    async () => {
      await createAgent("pinned_one");
      const sessionId = "session-2026-10-26-09-00-00-0abc0001";
      t.deps.sessionsRepo.insert({
        sessionId,
        projectId: PROJECT,
        agentId: "pinned_one",
        provider: "custom",
        modelId: "m-dev",
        workspace: "/tmp",
        approvalMode: "allow-all",
        title: null,
        client: "web",
        createdAt: "2026-10-26T09:00:00.000Z",
        lastActiveAt: "2026-10-26T09:00:00.000Z",
      });
      const agents = path.dirname(agentDir(root(), PROJECT, "pinned_one"));
      await fs.mkdir(deletingDir(root(), PROJECT), { recursive: true });
      // A directory nobody may write to: nothing can be moved out of it.
      await fs.chmod(agents, 0o555);
      let res: Response;
      try {
        res = await api.delete(`${agentsPath}/pinned_one`);
      } finally {
        await fs.chmod(agents, 0o755);
      }

      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "agent_folder_busy",
      );
      expect(await listed()).toContain("pinned_one");
      expect((await api.get(`${agentsPath}/pinned_one/config`)).status).toBe(200);
      expect(t.deps.sessionsRepo.findById(sessionId)).not.toBeNull();
    },
  );

  it("takes the Agent off every list at once, frees its id, and removes its files in the background", async () => {
    await createAgent("big_one");
    await fillWorkspace("big_one", 40, 25);
    const folder = agentDir(root(), PROJECT, "big_one");
    const entries = await countTree(folder);

    const res = await api.delete(`${agentsPath}/big_one`);
    expect(res.status).toBe(202);
    const { deletion } = (await res.json()) as AgentDeleteResponse;
    expect(deletion.agentId).toBe("big_one");

    expect(await exists(folder)).toBe(false);
    expect(await listed()).not.toContain("big_one");
    expect((await api.get(`${agentsPath}/big_one/config`)).status).toBe(404);
    // The id is free while the old files are still being removed.
    await createAgent("big_one");

    const seen = await readUntilOver(deletion.deletionId);
    const last = seen[seen.length - 1]!;
    expect(last).toMatchObject({ phase: "done", total: entries, removed: entries });
    const removed = [deletion, ...seen].map((r) => r.removed);
    expect(removed).toEqual([...removed].sort((a, b) => a - b));
    expect(await exists(path.join(deletingDir(root(), PROJECT), deletion.deletionId))).toBe(false);
    // The removal stayed inside the old folder: the new Agent under the same id is whole.
    expect(await exists(systemConfigPath(root(), PROJECT, "big_one"))).toBe(true);
    expect(await listed()).toContain("big_one");
  });

  it.skipIf(!permissionsHold)(
    "keeps what it cannot remove for the next start, which removes it",
    async () => {
      await createAgent("stuck_one");
      const locked = path.join(agentDir(root(), PROJECT, "stuck_one"), "workspaces", "locked");
      await fs.mkdir(locked, { recursive: true });
      await fs.writeFile(path.join(locked, "keep.txt"), "x");
      // No write permission on the folder: its file cannot be unlinked.
      await fs.chmod(locked, 0o555);

      const res = await api.delete(`${agentsPath}/stuck_one`);
      expect(res.status).toBe(202);
      const { deletion } = (await res.json()) as AgentDeleteResponse;
      const last = (await readUntilOver(deletion.deletionId)).pop()!;
      expect(last.phase).toBe("failed");
      expect(last.error).toMatch(/EACCES|EPERM/);
      // The entry is named by its place in the agent's folder, not by the data root's path.
      expect(last.error).toContain(`'${path.join("workspaces", "locked", "keep.txt")}'`);
      expect(last.error).not.toContain(root());
      expect(await listed()).not.toContain("stuck_one");
      const left = path.join(deletingDir(root(), PROJECT), deletion.deletionId);
      expect(await exists(path.join(left, "workspaces", "locked", "keep.txt"))).toBe(true);

      // Whatever held the file let go while the server was down.
      await fs.chmod(path.join(left, "workspaces", "locked"), 0o755);
      t = await restartTestApp(t);
      const after = apiClient(t.app, cookie);
      const resumed = (await readUntilOver(deletion.deletionId, after)).pop()!;
      expect(resumed.phase).toBe("done");
      expect(await exists(left)).toBe(false);
    },
  );
});
