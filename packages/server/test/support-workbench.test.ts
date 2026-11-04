/**
 * Given a fresh default Project, its support Agent contributes a working tab without setup.
 * Given persisted in-progress tickets after a restart, GET reconciles final answers once and stops
 * following their Sessions; failed/foreign jobs never receive an older or another Project's
 * answer. Reload preserves the ticket history.
 * Given a running question, its answer is saved when the task ends, with no GET to reconcile it; a
 * question a person stops is marked stopped from the abort record. Where the host has no
 * subscribe (an older server), the workbench still loads and GET alone answers its questions.
 * Given an ordinary Agent, plugin install exposes a tab; update preserves records and uninstall removes it.
 * Given a conflicting workbench, plugin install returns 409 without installing its Skill.
 * Given answered tickets, resolve/reopen preserves messages; malformed follow-ups do not write.
 * Session titles arrive independently of answers; changing a Session title updates the saved question.
 * Updating a plugin with an older authoring contract brings this host's types along with the code.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import { WorkbenchService } from "../src/workbenches/service.js";
import { apiClient, createTestApp, loginAdmin, writeTraceFile, type TestApp } from "./helpers.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { MOCK_MODEL_ID, startMockLLM, type MockLLM } from "./live-session.js";
const BASE = "/api/projects/default_project/agents/penguin_support/workbenches/support";
const HOST_KEY = "@prismshadow/penguin-server#WorkbenchHost";
const RECORD_KEY = "@prismshadow/penguin-server#WorkbenchRecord";
const message = (role: string, text: string): AmspRecord =>
  ({
    timestamp: "2026-10-14T00:00:00Z",
    type: "model_msg",
    payload: { type: "text", role, text },
  }) as AmspRecord;
/** A handler from before the host's title accessor and live subscriptions. */
const OLDER_HANDLER = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: {
    Workbench: {
      create() {
        return { api: { main: { async handle() { return { body: { tickets: [] } }; } } } };
      },
    },
  },
} satisfies WorkbenchPackage;
`;
interface Ticket {
  id: string;
  title: string;
  status: string;
  messages: Array<{ role: string; text: string }>;
  error: string | null;
  stopped?: boolean;
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
    // Loading the workbench followed the Sessions its state says are running; the restart ended
    // their tasks, so only the GET below can settle them.
    expect(t.deps.channels.get(ids[0]!).subscriberCount).toBe(1);
    const first = await tickets();
    expect(t.deps.channels.get(ids[0]!).subscriberCount).toBe(0);
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
    // An older installed revision, written against a harness without the host's title accessor
    // and live subscriptions: the update must bring types that have them along with the code.
    const authored = path.join(disk, ".harness/plugin.d.ts");
    const older = (await fs.readFile(authored, "utf8")).replace(
      /^.*\b(?:sessionTitle|subscribe): .*\n/gm,
      "",
    );
    expect(older).not.toMatch(/\b(?:sessionTitle|subscribe): /);
    await fs.writeFile(authored, older);
    await fs.writeFile(path.join(disk, "index.ts"), OLDER_HANDLER);
    await fs.writeFile(path.join(disk, "ui/app.js"), "local edit");
    const reload = await admin.post(`${agent}/workbenches/support/reload`);
    expect(await reload.json()).toMatchObject({ workbench: { error: null } });
    expect((await admin.post(`${agent}/plugins`, { names: ["penguin-support"] })).status).toBe(201);
    expect(await (await admin.get(`${agent}/workbenches`)).json()).toMatchObject({
      workbenches: [{ error: null }],
    });
    expect(await fs.readFile(authored, "utf8")).toMatch(/\bsubscribe: /);
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

describe("support workbench following a question live", { timeout: 30000 }, () => {
  let t: TestApp, admin: ReturnType<typeof apiClient>, mock: MockLLM;
  /** When set, the model holds its next answer until this settles. */
  let hold: Promise<void> | undefined;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const dir = () => path.join(t.root, "default_project/agents/penguin_support/workbenches/support");
  /** The ticket as saved on disk, never read through GET. */
  const saved = async (id: string) =>
    (
      JSON.parse(await fs.readFile(path.join(dir(), "state.json"), "utf8")) as {
        tickets: Ticket[];
      }
    ).tickets.find((ticket) => ticket.id === id);
  /** The saved ticket once it has left `running`. */
  const settled = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const ticket = await saved(id);
      if (ticket && ticket.status !== "running") return ticket;
      await wait(25);
    }
    throw new Error(`question ${id} is still running`);
  };
  const ask = async (text: string) => {
    const created = await admin.post(`${BASE}/api/tickets`, { text });
    expect(created.status, await created.clone().text()).toBe(201);
    return (await created.json()) as { id: string; sessionId: string };
  };
  beforeAll(async () => {
    mock = await startMockLLM(
      () => "Open the **Support** tab.",
      () => hold,
    );
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const models = await admin.put("/api/projects/default_project/models", {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [
        {
          provider: "custom",
          modelId: MOCK_MODEL_ID,
          clientType: "ant-messages",
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
      ],
    });
    expect(models.status, await models.text()).toBe(200);
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });
  it("saves the answer when the task ends, with no GET to reconcile it", async () => {
    const { id, sessionId } = await ask("Where is the Support tab?");
    expect(await settled(id)).toMatchObject({
      status: "answered",
      error: null,
      messages: [
        { role: "user", text: "Where is the Support tab?" },
        { role: "assistant", text: "Open the **Support** tab." },
      ],
    });
    expect((await saved(id))!.stopped).toBeUndefined();
    // Answered, the question no longer holds its Session's stream.
    expect(t.deps.channels.get(sessionId).subscriberCount).toBe(0);
  });
  it("marks a question a person stopped from the abort record, not from its error text", async () => {
    let release = () => {};
    hold = new Promise((resolve) => (release = resolve));
    try {
      const asked = mock.requests.length;
      const { id, sessionId } = await ask("Stop me");
      for (let i = 0; i < 200 && mock.requests.length === asked; i++) await wait(25);
      expect((await admin.post(`/api/sessions/${sessionId}/abort`)).status).toBe(202);
      expect(await settled(id)).toMatchObject({ status: "failed", stopped: true });
    } finally {
      hold = undefined;
      release();
    }
  });
  it("answers through GET alone where the host has no subscribe", async () => {
    // A server from before host.subscribe: its host has no such method, and the .harness/ it
    // writes does not name it.
    const proto = WorkbenchService.prototype as unknown as {
      host(...args: unknown[]): Promise<Record<string, unknown>>;
    };
    const original = proto.host;
    const spy = vi.spyOn(proto, "host").mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const host = await original.apply(this, args);
      delete host.subscribe;
      return host;
    });
    try {
      const tableFile = path.join(dir(), ".harness/ifaces.json");
      const table = JSON.parse(await fs.readFile(tableFile, "utf8")) as IfaceTable;
      delete table.ifaces[HOST_KEY]!.methods["subscribe"];
      delete table.types[RECORD_KEY];
      await fs.writeFile(tableFile, JSON.stringify(table));
      const typesFile = path.join(dir(), ".harness/plugin.d.ts");
      const types = (await fs.readFile(typesFile, "utf8"))
        .replace(/^.*\bsubscribe: .*\n/m, "")
        .replace(/^export type WorkbenchRecord = .*\n/m, "");
      expect(types).not.toMatch(/\bsubscribe: |WorkbenchRecord/);
      await fs.writeFile(typesFile, types);
      const reload = await admin.post(`${BASE}/reload`);
      expect(await reload.json()).toMatchObject({ workbench: { error: null } });

      const { id, sessionId } = await ask("Is GET enough?");
      expect(t.deps.channels.get(sessionId).subscriberCount).toBe(0);
      for (let i = 0; i < 200 && t.deps.manager.statusOf(sessionId) !== "idle"; i++) await wait(25);
      expect((await saved(id))!.status).toBe("running");
      const listed = await admin.get(`${BASE}/api/tickets`);
      const { tickets } = (await listed.json()) as { tickets: Ticket[] };
      expect(tickets.find((ticket) => ticket.id === id)).toMatchObject({
        status: "answered",
        messages: [
          { role: "user", text: "Is GET enough?" },
          { role: "assistant", text: "Open the **Support** tab." },
        ],
      });
    } finally {
      spy.mockRestore();
    }
  });
});
