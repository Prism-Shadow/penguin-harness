/**
 * Deleting an Agent that an organization employs, over the real app. The organizations are
 * written straight to disk as their files describe them; no runtime pass and no LLM are
 * needed, except for the leave, which goes through the real organization route.
 *
 * - Given an Agent in an organization's chart, when its owner deletes it, the answer is 409
 *   `agent_employed` naming the organization and the title, and the Agent, its config and its
 *   Sessions are all still there.
 * - Given a paused organization, its employees are protected the same way.
 * - Given an organization whose chart does not parse, its CEO is still protected.
 * - Given an Agent no organization employs, the delete goes through as before.
 * - Given an employee that has left its organization, its Agent deletes.
 * - The Agent list marks each employee with the organizations that employ it, and an Agent
 *   that is no employee carries no mark.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentsResponse, OrgStatus } from "../src/api/types.js";
import { ORG_CONFIG_DEFAULTS } from "../src/organization/files.js";
import type { OrgEmployee } from "../src/organization/files.js";
import { OrgStore } from "../src/organization/store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "olivia-default_project";

describe("deleting an Agent an organization employs", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let store: OrgStore;
  let sessionSeq = 0;

  beforeAll(async () => {
    t = await createTestApp();
    // The leave route is a company-mode route: the admin master switch has to be on.
    t.deps.serverSettingsRepo.setCompanyMode(true);
    api = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
    store = new OrgStore(t.deps.config.root);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  const agentsPath = `/api/projects/${PROJECT}/agents`;

  async function createAgent(agentId: string): Promise<void> {
    expect((await api.post(agentsPath, { agentId })).status).toBe(201);
  }

  /** One Session of the Agent, as any conversation with it would leave behind. */
  function insertSession(agentId: string): string {
    sessionSeq += 1;
    const sessionId = `session-2026-10-10-09-00-00-0abc${String(sessionSeq).padStart(4, "0")}`;
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId: PROJECT,
      agentId,
      provider: "custom",
      modelId: "m-dev",
      workspace: "/tmp",
      approvalMode: "allow-all",
      title: null,
      client: "web",
      createdAt: "2026-10-10T09:00:00.000Z",
      lastActiveAt: "2026-10-10T09:00:00.000Z",
    });
    return sessionId;
  }

  /** An organization as its files describe it: a config, and a chart (or a broken one). */
  async function writeOrg(
    orgId: string,
    opts: { name: string; status?: OrgStatus; employees?: OrgEmployee[]; brokenChart?: true },
  ): Promise<void> {
    const dir = store.dir(PROJECT, orgId);
    await store.createLayout(dir);
    await store.writeConfig(dir, {
      ...ORG_CONFIG_DEFAULTS,
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      name: opts.name,
      mission: "Ship the site",
      timezone: "UTC",
      createdBy: "olivia",
    });
    if (opts.brokenChart === true) {
      await fs.writeFile(path.join(dir, "org_chart.yaml"), "employees: [unclosed\n", "utf8");
    } else {
      await store.writeChart(dir, { employees: opts.employees ?? [] });
    }
  }

  const ceo = (orgId: string): OrgEmployee => ({
    agentId: `${orgId}_ceo`,
    title: "CEO",
    reportsTo: null,
    workspace: "ceo",
  });

  async function deleteAgent(agentId: string) {
    const res = await api.delete(`${agentsPath}/${agentId}`);
    const body =
      res.status === 204
        ? null
        : ((await res.json()) as { error: { code: string; message: string } });
    return { status: res.status, error: body?.error };
  }

  async function listAgents(): Promise<AgentsResponse["agents"]> {
    const res = await api.get(agentsPath);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentsResponse).agents;
  }

  it("refuses to delete an employee's Agent, naming the organization and the title, and keeps everything", async () => {
    await createAgent("acme_ceo");
    await createAgent("acme_writer");
    await writeOrg("acme", {
      name: "Acme Docs",
      employees: [
        ceo("acme"),
        { agentId: "acme_writer", title: "Writer", reportsTo: "acme_ceo", workspace: "writer" },
      ],
    });
    const sessionId = insertSession("acme_writer");

    const refused = await deleteAgent("acme_writer");
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("agent_employed");
    expect(refused.error?.message).toContain('"Acme Docs" (acme)');
    expect(refused.error?.message).toContain("Writer");

    // Nothing was touched: the Agent is listed, its config reads, its Session is indexed.
    expect((await listAgents()).map((a) => a.agentId)).toContain("acme_writer");
    expect((await api.get(`${agentsPath}/acme_writer/config`)).status).toBe(200);
    expect(t.deps.sessionsRepo.findById(sessionId)).not.toBeNull();
  });

  it("protects the employees of a paused organization too", async () => {
    await createAgent("dormant_ceo");
    await createAgent("dormant_clerk");
    await writeOrg("dormant", {
      name: "Dormant",
      status: "paused",
      employees: [
        ceo("dormant"),
        { agentId: "dormant_clerk", title: "Clerk", reportsTo: "dormant_ceo", workspace: "clerk" },
      ],
    });

    const refused = await deleteAgent("dormant_clerk");
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("agent_employed");
  });

  it("still protects the CEO of an organization whose chart does not parse", async () => {
    await createAgent("broken_ceo");
    await writeOrg("broken", { name: "Broken", brokenChart: true });

    const refused = await deleteAgent("broken_ceo");
    expect(refused.status).toBe(409);
    expect(refused.error?.message).toContain('"Broken" (broken) as CEO');
    expect((await listAgents()).map((a) => a.agentId)).toContain("broken_ceo");
  });

  it("deletes an Agent no organization employs, as before", async () => {
    await createAgent("solo_helper");
    const sessionId = insertSession("solo_helper");

    expect((await deleteAgent("solo_helper")).status).toBe(204);
    expect((await listAgents()).map((a) => a.agentId)).not.toContain("solo_helper");
    expect(t.deps.sessionsRepo.findById(sessionId)).toBeNull();
  });

  it("deletes the Agent once the employee has left its organization", async () => {
    await createAgent("leaving_ceo");
    await createAgent("leaving_temp");
    await writeOrg("leaving", {
      name: "Leaving",
      employees: [
        ceo("leaving"),
        { agentId: "leaving_temp", title: "Temp", reportsTo: "leaving_ceo", workspace: "temp" },
      ],
    });
    expect((await deleteAgent("leaving_temp")).status).toBe(409);

    const left = await api.delete(
      `/api/projects/${PROJECT}/organizations/leaving/employees/leaving_temp`,
    );
    expect(left.status).toBeLessThan(300);

    expect((await deleteAgent("leaving_temp")).status).toBe(204);
    expect((await listAgents()).map((a) => a.agentId)).not.toContain("leaving_temp");
  });

  it("marks each employee in the Agent list with the organizations that employ it", async () => {
    await createAgent("shared_analyst");
    await createAgent("north_ceo");
    await createAgent("south_ceo");
    await writeOrg("north", {
      name: "North",
      employees: [
        ceo("north"),
        { agentId: "shared_analyst", title: "Analyst", reportsTo: "north_ceo", workspace: "a" },
      ],
    });
    await writeOrg("south", {
      name: "South",
      status: "paused",
      employees: [
        ceo("south"),
        { agentId: "shared_analyst", title: "Auditor", reportsTo: "south_ceo", workspace: "a" },
      ],
    });
    await createAgent("plain_helper");

    const byId = new Map((await listAgents()).map((a) => [a.agentId, a]));
    expect(byId.get("shared_analyst")?.employments).toEqual([
      { orgId: "north", orgName: "North", title: "Analyst", status: "active" },
      { orgId: "south", orgName: "South", title: "Auditor", status: "paused" },
    ]);
    expect(byId.get("north_ceo")?.employments).toEqual([
      { orgId: "north", orgName: "North", title: "CEO", status: "active" },
    ]);
    expect(byId.get("plain_helper")).not.toHaveProperty("employments");

    // An Agent serving two organizations names both when it is refused.
    const refused = await deleteAgent("shared_analyst");
    expect(refused.error?.message).toContain('"North" (north) as Analyst');
    expect(refused.error?.message).toContain('"South" (south) as Auditor');
  });
});
