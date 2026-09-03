/**
 * Organization routes over the real app: the admin master switch 404s the whole group and
 * is reported by /api/me and /api/admin/settings; Project authorization gates reads and
 * writes (an outsider gets 404, a member may write, only the owner may delete); bodies are
 * validated before the service is asked; and the calling session rides write bodies as
 * `sessionId`. The service itself is a recording fake here — its semantics have their own
 * suites — so no Agent is created and no session runs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, ServerSettingsResponse } from "../src/api/types.js";
import type { OrganizationService } from "../src/runtime/organization/service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

type Call = { method: string; args: unknown[] };

function fakeService(calls: Call[]): OrganizationService {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_target, method) => {
      if (typeof method !== "string") return undefined;
      return async (...args: unknown[]) => {
        calls.push({ method, args });
        switch (method) {
          case "list":
            return [];
          case "detail":
          case "create":
            return { projectId: args[0], orgId: "acme", name: "Acme", employeeCount: 1 };
          case "tickets":
            return {
              columns: { proposed: [], in_progress: [], review: [], done: [], rejected: [] },
              invalidFiles: [],
            };
          case "chat":
            return { date: "2026-09-01", days: [], messages: [], unread: 0, mentionsMe: 0 };
          case "startTicket":
            return { sessionId: "session-x" };
          case "handbook":
            return "# Handbook";
          case "handbookFiles":
            return {
              files: [{ path: "README.md", size: 12, updatedAt: "2026-09-01T00:00:00.000Z" }],
            };
          case "handbookFile":
          case "writeHandbookFile":
            return { path: args[2], content: "# Doc" };
          default:
            return { ok: true, method };
        }
      };
    },
  };
  return new Proxy({}, handler) as unknown as OrganizationService;
}

describe("organization routes", () => {
  let t: TestApp;
  let calls: Call[];
  let owner: ReturnType<typeof apiClient>;
  let ownerProject: string;

  beforeEach(async () => {
    t = await createTestApp();
    calls = [];
    t.deps.orgService = fakeService(calls);
    const u = await provisionUser(t.app, "olivia");
    owner = apiClient(t.app, u.cookie);
    ownerProject = "olivia-default_project";
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("answers 404 on every route while the admin switch is off, and /api/me reports it", async () => {
    const admin = await loginAdmin(t.app);
    const adminApi = apiClient(t.app, admin.cookie);
    const before = (await (
      await adminApi.get("/api/admin/settings")
    ).json()) as ServerSettingsResponse;
    expect(before.settings.companyMode).toBe(true);
    const put = await adminApi.put("/api/admin/settings", { companyMode: false });
    expect(put.status).toBe(200);
    expect(((await put.json()) as ServerSettingsResponse).settings.companyMode).toBe(false);
    const me = (await (await owner.get("/api/me")).json()) as MeResponse;
    expect(me.companyMode).toBe(false);
    const res = await owner.get(`/api/projects/${ownerProject}/organizations`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("company_mode_off");
    expect(calls).toEqual([]);
    await adminApi.put("/api/admin/settings", { companyMode: true });
    expect((await owner.get(`/api/projects/${ownerProject}/organizations`)).status).toBe(200);
  });

  it("gates by Project access: outsiders 404, members read and write, only the owner deletes", async () => {
    const stranger = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    expect((await stranger.get(`/api/projects/${ownerProject}/organizations`)).status).toBe(404);
    expect(
      (await stranger.post(`/api/projects/${ownerProject}/organizations/acme/chat`, { text: "hi" }))
        .status,
    ).toBe(404);

    const member = await provisionUser(t.app, "mia");
    const grant = await owner.post(`/api/projects/${ownerProject}/members`, { userId: "mia" });
    expect([200, 201]).toContain(grant.status);
    const memberApi = apiClient(t.app, member.cookie);
    expect((await memberApi.get(`/api/projects/${ownerProject}/organizations`)).status).toBe(200);
    const send = await memberApi.post(`/api/projects/${ownerProject}/organizations/acme/chat`, {
      text: "hi @all",
    });
    expect(send.status).toBe(201);
    expect(calls.at(-1)).toMatchObject({
      method: "sendChat",
      args: [ownerProject, "acme", "mia", { text: "hi @all" }],
    });
    expect(
      (await memberApi.delete(`/api/projects/${ownerProject}/organizations/acme`)).status,
    ).toBe(403);
    expect((await owner.delete(`/api/projects/${ownerProject}/organizations/acme`)).status).toBe(
      204,
    );
    expect(calls.at(-1)).toMatchObject({ method: "remove", args: [ownerProject, "acme"] });
  });

  it("validates bodies before asking the service", async () => {
    const base = `/api/projects/${ownerProject}/organizations`;
    expect((await owner.post(base, { orgId: "acme" })).status).toBe(400); // mission missing
    expect(
      (await owner.post(`${base}/acme/tickets/not-an-id/move`, { status: "done" })).status,
    ).toBe(400);
    expect(
      (await owner.post(`${base}/acme/tickets/2026-09-01-site/move`, { status: "flying" })).status,
    ).toBe(400);
    expect((await owner.post(`${base}/acme/employees`, { title: "HR" })).status).toBe(400); // reportsTo missing
    expect(
      (
        await owner.post(`${base}/acme/calendar`, {
          agentId: "acme_hr",
          name: "bad name",
          prompt: "x",
          enabled: true,
          startAt: "now",
        })
      ).status,
    ).toBe(400);
    expect((await owner.get(`${base}/acme/chat?date=yesterday`)).status).toBe(400);
    expect((await owner.get(`${base}/acme/finance?period=2026-9`)).status).toBe(400);
    expect(calls).toEqual([]);
    const create = await owner.post(base, {
      orgId: "acme",
      mission: "Build a marketplace",
      name: "Acme",
    });
    expect(create.status).toBe(201);
    expect(calls.at(-1)).toMatchObject({
      method: "create",
      args: [
        ownerProject,
        { orgId: "acme", mission: "Build a marketplace", name: "Acme" },
        "olivia",
      ],
    });
  });

  it("routes handbook documents by their relative path and keeps the index", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme/handbook`;
    expect((await owner.get(`${base}/files`)).status).toBe(200);
    expect(calls.at(-1)).toEqual({ method: "handbookFiles", args: [ownerProject, "acme"] });

    const doc = "decisions/2026-09-02-hire-plan.md";
    expect((await owner.get(`${base}/files/${doc}`)).status).toBe(200);
    expect(calls.at(-1)).toEqual({ method: "handbookFile", args: [ownerProject, "acme", doc] });

    const put = await owner.put(`${base}/files/${doc}`, { content: "# Hire plan" });
    expect(put.status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "writeHandbookFile",
      args: [ownerProject, "acme", doc, "# Hire plan"],
    });
    expect((await owner.put(`${base}/files/${doc}`, {})).status).toBe(400); // content missing

    expect((await owner.delete(`${base}/files/${doc}`)).status).toBe(204);
    expect(calls.at(-1)).toEqual({
      method: "deleteHandbookFile",
      args: [ownerProject, "acme", doc],
    });
  });

  it("passes the calling session through write bodies so the file records the employee", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme/tickets/2026-09-01-site`;
    const res = await owner.post(`${base}/progress`, {
      text: "half done",
      sessionId: "session-desk",
    });
    expect(res.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "progressTicket",
      args: [
        ownerProject,
        "acme",
        "2026-09-01-site",
        "half done",
        { userId: "olivia", sessionId: "session-desk" },
      ],
    });
    const start = await owner.post(`${base}/start`, { agentId: "acme_dev", message: "go" });
    expect(start.status).toBe(202);
    expect(await start.json()).toEqual({ sessionId: "session-x" });
    const block = await owner.post(`${base}/block`, { reason: "waiting", by: "user:olivia" });
    expect(block.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "blockTicket",
      args: [
        ownerProject,
        "acme",
        "2026-09-01-site",
        "waiting",
        "user:olivia",
        { userId: "olivia" },
      ],
    });
    const unblock = await owner.post(`${base}/unblock`);
    expect(unblock.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "unblockTicket" });
  });
});
