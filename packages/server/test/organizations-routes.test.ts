/**
 * Organization routes over the real app. The service is a recording fake — its semantics have
 * their own suites — so no Agent is created and no Session runs, except in the sessions-route
 * case, which is wiring rather than semantics.
 *
 * - The admin master switch starts off; while it is off every route answers 404
 *   company_mode_off, and /api/me and /api/admin/settings report it.
 * - Project authorization gates the group: an outsider gets 404, a member reads and writes, and
 *   only the owner deletes an organization (pausing stays a setting any writer may change).
 * - Bodies are validated before the service is asked: organizations, tickets (owner and slug
 *   included), handbook documents by their relative path, the channel family and its members.
 * - The organization's language, a ticket's owner and slug, and the channel of the path reach
 *   the service.
 * - The calling session and employee ride a read's query and a write's body only from the
 *   control environment's API token; a signed-in member's claim is dropped.
 * - The sessions route marks a desk whose Session has an enabled messaging binding, read from
 *   the real bindings table for an organization written straight to disk.
 * - The sessions route finds an employee's desk and a ticket's session, company Sessions that
 *   the employee's own session list leaves out of every category and total.
 */
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionSource } from "@prismshadow/penguin-core";
import type {
  MeResponse,
  OrgSessionsResponse,
  ServerSettingsResponse,
  SessionResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { ORG_CONFIG_DEFAULTS } from "../src/organization/files.js";
import { OrgStore } from "../src/organization/store.js";
import type { OrganizationService } from "../src/runtime/organization/service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, writeTraceFile } from "./helpers.js";
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
          case "channelMessages":
            return {
              channelId: args[3],
              date: "2026-09-01",
              days: [],
              messages: [],
              unread: 0,
              mentionsMe: 0,
            };
          case "channels":
            return { channels: [] };
          case "channel":
          case "createChannel":
          case "patchChannel":
          case "addChannelMember":
            return { channelId: "site", name: "Site", members: [] };
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

/**
 * A write as a Session's subprocess would send it: the boot's local API token as a Bearer
 * header and no cookie, which is what `controlEnv` hands the CLI (auth/api-token.ts).
 */
function fromSession(t: TestApp, apiPath: string, body: unknown) {
  return t.app.request(apiPath, {
    method: "POST",
    headers: {
      authorization: `Bearer ${t.deps.authService.localApiToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("organization routes", () => {
  let t: TestApp;
  const calls: Call[] = [];
  let owner: ReturnType<typeof apiClient>;
  const ownerProject = "olivia-default_project";

  // One app serves the group. The service is a recording fake: it goes in as a boot override,
  // since the route group takes the one the module tree provides at creation.
  beforeAll(async () => {
    t = await createTestApp({ orgService: fakeService(calls) });
    owner = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
    // The control environment's credential is the admin's: it joins the Project the CLI
    // writes to, as the Session-attribution cases below need.
    const grant = await owner.post(`/api/projects/${ownerProject}/members`, { userId: "admin" });
    expect([200, 201]).toContain(grant.status);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    calls.length = 0;
    // Company mode is off on a server nobody turned it on (its own case below): every other
    // case is about what the routes do once an admin has enabled it.
    t.deps.serverSettingsRepo.setCompanyMode(true);
  });

  it("is off on a server whose admin never touched the switch", async () => {
    const fresh = await createTestApp();
    try {
      const admin = await loginAdmin(fresh.app);
      const settings = (await (
        await apiClient(fresh.app, admin.cookie).get("/api/admin/settings")
      ).json()) as ServerSettingsResponse;
      expect(settings.settings.companyMode).toBe(false);
      const u = await provisionUser(fresh.app, "olivia");
      const api = apiClient(fresh.app, u.cookie);
      const me = (await (await api.get("/api/me")).json()) as MeResponse;
      expect(me.companyMode).toBe(false);
      const res = await api.get("/api/projects/olivia-default_project/organizations");
      expect(res.status).toBe(404);
    } finally {
      await fresh.cleanup();
    }
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

  it("gates by Project access: outsiders 404, members read and write", async () => {
    const stranger = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    expect((await stranger.get(`/api/projects/${ownerProject}/organizations`)).status).toBe(404);
    expect(
      (
        await stranger.post(
          `/api/projects/${ownerProject}/organizations/acme/channels/default_channel/messages`,
          { text: "hi" },
        )
      ).status,
    ).toBe(404);

    const member = await provisionUser(t.app, "mia");
    const grant = await owner.post(`/api/projects/${ownerProject}/members`, { userId: "mia" });
    expect([200, 201]).toContain(grant.status);
    const memberApi = apiClient(t.app, member.cookie);
    expect((await memberApi.get(`/api/projects/${ownerProject}/organizations`)).status).toBe(200);
    const send = await memberApi.post(
      `/api/projects/${ownerProject}/organizations/acme/channels/default_channel/messages`,
      { text: "hi @all" },
    );
    expect(send.status).toBe(201);
    expect(calls.at(-1)).toMatchObject({
      method: "sendChannelMessage",
      args: [ownerProject, "acme", "mia", "default_channel", { text: "hi @all" }],
    });
  });

  it("deletes an organization for the Project's owner only; pausing stays a setting", async () => {
    // A Project-level management operation, like deleting an Agent: a member who can write
    // everything else in the organization cannot make it go away.
    const path = `/api/projects/${ownerProject}/organizations/acme`;
    const mira = await provisionUser(t.app, "mira");
    await owner.post(`/api/projects/${ownerProject}/members`, { userId: "mira" });
    calls.length = 0;
    expect((await apiClient(t.app, mira.cookie).delete(path)).status).toBe(403);
    expect(calls).toEqual([]);
    expect((await owner.delete(path)).status).toBe(204);
    expect(calls.at(-1)).toEqual({ method: "delete", args: [ownerProject, "acme"] });
    const patch = await owner.patch(`/api/projects/${ownerProject}/organizations/acme`, {
      status: "paused",
    });
    expect(patch.status).toBe(200);
    // The caller rides along: a settings write is the one repair for a config that stopped
    // parsing, and the rewrite needs a `created_by` to put back into the file.
    expect(calls.at(-1)).toMatchObject({
      method: "patch",
      args: [ownerProject, "acme", { status: "paused" }, "olivia"],
    });
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
    // A calendar name the store would not list back is refused here, not written and then lost.
    for (const name of ["bad name", "_daily", "a".repeat(65)]) {
      expect(
        (
          await owner.post(`${base}/acme/calendar`, {
            agentId: "acme_hr",
            name,
            prompt: "x",
            enabled: true,
            startAt: "now",
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (await owner.get(`${base}/acme/channels/default_channel/messages?date=yesterday`)).status,
    ).toBe(400);
    expect((await owner.get(`${base}/acme/finance?period=2026-9`)).status).toBe(400);
    // A month that is not a month: the service would answer it with the current month's spend.
    expect((await owner.get(`${base}/acme/finance?period=2026-13`)).status).toBe(400);
    expect((await owner.get(`${base}/acme/finance?period=2026-00`)).status).toBe(400);
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

  it("carries the organization's language both ways", async () => {
    const base = `/api/projects/${ownerProject}/organizations`;
    expect((await owner.post(base, { orgId: "acme", mission: "x", language: "fr" })).status).toBe(
      400,
    );
    expect(
      (await owner.post(base, { orgId: "acme", mission: "做一个市场", language: "zh" })).status,
    ).toBe(201);
    expect(calls.at(-1)).toMatchObject({
      method: "create",
      args: [ownerProject, { orgId: "acme", mission: "做一个市场", language: "zh" }, "olivia"],
    });
    expect((await owner.patch(`${base}/acme`, { language: "de" })).status).toBe(400);
    expect((await owner.patch(`${base}/acme`, { language: "en" })).status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "patch",
      args: [ownerProject, "acme", { language: "en" }, "olivia"],
    });
  });

  it("carries a ticket owner and slug through to the service, and validates them first", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme`;
    const created = await owner.post(`${base}/tickets`, {
      title: "Audit the calendar",
      goal: "One event per employee",
      owner: "agent:acme_hr",
      slug: "audit-the-calendar",
    });
    expect(created.status).toBe(201);
    expect(calls.at(-1)).toMatchObject({
      method: "createTicket",
      args: [
        ownerProject,
        "acme",
        {
          title: "Audit the calendar",
          goal: "One event per employee",
          owner: "agent:acme_hr",
          slug: "audit-the-calendar",
        },
        { userId: "olivia" },
      ],
    });
    // An empty or oversized owner is no principal, so it never reaches the service.
    calls.length = 0;
    expect((await owner.post(`${base}/tickets`, { title: "T", owner: "" })).status).toBe(400);
    expect(
      (await owner.post(`${base}/tickets`, { title: "T", owner: "a".repeat(101) })).status,
    ).toBe(400);
    expect(calls).toEqual([]);
    // An owner cannot be cleared: a ticket always has one, so `null` is refused as a shape.
    expect((await owner.put(`${base}/tickets/2026-09-01-site`, { owner: null })).status).toBe(400);
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

  it("routes the channel family and validates its bodies", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme/channels`;
    expect((await owner.get(base)).status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "channels",
      args: [ownerProject, "acme", { userId: "olivia" }],
    });

    const create = await owner.post(base, { channelId: "site", name: "Site", purpose: "Ship it" });
    expect(create.status).toBe(201);
    expect(calls.at(-1)).toEqual({
      method: "createChannel",
      args: [
        ownerProject,
        "acme",
        { channelId: "site", name: "Site", purpose: "Ship it" },
        { userId: "olivia" },
      ],
    });

    expect((await owner.get(`${base}/site`)).status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "channel",
      args: [ownerProject, "acme", "site", { userId: "olivia" }],
    });

    const patch = await owner.patch(`${base}/site`, { name: "Site launch", archived: true });
    expect(patch.status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "patchChannel",
      args: [
        ownerProject,
        "acme",
        "site",
        { name: "Site launch", archived: true },
        { userId: "olivia" },
      ],
    });

    const add = await owner.post(`${base}/site/members`, { principal: "agent:acme_dev" });
    expect(add.status).toBe(201);
    expect(calls.at(-1)).toEqual({
      method: "addChannelMember",
      args: [ownerProject, "acme", "site", "agent:acme_dev", { userId: "olivia" }],
    });

    const remove = await owner.delete(`${base}/site/members/agent:acme_dev`);
    expect(remove.status).toBe(204);
    expect(calls.at(-1)).toEqual({
      method: "removeChannelMember",
      args: [ownerProject, "acme", "site", "agent:acme_dev", { userId: "olivia" }],
    });

    // A path id no channel could carry names no channel, and neither reaches the service.
    calls.length = 0;
    expect((await owner.get(`${base}/Site`)).status).toBe(404);
    expect((await owner.post(base, { channelId: "Site" })).status).toBe(400);
    expect((await owner.post(base, { name: "no id" })).status).toBe(400);
    expect((await owner.patch(`${base}/site`, { archived: "yes" })).status).toBe(400);
    expect((await owner.post(`${base}/site/members`, { principal: "acme_dev" })).status).toBe(400);
    expect((await owner.delete(`${base}/site/members/all`)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("carries the channel of the path through the message routes", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme/channels`;
    const all = await owner.get(`${base}/default_channel/messages`);
    expect(all.status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "channelMessages",
      args: [ownerProject, "acme", { userId: "olivia" }, "default_channel", {}],
    });
    expect(
      (await (await owner.get(`${base}/site/messages?date=2026-09-01`)).json()) as unknown,
    ).toMatchObject({ channelId: "site" });
    expect(calls.at(-1)).toEqual({
      method: "channelMessages",
      args: [ownerProject, "acme", { userId: "olivia" }, "site", { date: "2026-09-01" }],
    });

    expect((await owner.post(`${base}/site/messages`, { text: "hi" })).status).toBe(201);
    expect(calls.at(-1)).toMatchObject({
      method: "sendChannelMessage",
      args: [ownerProject, "acme", "olivia", "site", { text: "hi" }],
    });

    expect((await owner.post(`${base}/site/read`, { upTo: "msg-1" })).status).toBe(204);
    expect(calls.at(-1)).toEqual({
      method: "markRead",
      args: [ownerProject, "acme", "olivia", "site", "msg-1"],
    });

    // A path id no channel could carry names no channel; the bodies are validated too.
    calls.length = 0;
    expect((await owner.get(`${base}/Site/messages`)).status).toBe(404);
    expect((await owner.post(`${base}/Site/messages`, { text: "hi" })).status).toBe(404);
    expect((await owner.post(`${base}/site/messages`, {})).status).toBe(400);
    expect((await owner.post(`${base}/site/read`, {})).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("honours a read's sessionId only from the control environment", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme/channels`;
    const res = await t.app.request(`${base}?sessionId=session-desk&agentId=acme_dev`, {
      headers: { authorization: `Bearer ${t.deps.authService.localApiToken()}` },
    });
    expect(res.status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "channels",
      args: [
        ownerProject,
        "acme",
        { userId: "admin", sessionId: "session-desk", agentId: "acme_dev" },
      ],
    });
    // The same claim over a cookie is dropped: a cookie proves a person, not a session.
    expect((await owner.get(`${base}?sessionId=session-desk&agentId=acme_dev`)).status).toBe(200);
    expect(calls.at(-1)).toEqual({
      method: "channels",
      args: [ownerProject, "acme", { userId: "olivia" }],
    });
  });

  it("passes the calling session through write bodies so the file records the employee", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme/tickets/2026-09-01-site`;
    const res = await fromSession(t, `${base}/progress`, {
      text: "half done",
      sessionId: "session-desk",
      agentId: "acme_dev",
    });
    expect(res.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "progressTicket",
      args: [
        ownerProject,
        "acme",
        "2026-09-01-site",
        "half done",
        { userId: "admin", sessionId: "session-desk", agentId: "acme_dev" },
      ],
    });
    const start = await owner.post(`${base}/start`, { agentId: "acme_dev", message: "go" });
    expect(start.status).toBe(202);
    expect(await start.json()).toEqual({ sessionId: "session-x" });
    // Who asks rides along: only the ticket's owner (or a person) may start its sessions.
    expect(calls.at(-1)).toMatchObject({
      method: "startTicket",
      args: [
        ownerProject,
        "acme",
        "2026-09-01-site",
        { agentId: "acme_dev", message: "go" },
        { userId: "olivia" },
      ],
    });
    // On `start`, the body's `agentId` is the employee the session RUNS AS, not the caller:
    // the owner may enlist a colleague on its own ticket, so it never becomes the identity.
    const startFromDesk = await fromSession(t, `${base}/start`, {
      sessionId: "session-desk",
      agentId: "acme_mkt",
    });
    expect(startFromDesk.status).toBe(202);
    expect(calls.at(-1)).toMatchObject({
      method: "startTicket",
      args: [
        ownerProject,
        "acme",
        "2026-09-01-site",
        { agentId: "acme_mkt" },
        { userId: "admin", sessionId: "session-desk" },
      ],
    });
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

  it("drops a signed-in member's session id: the write cannot be attributed to that employee", async () => {
    const base = `/api/projects/${ownerProject}/organizations/acme`;
    const mallory = await provisionUser(t.app, "mallory");
    expect([200, 201]).toContain(
      (await owner.post(`/api/projects/${ownerProject}/members`, { userId: "mallory" })).status,
    );
    const memberApi = apiClient(t.app, mallory.cookie);

    // The CEO desk session id is in the GET /:orgId response, so every member can quote it.
    const posted = await memberApi.post(`${base}/channels/default_channel/messages`, {
      text: "ship it",
      sessionId: "session-ceo-desk",
    });
    expect(posted.status).toBe(201);
    expect(calls.at(-1)?.args).toEqual([
      ownerProject,
      "acme",
      "mallory",
      "default_channel",
      { text: "ship it" },
    ]);

    const progress = await memberApi.post(`${base}/tickets/2026-09-01-site/progress`, {
      text: "done",
      sessionId: "session-ceo-desk",
      agentId: "acme_ceo",
    });
    expect(progress.status).toBe(200);
    expect(calls.at(-1)?.args.at(-1)).toEqual({ userId: "mallory" });

    // `attach` takes the Session to attach in the same field: it still arrives, as an argument
    // rather than an identity — this is the Web App's attach button.
    const attach = await memberApi.post(`${base}/tickets/2026-09-01-site/attach`, {
      sessionId: "session-dev",
    });
    expect(attach.status).toBe(200);
    expect(calls.at(-1)?.args).toEqual([
      ownerProject,
      "acme",
      "2026-09-01-site",
      "session-dev",
      { userId: "mallory" },
    ]);
  });
});

describe("organization sessions route over the real service", () => {
  it("marks a desk whose Session has an enabled messaging binding, as the Session's own row is marked", async () => {
    const t = await createTestApp();
    try {
      t.deps.serverSettingsRepo.setCompanyMode(true);
      const u = await provisionUser(t.app, "olivia");
      const api = apiClient(t.app, u.cookie);
      const projectId = "olivia-default_project";
      const ceoDesk = "session-2026-09-01-09-00-00-0abc0021";
      const devDesk = "session-2026-09-01-09-05-00-0abc0022";

      // The organization as its files describe it: a CEO and one report, each with a desk.
      const store = new OrgStore(t.deps.config.root);
      const dir = store.dir(projectId, "acme");
      await store.createLayout(dir);
      await store.writeConfig(dir, {
        ...ORG_CONFIG_DEFAULTS,
        name: "Acme",
        mission: "Ship the site",
        timezone: "UTC",
        createdBy: "olivia",
      });
      await store.writeChart(dir, {
        employees: [
          { agentId: "acme_ceo", title: "CEO", reportsTo: null, workspace: "." },
          { agentId: "acme_dev", title: "Developer", reportsTo: "acme_ceo", workspace: "." },
        ],
      });
      const openedAt = "2026-09-01T09:00:00.000Z";
      const workspace = path.join(dir, "workspace");
      await store.writeDesks(dir, {
        acme_ceo: { sessionId: ceoDesk, workspace, openedAt, previous: [] },
        acme_dev: { sessionId: devDesk, workspace, openedAt, previous: [] },
      });
      for (const [sessionId, agentId] of [
        [ceoDesk, "acme_ceo"],
        [devDesk, "acme_dev"],
      ] as const) {
        t.deps.sessionsRepo.insert({
          sessionId,
          projectId,
          agentId,
          provider: "custom",
          modelId: "m-org",
          workspace,
          approvalMode: "allow-all",
          title: null,
          client: "org",
          createdAt: openedAt,
          lastActiveAt: openedAt,
        });
      }
      const desks = async () => {
        const res = await api.get(`/api/projects/${projectId}/organizations/acme/sessions`);
        expect(res.status).toBe(200);
        return new Map(
          ((await res.json()) as OrgSessionsResponse).desks.map((d) => [d.agentId, d]),
        );
      };

      // A saved config is not a binding until it is enabled: no mark yet.
      t.deps.messagingRepo.upsert({
        sessionId: ceoDesk,
        channel: "telegram",
        accountId: "12345",
        config: { botToken: "12345:secret" },
      });
      expect((await desks()).get("acme_ceo")).not.toHaveProperty("messagingChannel");

      t.deps.messagingRepo.setEnabled(ceoDesk, "telegram", true);
      const bound = await desks();
      expect(bound.get("acme_ceo")).toMatchObject({
        sessionId: ceoDesk,
        messagingChannel: "telegram",
      });
      expect(bound.get("acme_dev")).toMatchObject({ sessionId: devDesk });
      expect(bound.get("acme_dev")).not.toHaveProperty("messagingChannel");
      // One reading behind both marks: the Session's own row says the same.
      const own = (await (await api.get(`/api/sessions/${ceoDesk}`)).json()) as SessionResponse;
      expect(own.session.messagingChannel).toBe("telegram");

      // Unbinding takes the mark away with it.
      t.deps.messagingRepo.setEnabled(ceoDesk, "telegram", false);
      expect((await desks()).get("acme_ceo")).not.toHaveProperty("messagingChannel");
    } finally {
      await t.cleanup();
    }
  });

  it("finds an employee's desk and a ticket's session, which the employee's session list leaves out", async () => {
    const t = await createTestApp();
    try {
      t.deps.serverSettingsRepo.setCompanyMode(true);
      const u = await provisionUser(t.app, "piper");
      const api = apiClient(t.app, u.cookie);
      const projectId = "piper-default_project";
      const agentId = "acme_ceo";
      expect((await api.post(`/api/projects/${projectId}/agents`, { agentId })).status).toBe(201);
      const desk = "session-2026-09-01-09-00-00-0abc0031";
      const ticketSession = "session-2026-09-02-10-00-00-0abc0032";
      const own = "session-2026-09-03-11-00-00-0abc0033";

      const store = new OrgStore(t.deps.config.root);
      const dir = store.dir(projectId, "acme");
      await store.createLayout(dir);
      await store.writeConfig(dir, {
        ...ORG_CONFIG_DEFAULTS,
        name: "Acme",
        mission: "Ship the site",
        timezone: "UTC",
        createdBy: "piper",
      });
      await store.writeChart(dir, {
        employees: [{ agentId, title: "CEO", reportsTo: null, workspace: "." }],
      });
      const workspace = path.join(dir, "workspace");
      await store.writeDesks(dir, {
        [agentId]: {
          sessionId: desk,
          workspace,
          openedAt: "2026-09-01T09:00:00.000Z",
          previous: [],
        },
      });
      await store.writeTicket(dir, "2026-09-02-site", "in_progress", {
        title: "Launch the site",
        status: "in_progress",
        owner: `agent:${agentId}`,
        notify: [],
        priority: "P2",
        sessions: [ticketSession],
        history: [],
        goal: "",
        acceptanceCriteria: "",
        progress: [],
        result: "",
        extra: {},
        extraSections: [],
      });
      // The desk has not run yet (no Trace); the ticket's session ran and recorded `company`;
      // the person's own conversation recorded `user`.
      for (const [sessionId, client, source] of [
        [desk, "org", undefined],
        [ticketSession, "org", "company"],
        [own, "web", "user"],
      ] as const) {
        const stamp = `${sessionId.slice(8, 18)}T09:00:00.000Z`;
        t.deps.sessionsRepo.insert({
          sessionId,
          projectId,
          agentId,
          provider: "custom",
          modelId: "m-org",
          workspace,
          approvalMode: "allow-all",
          title: null,
          client,
          createdAt: stamp,
          lastActiveAt: stamp,
        });
        if (source === undefined) continue;
        await writeTraceFile(t.root, projectId, agentId, sessionId.slice(8, 18), sessionId, 1, [
          sessionMeta({
            session_id: sessionId,
            model_id: "m-org",
            provider: "custom",
            model_context_window: 1000,
            system_prompt: "",
            agent_state: "/tmp/a",
            workspace,
            source: source satisfies SessionSource,
          }),
          userText("work"),
        ]);
      }

      const org = (await (
        await api.get(`/api/projects/${projectId}/organizations/acme/sessions`)
      ).json()) as OrgSessionsResponse;
      expect(org.desks.map((d) => d.sessionId)).toEqual([desk]);
      expect(org.tickets.flatMap((tk) => tk.sessions.map((s) => s.sessionId))).toEqual([
        ticketSession,
      ]);

      const list = async (qs: string) =>
        (await (
          await api.get(`/api/projects/${projectId}/agents/${agentId}/sessions${qs}`)
        ).json()) as SessionsResponse;
      const counted = await list("?category=active&counts=1");
      expect(counted.sessions.map((s) => s.sessionId)).toEqual([own]);
      expect(counted.counts).toEqual({ active: 1, background: 0, archived: 0 });
      expect((await list("?category=background")).sessions).toEqual([]);
      expect((await list("?category=archived")).sessions).toEqual([]);
      // Both are company Sessions as the list reads them.
      const sources = new Map((await list("")).sessions.map((s) => [s.sessionId, s.source]));
      expect(sources.get(desk)).toBe("company");
      expect(sources.get(ticketSession)).toBe("company");
    } finally {
      await t.cleanup();
    }
  });
});
