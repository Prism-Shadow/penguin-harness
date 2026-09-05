/**
 * Integration tests for the App Center routes: registration lands a TOML file (owner only;
 * members read, outsiders get 404), derived ids get a counter suffix and explicit ids 409
 * on collision, a registration must name a Session of the Project, the list carries probed
 * statuses through the injected fetch and reports unparsable files, PUT keeps the
 * registration time, DELETE cleans up — and actions reach the owning Session as a new Task
 * when idle, as steering when running, and 409 once the Session is gone.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import { parseAppCenterMessage } from "@prismshadow/penguin-core/markers";
import type {
  AppActionResponse,
  AppItem,
  AppsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { appsDir } from "../src/runtime/app-registry.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-09-02-10-00-00-a99c0001";
const RUNNING_URL = "http://localhost:3000";
const DOWN_URL = "http://localhost:4000";

/** Fetch double: the running URL answers, everything else is refused. */
const probeFetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(RUNNING_URL)) return new Response(null, { status: 200 });
  throw new Error("connect ECONNREFUSED");
}) as typeof globalThis.fetch;

/**
 * Fake Session: records every task input it runs; in `park` mode it waits on one approval so
 * the Task stays running (always-ask) and records steering instead.
 */
function fakeSession(
  sessionId: string,
  log: { runs: OmniMessage[][]; steered: OmniMessage[][] },
  mode: "finish" | "park",
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: (input: OmniMessage[]) => {
      log.steered.push(input);
      return true;
    },
    unsteer: () => false,
    skipReconnectWait: () => false,
    async *run(input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      log.runs.push(input);
      if (mode === "park") {
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-app" });
        yield tc;
        const decision = await opts.approve(tc);
        yield approvalDecision(decision, "tc-app");
      }
      yield assistantText("done");
    },
    async *compact() {},
  };
}

function sessionRow(projectId: string, sessionId = SID): SessionRow {
  return {
    sessionId,
    projectId,
    agentId: "default_agent",
    modelId: "m1",
    provider: "custom",
    workspace: "/tmp/ws-app",
    approvalMode: "always-ask",
    title: "Build a todo app",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

describe("apps api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  beforeEach(async () => {
    t = await createTestApp({ appProbeFetch: probeFetch });
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-apps", name: "apps project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/apps`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
    t.deps.sessionsRepo.insert(sessionRow(projectId));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("POST registers (owner only) with Session-derived defaults and lands TOML on disk; GET list / item; DELETE cleans up", async () => {
    const body = {
      name: "Todo App",
      description: "Node + React",
      sessionId: SID,
      url: RUNNING_URL,
      startCommand: "npm start",
      stopCommand: "npm stop",
    };
    expect((await member.post(base, body)).status).toBe(403);
    const createdRes = await owner.post(base, body);
    expect(createdRes.status).toBe(201);
    const item = (await createdRes.json()) as AppItem;
    expect(item).toMatchObject({
      id: "todo-app",
      name: "Todo App",
      description: "Node + React",
      sessionId: SID,
      sessionTitle: "Build a todo app",
      sessionExists: true,
      agentId: "default_agent",
      workspace: "/tmp/ws-app",
      url: RUNNING_URL,
      kind: "web",
      status: "running",
    });
    expect(item.registeredAt).toBe(item.updatedAt);
    expect(item.checkedAt).toBeTruthy();

    const file = path.join(appsDir(t.root, projectId), "todo-app.toml");
    const raw = await fs.readFile(file, "utf8");
    expect(raw).toContain('name = "Todo App"');
    expect(raw).toContain(`session_id = "${SID}"`);
    expect(raw).toContain('agent_id = "default_agent"');
    expect(raw).toContain('workspace = "/tmp/ws-app"');

    // Any member can read; outsiders get 404.
    const list = (await (await member.get(base)).json()) as AppsResponse;
    expect(list.apps.map((a) => a.id)).toEqual(["todo-app"]);
    expect(list.invalidFiles).toEqual([]);
    expect((await outsider.get(base)).status).toBe(404);
    expect((await member.get(`${base}/todo-app`)).status).toBe(200);
    expect((await member.get(`${base}/nope`)).status).toBe(404);

    // A second registration under the same name gets a counter suffix; an explicit id collides.
    const again = (await (await owner.post(base, body)).json()) as AppItem;
    expect(again.id).toBe("todo-app-2");
    expect((await owner.post(base, { ...body, id: "todo-app" })).status).toBe(409);
    expect((await owner.post(base, { ...body, id: "../x" })).status).toBe(400);

    // Delete (owner only): removes the file.
    expect((await member.delete(`${base}/todo-app`)).status).toBe(403);
    expect((await owner.delete(`${base}/todo-app`)).status).toBe(204);
    await expect(fs.access(file)).rejects.toThrow();
    expect((await owner.delete(`${base}/todo-app`)).status).toBe(404);
  });

  it("a registration must name a Session of this Project, an http(s) URL and a known kind", async () => {
    expect(
      (await owner.post(base, { name: "x", sessionId: "session-does-not-exist" })).status,
    ).toBe(400);
    t.deps.sessionsRepo.insert(sessionRow("owner_a-default_project", "session-elsewhere-0001"));
    expect(
      (await owner.post(base, { name: "x", sessionId: "session-elsewhere-0001" })).status,
    ).toBe(400);
    expect(
      (await owner.post(base, { name: "x", sessionId: SID, url: "localhost:3000" })).status,
    ).toBe(400);
    expect((await owner.post(base, { name: "x", sessionId: SID, kind: "desktop" })).status).toBe(
      400,
    );
    expect(((await (await owner.get(base)).json()) as AppsResponse).apps).toEqual([]);
  });

  it("the list probes each app's health URL (or URL), lists unparsable files, and ?refresh=1 re-probes", async () => {
    await owner.post(base, { name: "up", sessionId: SID, url: RUNNING_URL, kind: "api" });
    await owner.post(base, {
      name: "down",
      sessionId: SID,
      url: RUNNING_URL,
      healthUrl: `${DOWN_URL}/health`,
    });
    await owner.post(base, { name: "no-url", sessionId: SID, kind: "cli" });
    await fs.writeFile(path.join(appsDir(t.root, projectId), "broken.toml"), "name = [\n");
    const list = (await (await member.get(`${base}?refresh=1`)).json()) as AppsResponse;
    expect(list.apps.map((a) => [a.id, a.kind, a.status])).toEqual([
      ["down", "web", "stopped"],
      ["no-url", "cli", "unknown"],
      ["up", "api", "running"],
    ]);
    expect(list.apps.find((a) => a.id === "no-url")?.checkedAt).toBeUndefined();
    expect(list.invalidFiles).toEqual([{ id: "broken", error: expect.stringContaining("TOML") }]);
  });

  it("PUT replaces the file (owner only), keeps the registration time and re-derives Session defaults; missing is 404", async () => {
    const created = (await (
      await owner.post(base, { name: "svc", sessionId: SID, url: DOWN_URL })
    ).json()) as AppItem;
    expect(created.status).toBe("stopped");
    const edit = { name: "Service", sessionId: SID, url: RUNNING_URL, kind: "api" };
    expect((await member.put(`${base}/svc`, edit)).status).toBe(403);
    expect((await owner.put(`${base}/other`, edit)).status).toBe(404);
    const updatedRes = await owner.put(`${base}/svc`, edit);
    expect(updatedRes.status).toBe(200);
    const updated = (await updatedRes.json()) as AppItem;
    expect(updated).toMatchObject({
      id: "svc",
      name: "Service",
      url: RUNNING_URL,
      kind: "api",
      status: "running",
      registeredAt: created.registeredAt,
    });
    expect(updated.description).toBeUndefined();
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
    // A hand-written file without timestamps reads them off its mtime.
    await fs.writeFile(
      path.join(appsDir(t.root, projectId), "manual.toml"),
      `name = "Manual"\nsession_id = "${SID}"\nagent_id = "default_agent"\nworkspace = "/w"\n`,
    );
    const manual = (await (await owner.get(`${base}/manual`)).json()) as AppItem;
    expect(Date.parse(manual.registeredAt)).toBeGreaterThan(0);
    expect(manual.updatedAt).toBe(manual.registeredAt);
  });

  describe("actions", () => {
    it("idle Session: the [app_center] input starts a new Task there (any member); a running one is steered", async () => {
      await owner.post(base, {
        name: "Todo",
        sessionId: SID,
        url: RUNNING_URL,
        stopCommand: "npm stop",
      });
      const log = { runs: [] as OmniMessage[][], steered: [] as OmniMessage[][] };
      t.deps.manager.adopt(sessionRow(projectId), fakeSession(SID, log, "park"));

      const first = await member.post(`${base}/todo/actions`, { action: "restart" });
      expect(first.status).toBe(202);
      expect((await first.json()) as AppActionResponse).toEqual({
        sessionId: SID,
        delivery: "task",
      });
      await waitFor(() => log.runs.length === 1);
      const input = log.runs[0]![0]!.payload as { text: string; sender?: string };
      expect(input.sender).toBe("server");
      expect(parseAppCenterMessage(input.text)).toMatchObject({
        origin: { appId: "todo", appName: "Todo", action: "restart" },
      });
      expect(input.text).toContain("run `npm stop`");

      // The fake parks on its approval, so the Session is still running: the next action steers.
      await waitFor(() => t.deps.manager.statusOf(SID) === "running");
      const second = await member.post(`${base}/todo/actions`, { action: "stop" });
      expect(second.status).toBe(202);
      expect((await second.json()) as AppActionResponse).toEqual({
        sessionId: SID,
        delivery: "steer",
      });
      expect(log.steered).toHaveLength(1);
      expect(
        parseAppCenterMessage((log.steered[0]![0]!.payload as { text: string }).text),
      ).toMatchObject({
        origin: { action: "stop" },
      });
      expect((await member.post(`${base}/todo/actions`, { action: "dance" })).status).toBe(400);
      expect((await member.post(`${base}/none/actions`, { action: "stop" })).status).toBe(404);
      expect((await outsider.post(`${base}/todo/actions`, { action: "stop" })).status).toBe(404);
    });

    it("a deleted owning Session answers 409 app_session_missing and the list says so", async () => {
      await owner.post(base, { name: "Orphan", sessionId: SID });
      t.deps.sessionsRepo.deleteById(SID);
      const res = await owner.post(`${base}/orphan/actions`, { action: "restart" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "app_session_missing",
      );
      const item = (await (await owner.get(`${base}/orphan`)).json()) as AppItem;
      expect(item.sessionExists).toBe(false);
      expect(item.sessionTitle).toBeUndefined();
    });
  });
});
