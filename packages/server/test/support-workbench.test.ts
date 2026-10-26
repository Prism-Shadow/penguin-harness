/**
 * Given a fresh default Project, its support Agent contributes a working tab without setup.
 * Given persisted in-progress tickets, GET reconciles final answers once; failed/foreign jobs
 * never receive an older or another Project's answer. Reload preserves the ticket history.
 * Given an ordinary Agent, plugin install exposes a tab; update preserves records and uninstall removes it.
 * Given a conflicting workbench, plugin install returns 409 without installing its Skill.
 * Given answered tickets, resolve/reopen preserves messages; malformed follow-ups do not write.
 * Session titles arrive independently of answers; changing a Session title updates the saved question.
 * Updating a plugin with an older authoring contract checks its replacement code against this host.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, loginAdmin, writeTraceFile, type TestApp } from "./helpers.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
const BASE = "/api/projects/default_project/agents/penguin_support/workbenches/support";
const message = (role: string, text: string): AmspRecord =>
  ({
    timestamp: "2026-10-14T00:00:00Z",
    type: "model_msg",
    payload: { type: "text", role, text },
  }) as AmspRecord;
interface Ticket {
  id: string;
  title: string;
  status: string;
  messages: Array<{ role: string; text: string }>;
  error: string | null;
}
describe("built-in support workbench", { timeout: 30000 }, () => {
  let t: TestApp, admin: ReturnType<typeof apiClient>;
  const ids = [uniqueSessionId(), uniqueSessionId(), uniqueSessionId()];
  beforeAll(async () => {
    t = await createTestApp({
      beforeSeed: async (root) => {
        const dir = path.join(root, "default_project/agents/penguin_support/workbenches/support");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "state.json"),
          JSON.stringify({
            tickets: ids.map((sessionId, i) => ({
              id: String(i),
              title: "Question " + i,
              category: "general",
              status: "running",
              sessionId,
              messages: [{ role: "user", text: "How?", at: "2026-10-14T00:00:00Z" }],
              error: null,
              createdAt: "2026-10-14T00:00:00Z",
              updatedAt: "2026-10-14T00:00:00Z",
            })),
          }),
        );
      },
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    for (let i = 0; i < ids.length; i++)
      adoptSession(t.deps, fakeSession(ids[i]!), {
        projectId: i === 2 ? "foreign" : "default_project",
        agentId: "penguin_support",
      });
    await writeTraceFile(t.root, "default_project", "penguin_support", "2026-09-01", ids[0]!, 1, [
      message("user", "How?"),
      message("assistant", "Read [the docs](https://penguin.ooo/docs/)."),
    ]);
    await writeTraceFile(t.root, "default_project", "penguin_support", "2026-09-01", ids[1]!, 1, [
      message("user", "old"),
      message("assistant", "old answer"),
      message("user", "new question"),
    ]);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  const tickets = async () => {
    const response = await admin.get(`${BASE}/api/tickets`);
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { tickets: Ticket[] }).tickets;
  };
  it("loads a ready-to-use support tab in the default Project", async () => {
    const res = await admin.get(BASE.slice(0, -"/support".length));
    const body = (await res.json()) as {
      workbenches: Array<{ error: string | null; tabs: Array<{ key: string }> }>;
    };
    expect(body.workbenches[0]?.error).toBeNull();
    expect(body.workbenches[0]?.tabs.map((t) => t.key)).toEqual(["support"]);
    expect((await admin.get(`${BASE}/ui/index.html`)).status).toBe(200);
    expect(
      (await admin.delete("/api/projects/default_project/agents/penguin_support")).status,
    ).toBe(409);
  });
  it("recovers persisted jobs once and keeps failures isolated across reloads", async () => {
    const first = await tickets();
    expect(first[0]).toMatchObject({
      status: "answered",
      messages: [
        { role: "user", text: "How?" },
        { role: "assistant", text: "Read [the docs](https://penguin.ooo/docs/)." },
      ],
    });
    expect(first[1]).toMatchObject({
      status: "failed",
      messages: [{ role: "user", text: "How?" }],
    });
    expect(first[2]).toMatchObject({
      status: "failed",
      messages: [{ role: "user", text: "How?" }],
    });
    expect(first[2]!.error).toContain("this Project has no Session");
    expect(await tickets()).toEqual(first);
    expect((await admin.post(`${BASE}/reload`)).status).toBe(200);
    expect(await tickets()).toEqual(first);
  });
  it("resolves and reopens a ticket without losing messages or accepting empty follow-ups", async () => {
    const before = (await tickets())[0]!;
    expect((await admin.post(`${BASE}/api/tickets/0`, { action: "resolve" })).status).toBe(200);
    expect((await tickets())[0]).toMatchObject({ status: "resolved", messages: before.messages });
    expect((await admin.post(`${BASE}/api/tickets/0`, { action: "reopen" })).status).toBe(200);
    expect((await tickets())[0]).toMatchObject({ status: "open", messages: before.messages });
    expect((await admin.post(`${BASE}/api/tickets/0`, { text: "  " })).status).toBe(400);
    expect((await admin.post(`${BASE}/api/tickets/0`, { action: "retry" })).status).toBe(409);
    expect((await tickets())[0]).toMatchObject({ status: "open", messages: before.messages });
    expect((await admin.post(`${BASE}/api/tickets`, { title: "Missing question" })).status).toBe(
      400,
    );
    expect(await tickets()).toHaveLength(3);
  });
  it("follows Session title changes without losing messages or another Project's title", async () => {
    const before = await tickets();
    t.deps.sessionsRepo.updateTitle(ids[0]!, "Opening an Agent Workbench");
    t.deps.sessionsRepo.updateTitle(ids[2]!, "Private title from another Project");
    const changed = await tickets();
    expect(changed[0]).toMatchObject({
      title: "Opening an Agent Workbench",
      messages: before[0]!.messages,
    });
    expect(changed[2]!.title).toBe(before[2]!.title);
    t.deps.sessionsRepo.updateTitle(ids[0]!, "Renamed by the user");
    expect((await tickets())[0]!.title).toBe("Renamed by the user");
  });
  it("installs and updates the support plugin on an ordinary Agent, preserving its tickets", async () => {
    const agent = "/api/projects/default_project/agents/plugin_support";
    expect(
      (await admin.post("/api/projects/default_project/agents", { agentId: "plugin_support" }))
        .status,
    ).toBe(201);
    const install = await admin.post(`${agent}/plugins`, { names: ["penguin-support"] });
    expect(install.status).toBe(201);
    expect(await install.json()).toMatchObject({
      workbenches: [{ name: "support", plugin: "penguin-support" }],
      skills: [{ name: "penguin-support" }],
    });
    expect(await (await admin.get(`${agent}/plugins`)).json()).toMatchObject({
      workbenches: [{ name: "support", plugin: "penguin-support" }],
    });
    const list = await admin.get(`${agent}/workbenches`);
    expect(await list.json()).toMatchObject({
      workbenches: [{ error: null, tabs: [{ key: "support" }] }],
    });
    const disk = path.join(t.root, "default_project/agents/plugin_support/workbenches/support");
    const state = JSON.stringify({
      tickets: [{ id: "saved", title: "Keep", status: "resolved", messages: [] }],
    });
    await fs.writeFile(path.join(disk, "state.json"), state);
    // This installed revision predates the new host title accessor.
    const authored = path.join(disk, ".harness/plugin.d.ts");
    await fs.writeFile(
      authored,
      (await fs.readFile(authored, "utf8")).replace(/^.*sessionTitle\(.*\n/gm, ""),
    );
    await fs.writeFile(path.join(disk, "ui/app.js"), "local edit");
    expect((await admin.post(`${agent}/plugins`, { names: ["penguin-support"] })).status).toBe(201);
    expect(await (await admin.get(`${agent}/workbenches`)).json()).toMatchObject({
      workbenches: [{ error: null }],
    });
    expect(await fs.readFile(path.join(disk, "state.json"), "utf8")).toBe(state);
    expect(await fs.readFile(path.join(disk, "ui/app.js"), "utf8")).not.toBe("local edit");
    expect((await admin.delete(`${agent}/workbenches/support`)).status).toBe(204);
    expect(await (await admin.get(`${agent}/plugins`)).json()).toMatchObject({ workbenches: [] });
  });
  it("refuses a conflicting workbench without installing the support Skill", async () => {
    const agent = "/api/projects/default_project/agents/conflict_support";
    await admin.post("/api/projects/default_project/agents", { agentId: "conflict_support" });
    const dir = path.join(t.root, "default_project/agents/conflict_support/workbenches/support");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), "{}");
    expect((await admin.post(`${agent}/plugins`, { names: ["penguin-support"] })).status).toBe(409);
    expect(await (await admin.get(`${agent}/skills`)).json()).toMatchObject({ skills: [] });
  });
});
