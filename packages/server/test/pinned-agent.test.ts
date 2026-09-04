/**
 * Pinned-agent mode (PENGUIN_PINNED_AGENT): the server serves exactly one Agent, refuses every
 * route that would create, import, delete or redefine one — for everyone, the admin included —
 * and provisions a new user into the pinned Project instead of giving them their own.
 *
 * What stays open is as load-bearing as what closes: reads, Sessions on the pinned Agent, the
 * vault, Memory, Project rename and member management all keep working, because a pinned server
 * is a deployment of one agent rather than a frozen install.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  AgentsResponse,
  MeResponse,
  ProjectsResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";
const PINNED = "pinned_one";

describe("pinned agent", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  /** /api/projects/default_project/agents/pinned_one */
  let url: string;

  beforeEach(async () => {
    t = await createTestApp({ config: { pinnedAgent: { projectId: PROJECT, agentId: PINNED } } });
    // The route that would create this Agent is the one pinned mode refuses; the service under
    // it is not, which is exactly how the container's entrypoint gets the Agent in place.
    await t.deps.agentService.createAgent(PROJECT, PINNED, "Pinned");
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    url = `/api/projects/${PROJECT}/agents/${PINNED}`;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** Every refusal carries the same code, so the client can localize one message. */
  async function expectPinned(res: Response): Promise<void> {
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("agent_pinned");
  }

  it("announces itself on /api/me so the client stops offering what the server refuses", async () => {
    const me = (await (await admin.get("/api/me")).json()) as MeResponse;
    expect(me.pinnedAgent).toEqual({ projectId: PROJECT, agentId: PINNED });
  });

  it("lists the pinned Agent alone; the seeded default_agent stays on disk but invisible", async () => {
    const res = (await (
      await admin.get(`/api/projects/${PROJECT}/agents`)
    ).json()) as AgentsResponse;
    expect(res.agents.map((a) => a.agentId)).toEqual([PINNED]);
    // It is still there — pinning hides and refuses, it never deletes.
    await expect(
      fs.stat(path.join(agentStateDir(t.root, PROJECT, "default_agent"), "system_config.yaml")),
    ).resolves.toBeTruthy();
  });

  it("refuses creating, importing and deleting an Agent, to the admin as much as anyone", async () => {
    await expectPinned(await admin.post(`/api/projects/${PROJECT}/agents`, { agentId: "second" }));
    await expectPinned(
      await admin.post(`/api/projects/${PROJECT}/agents/import`, { dataBase64: "e30=" }),
    );
    await expectPinned(await admin.delete(url));
  });

  it("refuses every write to the definition, and keeps every read of it", async () => {
    expect((await admin.get(`${url}/config`)).status).toBe(200);
    await expectPinned(await admin.put(`${url}/config`, { agentsMd: "# rewritten\n" }));
    await expectPinned(await admin.post(`${url}/config/kernel-update`, {}));
    await expectPinned(await admin.post(`${url}/config/reset`, {}));

    // All four placeholder routes write system_config.yaml through the same service call.
    for (const feature of ["memory", "vault", "skills", "schedules"]) {
      await expectPinned(await admin.post(`${url}/${feature}/template-placeholder`, {}));
    }

    expect((await admin.get(`${url}/skills`)).status).toBe(200);
    await expectPinned(await admin.post(`${url}/skills/archive`, { dataBase64: "e30=" }));
    await expectPinned(await admin.delete(`${url}/skills/anything`));

    expect((await admin.get(`${url}/hooks`)).status).toBe(200);
    await expectPinned(await admin.post(`${url}/plugins`, { names: ["goal"] }));
    await expectPinned(await admin.delete(`${url}/hooks/goal`));

    expect((await admin.get(`${url}/export`)).status).toBe(200);
    await expectPinned(await admin.post(`${url}/import`, { dataBase64: "e30=" }));

    expect((await admin.get(`${url}/schedules`)).status).toBe(200);
    await expectPinned(await admin.post(`${url}/schedules`, { name: "nightly" }));
    await expectPinned(await admin.put(`${url}/schedules/nightly`, {}));
    await expectPinned(await admin.delete(`${url}/schedules/nightly`));
  });

  it("keeps the vault and Memory writable: they are runtime data, not the definition", async () => {
    expect(
      (await admin.put(`${url}/vault`, { entries: [{ key: "API_KEY", value: "v" }] })).status,
    ).toBe(200);
    expect((await admin.get(`${url}/memory`)).status).toBe(200);
  });

  it("refuses creating and deleting Projects, and keeps rename", async () => {
    await expectPinned(await admin.post("/api/projects", { projectId: "another" }));
    await expectPinned(await admin.delete(`/api/projects/${PROJECT}`));
    expect((await admin.patch(`/api/projects/${PROJECT}`, { name: "Renamed" })).status).toBe(200);
  });

  it("serves Sessions on the pinned Agent and 404s the hidden one", async () => {
    await admin.put(`/api/projects/${PROJECT}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    expect((await admin.post(`${url}/sessions`, {})).status).toBe(201);
    // 404 rather than 403: answering "forbidden" would advertise that default_agent exists.
    const hidden = await admin.post(`/api/projects/${PROJECT}/agents/default_agent/sessions`, {});
    expect(hidden.status).toBe(404);
  });

  it("refuses a Workspace inside the pinned Agent's own state directory", async () => {
    await admin.put(`/api/projects/${PROJECT}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    const stateDir = agentStateDir(t.root, PROJECT, PINNED);
    // Without this the file tools would reach the locked definition through a Workspace, which
    // is a write path none of the route guards above ever sees.
    await expectPinned(await admin.post(`${url}/sessions`, { workspace: stateDir }));
    await expectPinned(
      await admin.post(`${url}/sessions`, { workspace: path.join(stateDir, "skills") }),
    );
    // A Workspace elsewhere is unaffected.
    const elsewhere = path.join(t.root, "scratch");
    await fs.mkdir(elsewhere, { recursive: true });
    expect((await admin.post(`${url}/sessions`, { workspace: elsewhere })).status).toBe(201);
  });

  it("provisions a new user into the pinned Project instead of one carrying a second Agent", async () => {
    const user = await provisionUser(t.app, "alice");
    const alice = apiClient(t.app, user.cookie);
    const res = (await (await alice.get("/api/projects")).json()) as ProjectsResponse;
    expect(res.projects).toHaveLength(1);
    expect(res.projects[0]).toMatchObject({ projectId: PROJECT, role: "member" });
    // The Project that would otherwise have been created — and the default_agent inside it.
    await expect(fs.stat(path.join(t.root, `alice-${PROJECT}`))).rejects.toThrow();
    // She sees the one Agent, and no more than the admin does.
    const agents = (await (
      await alice.get(`/api/projects/${PROJECT}/agents`)
    ).json()) as AgentsResponse;
    expect(agents.agents.map((a) => a.agentId)).toEqual([PINNED]);
  });
});

describe("unpinned server", () => {
  let t: TestApp;

  afterEach(async () => {
    await t.cleanup();
  });

  it("keeps every route the pinned one refuses, and reports a null pinnedAgent", async () => {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(((await (await admin.get("/api/me")).json()) as MeResponse).pinnedAgent).toBeNull();
    expect(
      (await admin.post(`/api/projects/${PROJECT}/agents`, { agentId: "second" })).status,
    ).toBe(201);
    const agents = (await (
      await admin.get(`/api/projects/${PROJECT}/agents`)
    ).json()) as AgentsResponse;
    expect(agents.agents.map((a) => a.agentId).sort()).toEqual(["default_agent", "second"]);
  });
});
