/**
 * Deleting an organization, with and without its Agents, over the real app on a real temp root
 * (DELETE /api/projects/:p/organizations/:orgId[?deleteAgents=1]).
 *
 * - Given an organization employing its CEO, a developer, an Agent another organization also
 *   employs and the built-in `default_agent`, with a chart entry whose Agent is gone, when its
 *   owner deletes it with `deleteAgents=1`: the CEO and the developer are deleted for good (off
 *   the Agent list, their Sessions with them), the shared Agent and `default_agent` are kept
 *   with their reasons, the gone entry is in no list, and the organization is in the Project's
 *   trash and off the organization list.
 * - Given one employee whose folder cannot be moved, it is reported as failed with
 *   `agent_folder_busy` and still listed, while the others are deleted.
 * - Given the organization deleted without the flag, every employee stays an Agent, the report
 *   lists nothing, and a later delete of an employee's Agent goes through at once (no 409).
 * - Given an organization that does not exist, the delete answers 404 and deletes no Agent.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentDir } from "@prismshadow/penguin-core";
import type {
  AgentsResponse,
  OrganizationDeleteResponse,
  OrganizationsResponse,
} from "../src/api/types.js";
import { ORG_CONFIG_DEFAULTS } from "../src/organization/files.js";
import { OrgStore, TRASH_DIR } from "../src/organization/store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "olivia-default_project";
/** Permission bits do not stop root, and mean something else on Windows. */
const permissionsHold = process.platform !== "win32" && process.getuid?.() !== 0;

describe("deleting an organization", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let store: OrgStore;
  const agentsPath = `/api/projects/${PROJECT}/agents`;
  const orgsPath = `/api/projects/${PROJECT}/organizations`;

  beforeAll(async () => {
    t = await createTestApp();
    t.deps.serverSettingsRepo.setCompanyMode(true);
    api = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
    store = new OrgStore(t.deps.config.root);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  async function createAgents(...agentIds: string[]): Promise<void> {
    for (const agentId of agentIds) {
      expect((await api.post(agentsPath, { agentId })).status).toBe(201);
    }
  }

  /** An organization as its files describe it: the CEO, and everyone else reporting to it. */
  async function writeOrg(orgId: string, reports: string[]): Promise<void> {
    const dir = store.dir(PROJECT, orgId);
    await store.createLayout(dir);
    await store.writeConfig(dir, {
      ...ORG_CONFIG_DEFAULTS,
      name: orgId.toUpperCase(),
      mission: "Ship the site",
      timezone: "UTC",
      createdBy: "olivia",
    });
    const ceo = `${orgId}_ceo`;
    await store.writeChart(dir, {
      employees: [
        { agentId: ceo, title: "CEO", reportsTo: null, workspace: "." },
        ...reports.map((agentId) => ({
          agentId,
          title: "Engineer",
          reportsTo: ceo,
          workspace: ".",
        })),
      ],
    });
  }

  async function listed(): Promise<string[]> {
    const res = await api.get(agentsPath);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentsResponse).agents.map((a) => a.agentId);
  }

  async function organizations(): Promise<string[]> {
    const res = await api.get(orgsPath);
    expect(res.status).toBe(200);
    return ((await res.json()) as OrganizationsResponse).organizations.map((o) => o.orgId);
  }

  async function deleteOrg(
    orgId: string,
    query = "?deleteAgents=1",
  ): Promise<OrganizationDeleteResponse> {
    const res = await api.delete(`${orgsPath}/${orgId}${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as OrganizationDeleteResponse;
  }

  function insertSession(sessionId: string, agentId: string): void {
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId: PROJECT,
      agentId,
      provider: "custom",
      modelId: "m-org",
      workspace: "/tmp",
      approvalMode: "allow-all",
      title: null,
      client: "org",
      createdAt: "2026-11-04T09:00:00.000Z",
      lastActiveAt: "2026-11-04T09:00:00.000Z",
    });
  }

  it("deletes the Agents it alone employs, keeps the shared and built-in ones, and trashes the organization", async () => {
    await createAgents("acme_ceo", "acme_dev", "shared_writer");
    await writeOrg("acme", ["acme_dev", "shared_writer", "default_agent", "acme_gone"]);
    await writeOrg("north", ["shared_writer"]);
    const desk = "session-2026-11-04-09-00-00-0abc0001";
    insertSession(desk, "acme_dev");

    const report = await deleteOrg("acme");

    expect(report.orgId).toBe("acme");
    expect(report.deletedAgents.map((d) => d.agentId).sort()).toEqual(["acme_ceo", "acme_dev"]);
    expect(report.keptAgents).toEqual(
      expect.arrayContaining([
        { agentId: "shared_writer", reason: "employed_elsewhere" },
        { agentId: "default_agent", reason: "builtin" },
      ]),
    );
    expect(report.keptAgents).toHaveLength(2);
    expect(report.failedAgents).toEqual([]);
    const agents = await listed();
    expect(agents).not.toContain("acme_ceo");
    expect(agents).not.toContain("acme_dev");
    expect(agents).toEqual(expect.arrayContaining(["shared_writer", "default_agent"]));
    expect(t.deps.sessionsRepo.findById(desk)).toBeNull();
    expect(await organizations()).toEqual(["north"]);
    const trash = await fs.readdir(path.join(path.dirname(store.dir(PROJECT, "acme")), TRASH_DIR));
    expect(trash.some((name) => name.startsWith("acme-"))).toBe(true);
  });

  it.skipIf(!permissionsHold)(
    "reports an employee whose folder cannot be moved as failed, and deletes the others",
    async () => {
      await createAgents("gamma_ceo", "gamma_ops");
      await writeOrg("gamma", ["gamma_ops"]);
      const pinned = agentDir(t.deps.config.root, PROJECT, "gamma_ops");
      // A folder nobody may write to cannot be moved to another parent: its `..` would change.
      await fs.chmod(pinned, 0o555);
      // The move is retried on a busy folder before it gives up; the clock is advanced instead
      // of waited for.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let report: OrganizationDeleteResponse;
      try {
        let settled = false;
        const pending = deleteOrg("gamma").finally(() => {
          settled = true;
        });
        while (!settled) {
          await vi.advanceTimersByTimeAsync(100);
          await new Promise((resolve) => setImmediate(resolve));
        }
        report = await pending;
      } finally {
        vi.useRealTimers();
        await fs.chmod(pinned, 0o755);
      }

      expect(report.deletedAgents.map((d) => d.agentId)).toEqual(["gamma_ceo"]);
      expect(report.failedAgents).toEqual([
        expect.objectContaining({ agentId: "gamma_ops", code: "agent_folder_busy" }),
      ]);
      const agents = await listed();
      expect(agents).toContain("gamma_ops");
      expect(agents).not.toContain("gamma_ceo");
      expect(await organizations()).not.toContain("gamma");
    },
  );

  it("keeps every employee without the flag, and lets each be deleted at once afterwards", async () => {
    await createAgents("beta_ceo", "beta_dev");
    await writeOrg("beta", ["beta_dev"]);
    // While employed, the Agent route refuses.
    expect((await api.delete(`${agentsPath}/beta_dev`)).status).toBe(409);

    const report = await deleteOrg("beta", "");

    expect(report).toEqual({ orgId: "beta", deletedAgents: [], keptAgents: [], failedAgents: [] });
    expect(await listed()).toEqual(expect.arrayContaining(["beta_ceo", "beta_dev"]));
    expect(await organizations()).not.toContain("beta");
    expect((await api.delete(`${agentsPath}/beta_dev`)).status).toBe(202);
    expect(await listed()).not.toContain("beta_dev");
  });

  it("answers 404 for an organization that does not exist, and deletes no Agent", async () => {
    const before = await listed();
    const res = await api.delete(`${orgsPath}/nowhere?deleteAgents=1`);
    expect(res.status).toBe(404);
    expect(await listed()).toEqual(before);
  });
});
