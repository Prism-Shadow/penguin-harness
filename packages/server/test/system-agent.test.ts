/**
 * The system Agent (`system_agent`, PRFC-0033): every Project's owner of the system apps, which
 * runs no Session, takes no plugin, and keeps its identity.
 *
 * - Given a new Project, its Agents list `system_agent` after the other built-in Agents, marked
 *   `system`, its config carrying the `system: true` key.
 * - Given a Project made before the system Agent (no folder, no index row), the first listing
 *   gives it one, sorted with the built-in Agents ahead of the Agents made meanwhile, and the
 *   next listing finds the same one. One that cannot be written still lists the Project's other
 *   Agents, and is written at the first listing after it can be.
 * - Deleting it is 409 `cannot_delete_builtin_agent`, and it stays.
 * - Changing its name, description or author is 409 `builtin_agent_locked`, and nothing is
 *   written; a change of anything else is not refused.
 * - A Session on it is 409 `system_agent_no_sessions`, over the HTTP create route and over
 *   AMSP, and no Session is left behind; its Agent API settings are refused the same way.
 * - Installing a plugin on it is 409 `system_agent_closed`, and nothing is installed.
 * - Exporting it, and an overwrite import onto it, are 409 `builtin_agent_locked`.
 * - A new Agent taking its id where the Project does not have it yet is 409 `agent_id_reserved`.
 * - Given an Agent the user named `system_agent` before the upgrade (no key), it stays the
 *   user's: listed without the mark, never overwritten, deletable — after which the next
 *   listing gives the Project its system Agent.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentDir,
  loadAgentState,
  SYSTEM_AGENT_ID,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import type { AgentApi } from "@prismshadow/penguin-library-agent-api";
import type { AgentsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, type TestApp } from "./helpers.js";

const P = "sys_owner-system";

/** The error code a refused response names. */
async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("the system Agent", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  const agents = `/api/projects/${P}/agents`;
  const system = `${agents}/${SYSTEM_AGENT_ID}`;

  const list = async () => ((await (await owner.get(agents)).json()) as AgentsResponse).agents;
  const configOnDisk = () => fs.readFile(systemConfigPath(t.root, P, SYSTEM_AGENT_ID), "utf8");

  beforeEach(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "sys_owner")).cookie);
    expect((await owner.post("/api/projects", { projectId: P, name: "System" })).status).toBe(201);
  });
  afterEach(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
  });

  it("comes with a new Project, after the other built-in Agents, marked and keyed", async () => {
    const listed = await list();
    expect(listed.map((a) => a.agentId)).toEqual(["default_agent", SYSTEM_AGENT_ID]);
    expect(listed.find((a) => a.agentId === SYSTEM_AGENT_ID)?.system).toBe(true);
    expect(listed.find((a) => a.agentId === "default_agent")?.system).toBeUndefined();
    expect(await configOnDisk()).toMatch(/^system: true$/m);
  });

  it("is given to a Project made before it on the Project's first listing", async () => {
    // The Project as an older build left it: no system Agent folder, no index row.
    await fs.rm(agentDir(t.root, P, SYSTEM_AGENT_ID), { recursive: true, force: true });
    t.deps.db
      .prepare("DELETE FROM agents WHERE project_id = ? AND agent_id = ?")
      .run(P, SYSTEM_AGENT_ID);
    expect((await owner.post(agents, { agentId: "helper" })).status).toBe(201);

    const first = await list();
    expect(first.map((a) => a.agentId)).toEqual(["default_agent", SYSTEM_AGENT_ID, "helper"]);
    expect(first.find((a) => a.agentId === SYSTEM_AGENT_ID)?.system).toBe(true);
    const written = await configOnDisk();
    expect((await list()).map((a) => a.agentId)).toEqual(first.map((a) => a.agentId));
    expect(await configOnDisk()).toBe(written);
  });

  it("lists the other Agents while it cannot be written, and writes it once it can", async () => {
    // A plain file where its folder would go: nothing can be written under it.
    await fs.rm(agentDir(t.root, P, SYSTEM_AGENT_ID), { recursive: true, force: true });
    await fs.writeFile(agentDir(t.root, P, SYSTEM_AGENT_ID), "");
    const blocked = await owner.get(agents);
    expect(blocked.status).toBe(200);
    expect(((await blocked.json()) as AgentsResponse).agents.map((a) => a.agentId)).toEqual([
      "default_agent",
    ]);

    await fs.rm(agentDir(t.root, P, SYSTEM_AGENT_ID));
    expect((await list()).find((a) => a.agentId === SYSTEM_AGENT_ID)?.system).toBe(true);
  });

  it("cannot be deleted", async () => {
    const res = await owner.delete(system);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("cannot_delete_builtin_agent");
    expect((await list()).map((a) => a.agentId)).toContain(SYSTEM_AGENT_ID);
  });

  it.each([["name"], ["description"], ["author"]])(
    "refuses a change of its %s and writes nothing",
    async (field) => {
      const before = await configOnDisk();
      const res = await owner.put(`${system}/config`, {
        config: { [field]: field === "author" ? "agent" : "Changed" },
      });
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("builtin_agent_locked");
      expect(await configOnDisk()).toBe(before);
    },
  );

  it("takes a change that leaves its identity alone", async () => {
    expect((await owner.put(`${system}/config`, { config: { maxTurns: 20 } })).status).toBe(200);
  });

  it("runs no Session over HTTP or AMSP, and leaves none behind", async () => {
    const http = await owner.post(`${system}/sessions`, {});
    expect(http.status).toBe(409);
    expect(await codeOf(http)).toBe("system_agent_no_sessions");

    // Its API switch cannot be turned on through the API tab, so the row is written underneath,
    // as a state the AMSP gate would let through.
    t.deps.tree
      .api<AgentApi>("AgentApiModule", "AgentApi")
      .set(P, SYSTEM_AGENT_ID, { enabled: true, open: true }, new Date().toISOString());
    const run = await t.app.request(`/api/amsp/v1/agents/${P}/${SYSTEM_AGENT_ID}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    expect(run.status).toBe(409);
    expect(await codeOf(run)).toBe("system_agent_no_sessions");
    expect(t.deps.sessionsRepo.listByAgent(P, SYSTEM_AGENT_ID)).toEqual([]);
  });

  it("has no Agent API settings to read or change", async () => {
    for (const res of [
      await owner.get(`${system}/api`),
      await owner.put(`${system}/api`, { enabled: true }),
      await owner.post(`${system}/api/keys`, { name: "ci" }),
    ]) {
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("system_agent_no_sessions");
    }
  });

  it("takes no plugin, and nothing is installed", async () => {
    const res = await owner.post(`${system}/plugins`, { names: ["goal"] });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("system_agent_closed");
    expect(
      await fs.readdir(path.join(agentDir(t.root, P, SYSTEM_AGENT_ID), "agent_state", "hooks")),
    ).toEqual([]);
  });

  it("is neither exported nor overwritten by an import", async () => {
    const exported = await owner.get(`${system}/archive`);
    expect(exported.status).toBe(409);
    expect(await codeOf(exported)).toBe("builtin_agent_locked");

    const pkg = new Uint8Array(
      await (await owner.get(`${agents}/default_agent/archive`)).arrayBuffer(),
    );
    const before = await configOnDisk();
    const overwrite = await owner.upload(
      `${agents}/import?agentId=${SYSTEM_AGENT_ID}&overwrite=1`,
      pkg,
    );
    expect(overwrite.status).toBe(409);
    expect(await codeOf(overwrite)).toBe("builtin_agent_locked");
    expect(await configOnDisk()).toBe(before);
  });

  it("keeps its id from a new Agent where the Project does not have it yet", async () => {
    await fs.rm(agentDir(t.root, P, SYSTEM_AGENT_ID), { recursive: true, force: true });
    t.deps.db
      .prepare("DELETE FROM agents WHERE project_id = ? AND agent_id = ?")
      .run(P, SYSTEM_AGENT_ID);
    const res = await owner.post(agents, { agentId: SYSTEM_AGENT_ID });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("agent_id_reserved");
  });

  it("leaves an Agent the user already named system_agent theirs, until it is moved (C1 b)", async () => {
    // The Project as an older build left it: the user's own Agent under the id, without the key.
    await fs.rm(agentDir(t.root, P, SYSTEM_AGENT_ID), { recursive: true, force: true });
    await loadAgentState({
      root: t.root,
      projectId: P,
      agentId: SYSTEM_AGENT_ID,
      init: { preset: { name: "Mine" } },
    });
    const theirs = await configOnDisk();

    const listed = (await list()).find((a) => a.agentId === SYSTEM_AGENT_ID);
    expect(listed).toMatchObject({ name: "Mine" });
    expect(listed?.system).toBeUndefined();
    expect(await configOnDisk()).toBe(theirs);
    expect((await owner.put(`${system}/config`, { config: { name: "Still mine" } })).status).toBe(
      200,
    );

    expect((await owner.delete(system)).status).toBe(202);
    const after = (await list()).find((a) => a.agentId === SYSTEM_AGENT_ID);
    expect(after?.system).toBe(true);
  });
});
