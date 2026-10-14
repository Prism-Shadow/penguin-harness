/**
 * Given a fresh default Project, its support Agent contributes a working tab without setup.
 * Given persisted in-progress tickets, GET reconciles final answers once; failed/foreign jobs
 * never receive an older or another Project's answer. Reload preserves the ticket history.
 * Given answered tickets, resolve/reopen preserves messages; malformed follow-ups do not write.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, loginAdmin, writeTraceFile, type TestApp } from "./helpers.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
const BASE = "/api/projects/default_project/agents/penguin_support/workbenches/support";
const message = (role: string, text: string): OmniMessage =>
  ({
    timestamp: "2026-10-14T00:00:00Z",
    type: "model_msg",
    payload: { type: "text", role, text, stop_reason: "completed" },
  }) as OmniMessage;
interface Ticket {
  id: string;
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
});
