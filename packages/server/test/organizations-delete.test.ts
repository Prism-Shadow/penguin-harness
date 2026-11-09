/**
 * Deleting an organization, with and without its Agents, over the real app on a real temp root
 * (DELETE /api/projects/:p/organizations/:orgId[?deleteAgents=1&agentIds=a,b]).
 *
 * - Given an organization employing its CEO, a developer, an Agent another organization also
 *   employs and the built-in `default_agent`, with a chart entry whose Agent is gone, when its
 *   owner deletes it listing the CEO and the developer: those two are deleted for good (off the
 *   Agent list, their Sessions with them), the shared Agent and `default_agent` are kept with
 *   their reasons, the gone entry is in no list, and the organization is in the Project's trash
 *   and off the organization list.
 * - Given the list read before a hire and a second employment: an employee the caller did not
 *   list is kept as `not_confirmed`, and a listed one another organization has employed since is
 *   kept as `employed_elsewhere`; only the rest are deleted.
 * - Given a listed id that is no employee of this organization — an Agent nobody employs, an
 *   employee of another organization — it is ignored: still listed, and in no report list.
 * - Given another organization whose chart does not parse, the Agent list names it, and no
 *   employee is deleted: each is kept as `employment_unknown`, naming that organization.
 * - Given one employee whose folder cannot be moved, it is reported as failed with
 *   `agent_folder_busy` and still listed, while the others are deleted.
 * - Given `deleteAgents=1` without `agentIds`, the delete is refused with 400 and nothing goes,
 *   the organization included.
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
import { orgChartPath } from "../src/organization/paths.js";
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

  async function listedAgents(): Promise<string[]> {
    const res = await api.get(agentsPath);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentsResponse).agents.map((a) => a.agentId);
  }

  async function organizations(): Promise<string[]> {
    const res = await api.get(orgsPath);
    expect(res.status).toBe(200);
    return ((await res.json()) as OrganizationsResponse).organizations.map((o) => o.orgId);
  }

  /** The delete as the confirmation sends it: `agentIds` are the Agents it listed (null: none asked for). */
  async function deleteOrg(
    orgId: string,
    agentIds: string[] | null,
  ): Promise<OrganizationDeleteResponse> {
    const query = agentIds === null ? "" : `?deleteAgents=1&agentIds=${agentIds.join(",")}`;
    const res = await api.delete(`${orgsPath}/${orgId}${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as OrganizationDeleteResponse;
  }

  const sortedKept = (report: OrganizationDeleteResponse) =>
    [...report.keptAgents].sort((a, b) => (a.agentId < b.agentId ? -1 : 1));

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

    const report = await deleteOrg("acme", ["acme_ceo", "acme_dev"]);

    expect(report.orgId).toBe("acme");
    expect(report.deletedAgents.map((d) => d.agentId).sort()).toEqual(["acme_ceo", "acme_dev"]);
    expect(sortedKept(report)).toEqual([
      { agentId: "default_agent", reason: "builtin" },
      { agentId: "shared_writer", reason: "employed_elsewhere" },
    ]);
    expect(report.failedAgents).toEqual([]);
    const agents = await listedAgents();
    expect(agents).not.toContain("acme_ceo");
    expect(agents).not.toContain("acme_dev");
    expect(agents).toEqual(expect.arrayContaining(["shared_writer", "default_agent"]));
    expect(t.deps.sessionsRepo.findById(desk)).toBeNull();
    expect(await organizations()).toEqual(["north"]);
    const trash = await fs.readdir(path.join(path.dirname(store.dir(PROJECT, "acme")), TRASH_DIR));
    expect(trash.some((name) => name.startsWith("acme-"))).toBe(true);
  });

  it("deletes only the listed employees that still qualify, keeping a later hire and a new employment", async () => {
    await createAgents("delta_ceo", "delta_dev", "delta_new", "delta_ops");
    // The confirmation read the list when delta employed its CEO, the developer and ops, and
    // showed those three as going.
    const confirmed = ["delta_ceo", "delta_dev", "delta_ops"];
    // Before the click, delta hired one more, and another organization took ops on.
    await writeOrg("delta", ["delta_dev", "delta_ops", "delta_new"]);
    await writeOrg("south", ["delta_ops"]);

    const report = await deleteOrg("delta", confirmed);

    expect(report.deletedAgents.map((d) => d.agentId).sort()).toEqual(["delta_ceo", "delta_dev"]);
    expect(sortedKept(report)).toEqual([
      { agentId: "delta_new", reason: "not_confirmed" },
      { agentId: "delta_ops", reason: "employed_elsewhere" },
    ]);
    expect(await listedAgents()).toEqual(expect.arrayContaining(["delta_new", "delta_ops"]));
  });

  it("ignores a listed id that is no employee of this organization", async () => {
    await createAgents("iota_ceo", "loner", "rho_dev");
    await writeOrg("iota", []);
    await writeOrg("rho", ["rho_dev"]);

    const report = await deleteOrg("iota", ["iota_ceo", "loner", "rho_dev"]);

    expect(report.deletedAgents.map((d) => d.agentId)).toEqual(["iota_ceo"]);
    expect(report.keptAgents).toEqual([]);
    expect(report.failedAgents).toEqual([]);
    expect(await listedAgents()).toEqual(expect.arrayContaining(["loner", "rho_dev"]));
  });

  it("deletes no employee while another organization's chart cannot be read", async () => {
    await createAgents("omega_ceo", "omega_dev");
    await writeOrg("omega", ["omega_dev"]);
    await writeOrg("broken", []);
    const brokenChart = orgChartPath(store.dir(PROJECT, "broken"));
    await fs.writeFile(brokenChart, "employees: [\n");
    try {
      const list = (await (await api.get(agentsPath)).json()) as AgentsResponse;
      expect(list.unreadableCharts).toEqual([{ orgId: "broken", orgName: "BROKEN" }]);

      const report = await deleteOrg("omega", ["omega_ceo", "omega_dev"]);

      expect(report.deletedAgents).toEqual([]);
      expect(sortedKept(report)).toEqual([
        { agentId: "omega_ceo", reason: "employment_unknown" },
        { agentId: "omega_dev", reason: "employment_unknown" },
      ]);
      expect(report.unreadableCharts).toEqual([{ orgId: "broken", orgName: "BROKEN" }]);
      expect(await listedAgents()).toEqual(expect.arrayContaining(["omega_ceo", "omega_dev"]));
    } finally {
      // The other scenarios share this Project: an unreadable chart would keep all of theirs.
      await fs.rm(store.dir(PROJECT, "broken"), { recursive: true, force: true });
    }
  });

  it("refuses deleteAgents without the list it confirmed, before anything goes", async () => {
    await createAgents("kappa_ceo");
    await writeOrg("kappa", []);

    const res = await api.delete(`${orgsPath}/kappa?deleteAgents=1`);

    expect(res.status).toBe(400);
    expect(await organizations()).toContain("kappa");
    expect(await listedAgents()).toContain("kappa_ceo");
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
        const pending = deleteOrg("gamma", ["gamma_ceo", "gamma_ops"]).finally(() => {
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
      const agents = await listedAgents();
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

    const report = await deleteOrg("beta", null);

    expect(report).toEqual({ orgId: "beta", deletedAgents: [], keptAgents: [], failedAgents: [] });
    expect(await listedAgents()).toEqual(expect.arrayContaining(["beta_ceo", "beta_dev"]));
    expect(await organizations()).not.toContain("beta");
    expect((await api.delete(`${agentsPath}/beta_dev`)).status).toBe(202);
    expect(await listedAgents()).not.toContain("beta_dev");
  });

  it("answers 404 for an organization that does not exist, and deletes no Agent", async () => {
    const before = await listedAgents();
    const res = await api.delete(`${orgsPath}/nowhere?deleteAgents=1&agentIds=default_agent`);
    expect(res.status).toBe(404);
    expect(await listedAgents()).toEqual(before);
  });
});
