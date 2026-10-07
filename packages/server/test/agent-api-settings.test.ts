/**
 * The Agent API's management surface: the API tab's routes
 * (`/api/projects/:projectId/agents/:agentId/api`), the Agent list's mark, the deletion
 * cascades, and the admin's switch.
 *
 * Scenarios:
 * - Given a Project member, the settings read back (off, keyed, allow-all, no keys for an Agent
 *   never configured); changing them — the switch, keyless access, the approval mode, a key —
 *   is the owner's alone, and a PUT with one invalid field changes nothing.
 * - Given a created key, its secret is in the create response only: the listing shows its
 *   prefix, name, creator and when it was last used — stamped by a run that authenticated
 *   with it — and never the secret; a name outside 1-64 characters is refused, and deleting a
 *   key the Agent does not have is 404.
 * - Given the Agent list, only the Agent whose switch is on carries the API mark, and a newly
 *   created Agent carries none.
 * - Given an exposed Agent deleted and created again under the same id, it starts off with no
 *   keys, and the old key opens nothing.
 * - Given a Project with keys whose owner is deleted, the deletion goes through.
 * - Given the admin, the Agent API switch reads on by default and round-trips through
 *   GET/PUT /api/admin/settings; a non-admin cannot change it.
 * - Given the admin's switch off, a Project owner who cannot read the admin settings learns it
 *   from the API tab's settings, on a read and on a write alike.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentApiKeyCreateResponse,
  AgentApiResponse,
  AgentsResponse,
  ServerSettingsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";

type Client = ReturnType<typeof apiClient>;

describe("Agent API settings", () => {
  let t: TestApp;
  let admin: Client;
  let owner: Client;
  let member: Client;
  let projectId: string;
  const tab = (agentId: string) => `/api/projects/${projectId}/agents/${agentId}/api`;
  const read = async (client: Client, agentId: string) =>
    ((await (await client.get(tab(agentId))).json()) as AgentApiResponse).api;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    owner = apiClient(t.app, (await provisionUser(t.app, "api_owner")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "api_member")).cookie);
    projectId = "api_owner-default_project";
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "api_member" })).status,
    ).toBe(201);
    for (const agentId of ["keyed_agent", "quiet_agent"]) {
      expect((await owner.post(`/api/projects/${projectId}/agents`, { agentId })).status).toBe(201);
    }
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
  });

  it("a member reads the settings, only the owner changes them (enabled, open, approval mode)", async () => {
    expect(await read(member, "default_agent")).toEqual({
      enabled: false,
      open: false,
      approvalMode: "allow-all",
      keys: [],
    });
    for (const res of [
      await member.put(tab("default_agent"), { enabled: true }),
      await member.post(`${tab("default_agent")}/keys`, { name: "mine" }),
    ]) {
      expect(res.status).toBe(403);
    }
    const put = await owner.put(tab("default_agent"), {
      enabled: true,
      open: true,
      approvalMode: "read-only",
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as AgentApiResponse).api).toMatchObject({
      enabled: true,
      open: true,
      approvalMode: "read-only",
    });
    // One invalid field and nothing is written.
    const bad = await owner.put(tab("default_agent"), {
      enabled: false,
      approvalMode: "sometimes",
    });
    expect(bad.status).toBe(400);
    expect(await read(member, "default_agent")).toMatchObject({
      enabled: true,
      open: true,
      approvalMode: "read-only",
    });
    // Omitted fields keep their value.
    await owner.put(tab("default_agent"), { open: false });
    expect(await read(owner, "default_agent")).toMatchObject({ enabled: true, open: false });
    // Someone outside the Project learns nothing.
    const stranger = apiClient(t.app, (await provisionUser(t.app, "api_stranger")).cookie);
    expect((await stranger.get(tab("default_agent"))).status).toBe(404);
    // An Agent that does not exist has no settings to read.
    expect((await owner.get(tab("ghost_agent"))).status).toBe(404);
  });

  it("creating a key returns the secret once; the listing shows the prefix and never the secret", async () => {
    await owner.put(tab("keyed_agent"), { enabled: true });
    const res = await owner.post(`${tab("keyed_agent")}/keys`, { name: "ci runner" });
    expect(res.status).toBe(201);
    const { key, secret } = (await res.json()) as AgentApiKeyCreateResponse;
    expect(secret).toMatch(/^penguin_[A-Za-z0-9_-]{43}$/);
    expect(key).toMatchObject({
      name: "ci runner",
      prefix: secret.slice(0, 16),
      createdBy: "api_owner",
      lastUsedAt: null,
    });
    const listing = await member.get(tab("keyed_agent"));
    const text = await listing.text();
    expect(text).not.toContain(secret);
    expect((JSON.parse(text) as AgentApiResponse).api.keys).toEqual([key]);

    // A run that authenticated with the key stamps it.
    const sessionId = uniqueSessionId();
    adoptSession(t.deps, fakeSession(sessionId), {
      projectId,
      agentId: "keyed_agent",
      client: "api",
    });
    const run = await t.app.request(`/api/amsp/v1/agents/${projectId}/keyed_agent/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, input: "hi" }),
    });
    expect(run.status).toBe(200);
    await run.text();
    const [used] = (await read(owner, "keyed_agent")).keys;
    expect(Number.isNaN(Date.parse(used!.lastUsedAt ?? ""))).toBe(false);

    for (const name of ["", "   ", "x".repeat(65)]) {
      expect((await owner.post(`${tab("keyed_agent")}/keys`, { name })).status).toBe(400);
    }
    const missing = await owner.delete(`${tab("keyed_agent")}/keys/not-a-key`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "key_not_found",
    );
    expect((await read(owner, "keyed_agent")).keys).toHaveLength(1);
  });

  it("the Agent list marks an enabled Agent and nothing else", async () => {
    await owner.put(tab("quiet_agent"), { enabled: true });
    await owner.put(tab("quiet_agent"), { enabled: false });
    const created = await owner.post(`/api/projects/${projectId}/agents`, { agentId: "fresh_one" });
    expect(((await created.json()) as { agent: { apiEnabled: boolean } }).agent.apiEnabled).toBe(
      false,
    );
    const { agents } = (await (
      await member.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    const marked = Object.fromEntries(agents.map((a) => [a.agentId, a.apiEnabled]));
    expect(marked).toMatchObject({
      default_agent: true,
      keyed_agent: true,
      quiet_agent: false,
      fresh_one: false,
    });
  });

  it("deleting the Agent removes its switch and keys", async () => {
    await owner.post(`/api/projects/${projectId}/agents`, { agentId: "short_lived" });
    await owner.put(tab("short_lived"), { enabled: true, open: true, approvalMode: "deny-all" });
    const { secret } = (await (
      await owner.post(`${tab("short_lived")}/keys`, { name: "k" })
    ).json()) as AgentApiKeyCreateResponse;
    expect((await owner.delete(`/api/projects/${projectId}/agents/short_lived`)).status).toBe(204);

    await owner.post(`/api/projects/${projectId}/agents`, { agentId: "short_lived" });
    expect(await read(owner, "short_lived")).toEqual({
      enabled: false,
      open: false,
      approvalMode: "allow-all",
      keys: [],
    });
    await owner.put(tab("short_lived"), { enabled: true });
    const old = await t.app.request(`/api/amsp/v1/agents/${projectId}/short_lived`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(old.status).toBe(401);
  });

  it("a Project's switches and keys go with it, so its owner's account can be deleted", async () => {
    const doomed = apiClient(t.app, (await provisionUser(t.app, "api_doomed")).cookie);
    const base = `/api/projects/api_doomed-default_project/agents/default_agent/api`;
    expect((await doomed.put(base, { enabled: true })).status).toBe(200);
    expect((await doomed.post(`${base}/keys`, { name: "k" })).status).toBe(201);
    expect((await admin.delete("/api/admin/users/api_doomed")).status).toBe(204);
    expect(
      t.deps.db
        .prepare("SELECT COUNT(*) AS n FROM agent_api_keys WHERE project_id = ?")
        .get("api_doomed-default_project"),
    ).toEqual({ n: 0 });
  });

  it("the API tab tells an owner who is no admin that the admin has the API off", async () => {
    expect((await owner.get("/api/admin/settings")).status).toBe(403);
    expect(
      ((await (await owner.get(tab("default_agent"))).json()) as AgentApiResponse).serverEnabled,
    ).toBe(true);
    await admin.put("/api/admin/settings", { agentApiEnabled: false });
    try {
      const read = (await (await member.get(tab("default_agent"))).json()) as AgentApiResponse;
      expect(read.serverEnabled).toBe(false);
      // The Agent's own switch is kept, and a write answers the same way.
      expect(read.api.enabled).toBe(true);
      const write = await owner.put(tab("default_agent"), { open: false });
      expect(((await write.json()) as AgentApiResponse).serverEnabled).toBe(false);
    } finally {
      await admin.put("/api/admin/settings", { agentApiEnabled: true });
    }
  });

  it("the admin switch round-trips through GET/PUT /api/admin/settings", async () => {
    const get = async () =>
      ((await (await admin.get("/api/admin/settings")).json()) as ServerSettingsResponse).settings;
    expect((await get()).agentApiEnabled).toBe(true);
    const off = await admin.put("/api/admin/settings", { agentApiEnabled: false });
    expect(((await off.json()) as ServerSettingsResponse).settings.agentApiEnabled).toBe(false);
    expect((await get()).agentApiEnabled).toBe(false);
    expect((await admin.put("/api/admin/settings", { agentApiEnabled: "no" })).status).toBe(400);
    expect((await owner.put("/api/admin/settings", { agentApiEnabled: true })).status).toBe(403);
    expect((await get()).agentApiEnabled).toBe(false);
    await admin.put("/api/admin/settings", { agentApiEnabled: true });
    expect((await get()).agentApiEnabled).toBe(true);
  });
});
