/**
 * Per-Session scoped Bearer tokens, read-only workbench status inspection, corrupt package.json
 * handling, and subagent `PENGUIN_APP_ID` survival across restarts.
 *
 * - `mintSessionToken` / `verifySessionToken` round-trip under the boot secret and reject
 *   tampered signatures, wrong secrets, and malformed shapes; real user IDs never parse as
 *   synthetic Session principals.
 * - Given a non-admin user's Project (`alice_proj`, inaccessible to `admin`) and a cross-agent
 *   workbench Session (`owner_agent/board` executing on `worker_agent`), the Session's injected
 *   `PENGUIN_API_TOKEN` is a per-Session `psess_` token that lets the Agent inspect its own
 *   Project (`app-center?all=1`, `workbenches/:id/status`, `history?requireExists=1`,
 *   `agents/:a/sessions`) while strictly refusing other Projects (including another Project of the
 *   same owner), owner-only writes (`enable/disable`, `models`, `DELETE /projects`), admin routes,
 *   remote session exchange, and user-table writes.
 * - `GET …/workbenches/:id/status` never compiles, loads, or writes `.build/`, and distinguishes
 *   "never loaded", "disabled", "serving & ready", "corrupt package.json", and "latest build
 *   failed while previous instance is still serving".
 * - A workbench whose `package.json` is `null` (or non-object JSON) never crashes `readFolder` or
 *   `status`, and appears in `app-center?all=1` with `build: "failed"` and a readable diagnostic.
 * - A subagent Session registered under a workbench root Session persists `appId` on its DB row
 *   so resuming it directly after a server restart still injects `PENGUIN_APP_ID`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  AppCenterResponse,
  ProjectsResponse,
  SessionsResponse,
  WorkbenchInfo,
  WorkbenchStatusResponse,
  WorkbenchVersion,
} from "../src/api/types.js";
import {
  isSessionPrincipal,
  mintSessionToken,
  parseSessionPrincipal,
  SESSION_TOKEN_PREFIX,
  sessionPrincipalId,
  verifySessionToken,
} from "../src/auth/session-token.js";
import {
  apiClient,
  createTestApp,
  loginUser,
  provisionUser,
  restartTestApp,
  tokenClient,
  waitFor,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { uniqueSessionId } from "./fixtures/session.js";
import { MOCK_MODEL_ID, requestText, startMockLLM } from "./live-session.js";

const HOST_IFACE = "@prismshadow/penguin-server#WorkbenchHost";
const MAIN_IFACE = "@prismshadow/penguin-server#WorkbenchMain";

function demoPackageJson(name: string) {
  return JSON.stringify(
    {
      name,
      version: "1.0.0",
      type: "module",
      penguin: {
        version: "1",
        modules: [
          {
            name: "Workbench",
            requires: { host: { iface: HOST_IFACE, from: "Host" } },
            provides: { main: MAIN_IFACE },
            contributes: {
              "WebModule.sessionTabs": [
                {
                  id: `${name}.tab`,
                  key: "main",
                  title: name,
                  renderer: { iframe: { src: "ui/index.html" } },
                },
              ],
            },
            children: [],
          },
        ],
      },
    },
    null,
    2,
  );
}

const DEMO_INDEX = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        return {
          api: {
            main: {
              async handle(req) {
                if (req.path === "/open-worker") {
                  const opened = await host.createSession({ agentId: "worker_agent" });
                  return { body: { opened } };
                }
                return { body: { ok: true, path: req.path } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

async function writeWorkbench(dir: string, name: string): Promise<void> {
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), demoPackageJson(name));
  await fs.writeFile(path.join(dir, "index.ts"), DEMO_INDEX);
  await fs.writeFile(path.join(dir, "ui", "index.html"), `<!doctype html><h1>${name}</h1>`);
}

describe("session-token primitives", () => {
  it("mints, verifies, and rejects tampered or foreign-secret tokens", () => {
    const sid = "session-2026-11-24-10-00-00-abcd1234";
    const tok = mintSessionToken("boot-secret-1", sid);
    expect(tok.startsWith(SESSION_TOKEN_PREFIX)).toBe(true);
    expect(verifySessionToken("boot-secret-1", tok)).toBe(sid);
    expect(verifySessionToken("boot-secret-2", tok)).toBeNull();
    expect(verifySessionToken("boot-secret-1", `${tok}x`)).toBeNull();
    expect(verifySessionToken("boot-secret-1", "not-a-session-token")).toBeNull();
    expect(verifySessionToken("boot-secret-1", "psess_missingdot")).toBeNull();
  });

  it("formats and parses synthetic session principals disjoint from real user ids", () => {
    const id = sessionPrincipalId("alice_proj", "session-2026-11-24-10-00-00-abcd1234");
    expect(isSessionPrincipal(id)).toBe(true);
    expect(parseSessionPrincipal(id)).toEqual({
      projectId: "alice_proj",
      sessionId: "session-2026-11-24-10-00-00-abcd1234",
    });
    expect(isSessionPrincipal("admin")).toBe(false);
    expect(isSessionPrincipal("alice")).toBe(false);
    expect(parseSessionPrincipal("session:")).toBeNull();
    expect(parseSessionPrincipal("session:nocolon")).toBeNull();
  });
});

describe("non-admin Project cross-agent workbench self-inspection & isolation", () => {
  let t: TestApp;
  let alice: ReturnType<typeof apiClient>;
  const PROJECT = "alice-proj";
  const OTHER_PROJECT = "alice-other";
  const OWNER_AGENT = "owner_agent";
  const WORKER_AGENT = "worker_agent";

  beforeAll(async () => {
    t = await createTestApp();
    alice = apiClient(t.app, (await provisionUser(t.app, "alice")).cookie);
    expect((await alice.post("/api/projects", { projectId: PROJECT, name: "Alice" })).status).toBe(
      201,
    );
    expect(
      (await alice.post("/api/projects", { projectId: OTHER_PROJECT, name: "Other" })).status,
    ).toBe(201);
    expect(
      (await alice.post(`/api/projects/${PROJECT}/agents`, { agentId: OWNER_AGENT })).status,
    ).toBe(201);
    expect(
      (await alice.post(`/api/projects/${PROJECT}/agents`, { agentId: WORKER_AGENT })).status,
    ).toBe(201);

    const wbBase = path.join(agentStateDir(t.root, PROJECT, OWNER_AGENT), "workbenches");
    await writeWorkbench(path.join(wbBase, "board"), "Board");
    await writeWorkbench(path.join(wbBase, "draft"), "Draft");
    await writeWorkbench(path.join(wbBase, "off"), "Off");
    await fs.writeFile(path.join(wbBase, "off", ".disabled"), "");
    // Corrupt package.json = literal JSON null (Round 1 high-priority finding).
    await fs.mkdir(path.join(wbBase, "corrupt_null"), { recursive: true });
    await fs.writeFile(path.join(wbBase, "corrupt_null", "package.json"), "null\n");
  });

  afterAll(async () => {
    await t.cleanup();
  });

  it("lets a cross-agent workbench Session in a non-admin Project self-inspect without loading untouched apps, and enforces isolation", async () => {
    const command = `node -e "console.log('ENV_JSON=' + JSON.stringify({ token: process.env.PENGUIN_API_TOKEN ?? null, project: process.env.PENGUIN_PROJECT_ID ?? null, agent: process.env.PENGUIN_AGENT_ID ?? null, app: process.env.PENGUIN_APP_ID ?? null, session: process.env.PENGUIN_SESSION_ID ?? null }))"`;
    const mock = await startMockLLM((n) => {
      const sent = requestText(mock.requests[n - 1]!);
      const tag = /inspect:([a-z-]+)/.exec(sent)?.[1];
      if (tag === undefined) return "Title";
      if (sent.includes('"tool_result"')) return "done";
      return { toolUse: { id: `toolu_${tag}`, name: "exec_command", input: { command } } };
    });

    try {
      expect(
        (
          await alice.put(`/api/projects/${PROJECT}/models`, {
            defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
            models: [
              {
                provider: "custom",
                modelId: MOCK_MODEL_ID,
                apiKey: "sk-mock",
                baseUrl: mock.url,
                contextWindow: 200_000,
              },
            ],
          })
        ).status,
      ).toBe(200);

      // Load `board` only (by calling its API to open a cross-agent Session on `worker_agent`).
      const openedRes = await alice.get(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/board/api/open-worker`,
      );
      expect(openedRes.status, await openedRes.clone().text()).toBe(200);
      const workerSessionId = ((await openedRes.json()) as { opened: { sessionId: string } }).opened
        .sessionId;

      // Run one turn inside `worker_agent`'s cross-agent workbench Session and capture injected env.
      const taskRes = await alice.post(`/api/sessions/${workerSessionId}/tasks`, {
        input: [{ type: "text", text: "inspect:cross" }],
      });
      expect(taskRes.status).toBe(202);
      await waitFor(() => t.deps.manager.statusOf(workerSessionId) === "idle", 20_000);
      const answered = mock.requests.find((req) => {
        const text = requestText(req);
        return text.includes('"tool_result"') && text.includes("toolu_cross");
      });
      const raw = /ENV_JSON=(\{.*?\})(?:\\n|"|\r|\n)/.exec(
        answered ? requestText(answered) : "",
      )?.[1];
      expect(raw).toBeDefined();
      const env = JSON.parse(raw!.replace(/\\"/g, '"')) as {
        token: string | null;
        project: string | null;
        agent: string | null;
        app: string | null;
        session: string | null;
      };

      expect(env.project).toBe(PROJECT);
      expect(env.agent).toBe(WORKER_AGENT);
      expect(env.app).toBe(`${OWNER_AGENT}/board`);
      expect(env.session).toBe(workerSessionId);
      expect(env.token).not.toBeNull();
      expect(env.token!.startsWith(SESSION_TOKEN_PREFIX)).toBe(true);
      expect(env.token).not.toBe(t.deps.authService.localApiToken());

      const sessionClient = tokenClient(t.app, env.token!);

      // 1. Admin's raw local API token CANNOT read alice_proj (confirms non-admin Project setup).
      const rawAdminClient = tokenClient(t.app, t.deps.authService.localApiToken()!);
      expect((await rawAdminClient.get(`/api/projects/${PROJECT}/app-center?all=1`)).status).toBe(
        404,
      );

      // 2. Session token CAN read alice_proj's full app-center?all=1, including corrupt_null with diagnostic.
      const listRes = await sessionClient.get(`/api/projects/${PROJECT}/app-center?all=1`);
      expect(listRes.status).toBe(200);
      const { shortcuts } = (await listRes.json()) as AppCenterResponse;
      const byId = new Map(
        shortcuts.filter((s) => s.agentId === OWNER_AGENT).map((s) => [s.workbenchId, s]),
      );
      expect([...byId.keys()].sort()).toEqual(["board", "corrupt_null", "draft", "off"]);
      expect(byId.get("board")).toMatchObject({ build: "ready", enabled: true });
      expect(byId.get("off")).toMatchObject({ enabled: false });
      expect(byId.get("corrupt_null")).toMatchObject({
        build: "failed",
        error: "package.json must be a JSON object",
      });

      // 3. Read-only `status` on untouched `draft`: reports not_loaded & serving=false WITHOUT loading it.
      const draftBuildDir = path.join(
        agentStateDir(t.root, PROJECT, OWNER_AGENT),
        "workbenches",
        "draft",
        ".build",
      );
      const draftStatusRes = await sessionClient.get(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/draft/status`,
      );
      expect(draftStatusRes.status).toBe(200);
      const draftStatus = ((await draftStatusRes.json()) as WorkbenchStatusResponse).workbench;
      expect(draftStatus).toMatchObject({
        id: "draft",
        enabled: true,
        agentEnabled: true,
        serving: false,
        servingRevision: null,
        build: "not_loaded",
        error: null,
        loadedAt: null,
        tabs: [],
      });
      await expect(fs.access(draftBuildDir)).rejects.toThrow();

      // Existing never-loaded app has empty history; missing app is 404 with requireExists=1.
      const draftHistRes = await sessionClient.get(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/draft/history?requireExists=1`,
      );
      expect(draftHistRes.status).toBe(200);
      expect(((await draftHistRes.json()) as { versions: WorkbenchVersion[] }).versions).toEqual(
        [],
      );
      expect(
        (
          await sessionClient.get(
            `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/missing/history?requireExists=1`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await sessionClient.get(
            `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/missing/status`,
          )
        ).status,
      ).toBe(404);

      // 4. `status` on corrupt_null does not crash and reports build="failed" with readable error.
      const corruptRes = await sessionClient.get(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/corrupt_null/status`,
      );
      expect(corruptRes.status).toBe(200);
      expect(((await corruptRes.json()) as WorkbenchStatusResponse).workbench).toMatchObject({
        id: "corrupt_null",
        serving: false,
        build: "failed",
        error: "package.json must be a JSON object",
      });

      // 5. `status` on serving `board` reports serving=true & build="ready"; after a broken edit +
      //    reload, reports serving=true (old revision still serving) alongside build="failed" & error.
      const boardReadyRes = await sessionClient.get(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/board/status`,
      );
      expect(boardReadyRes.status).toBe(200);
      const boardReady = ((await boardReadyRes.json()) as WorkbenchStatusResponse).workbench;
      expect(boardReady).toMatchObject({
        id: "board",
        enabled: true,
        agentEnabled: true,
        serving: true,
        servingRevision: boardReady.revision,
        build: "ready",
        error: null,
      });

      const boardDir = path.join(
        agentStateDir(t.root, PROJECT, OWNER_AGENT),
        "workbenches",
        "board",
      );
      await fs.writeFile(path.join(boardDir, "package.json"), "null\n");
      const reloadRes = await alice.post(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/board/reload`,
        {},
      );
      expect(reloadRes.status).toBe(200);
      expect(((await reloadRes.json()) as { workbench: WorkbenchInfo }).workbench.error).toContain(
        "package.json must be a JSON object",
      );

      const boardDegradedRes = await sessionClient.get(
        `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/board/status`,
      );
      expect(boardDegradedRes.status).toBe(200);
      const boardDegraded = ((await boardDegradedRes.json()) as WorkbenchStatusResponse).workbench;
      expect(boardDegraded).toMatchObject({
        id: "board",
        serving: true,
        servingRevision: boardReady.revision,
        build: "failed",
      });
      expect(boardDegraded.revision).not.toBe(boardReady.revision);
      expect(boardDegraded.error).toContain("package.json must be a JSON object");

      // 6. Session token reads cross-agent archived sessions of `owner_agent/board`.
      const sessRes = await sessionClient.get(
        `/api/projects/${PROJECT}/agents/${WORKER_AGENT}/sessions`,
      );
      expect(sessRes.status).toBe(200);
      const { sessions } = (await sessRes.json()) as SessionsResponse;
      expect(sessions.find((s) => s.sessionId === workerSessionId)).toMatchObject({
        sessionId: workerSessionId,
        agentId: WORKER_AGENT,
        appId: `${OWNER_AGENT}/board`,
        archived: true,
      });

      // 7. Strict isolation & least-privilege enforcement on the per-Session token.
      // Only lists its own Project.
      const projectsRes = await sessionClient.get("/api/projects");
      expect(projectsRes.status).toBe(200);
      expect(
        ((await projectsRes.json()) as ProjectsResponse).projects.map((p) => [p.projectId, p.role]),
      ).toEqual([[PROJECT, "member"]]);

      // Cannot access default_project or alice's other Project.
      expect((await sessionClient.get("/api/projects/default_project/app-center")).status).toBe(
        404,
      );
      expect((await sessionClient.get(`/api/projects/${OTHER_PROJECT}/app-center`)).status).toBe(
        404,
      );

      // Cannot perform owner-only writes in its own Project.
      expect(
        (
          await sessionClient.put(
            `/api/projects/${PROJECT}/agents/${OWNER_AGENT}/workbenches/board/enabled`,
            { enabled: false },
          )
        ).status,
      ).toBe(403);
      expect((await sessionClient.delete(`/api/projects/${PROJECT}`)).status).toBe(403);
      expect(
        (
          await sessionClient.put(`/api/projects/${PROJECT}/models`, {
            defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
            models: [],
          })
        ).status,
      ).toBe(403);

      // Cannot reach admin routes, remote session exchange, or user-table writes.
      expect((await sessionClient.get("/api/admin/users")).status).toBe(403);
      expect((await sessionClient.get("/api/hmr/status")).status).toBe(401);
      expect((await sessionClient.post("/api/remote/session", {})).status).toBe(401);
      expect((await sessionClient.post("/api/projects", { projectId: "evil_proj" })).status).toBe(
        403,
      );
      expect((await sessionClient.put("/api/me/prefs", { theme: "dark" })).status).toBe(403);
      expect(
        (await sessionClient.put(`/api/projects/${PROJECT}/app-center/layout`, { layout: null }))
          .status,
      ).toBe(403);
    } finally {
      await mock.close();
    }
  });

  it("persists a workbench subagent's appId so direct resume after a server restart still injects PENGUIN_APP_ID", async () => {
    const sub = await createTestApp({ durableDatabase: true });
    const owner = apiClient(sub.app, (await provisionUser(sub.app, "bob", "password-bob")).cookie);
    const proj = "bob-proj";
    const appAgent = "app_owner";
    const command = `node -e "console.log('SUB_ENV=' + JSON.stringify({ app: process.env.PENGUIN_APP_ID ?? null, session: process.env.PENGUIN_SESSION_ID ?? null }))"`;
    const mock = await startMockLLM((n) => {
      const sent = requestText(mock.requests[n - 1]!);
      if (!sent.includes("sub-check")) return "Title";
      if (sent.includes('"tool_result"')) return "done";
      return { toolUse: { id: `toolu_sub_${n}`, name: "exec_command", input: { command } } };
    });

    try {
      expect((await owner.post("/api/projects", { projectId: proj })).status).toBe(201);
      expect((await owner.post(`/api/projects/${proj}/agents`, { agentId: appAgent })).status).toBe(
        201,
      );
      expect(
        (
          await owner.put(`/api/projects/${proj}/models`, {
            defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
            models: [
              {
                provider: "custom",
                modelId: MOCK_MODEL_ID,
                apiKey: "sk-mock",
                baseUrl: mock.url,
                contextWindow: 200_000,
              },
            ],
          })
        ).status,
      ).toBe(200);

      // Seed a workbench root session and register a child subagent under it.
      const rootSid = uniqueSessionId();
      const childSid = uniqueSessionId();
      const now = new Date().toISOString();
      sub.deps.sessionsRepo.insertOrIgnore({
        sessionId: rootSid,
        projectId: proj,
        agentId: appAgent,
        provider: "custom",
        modelId: MOCK_MODEL_ID,
        workspace: path.join(sub.root, "ws"),
        approvalMode: "allow-all",
        sandbox: null,
        title: null,
        client: "workbench",
        appId: `${appAgent}/board`,
        hasTrace: false,
        lastActiveAt: now,
        createdAt: now,
      });
      await fs.mkdir(path.join(sub.root, "ws"), { recursive: true });
      const registered = (
        sub.deps.manager as unknown as {
          registerChildSession: (
            entry: { sessionId: string; projectId: string; agentId: string },
            msg: {
              type: "session_meta";
              timestamp: string;
              origin: string[];
              payload: {
                session_id: string;
                agent_state: string;
                provider: string;
                model_id: string;
                workspace: string;
                source: string;
              };
            },
            children: Map<string, unknown>,
          ) => { sessionId: string } | null;
        }
      ).registerChildSession(
        { sessionId: rootSid, projectId: proj, agentId: appAgent },
        {
          type: "session_meta",
          timestamp: now,
          origin: [childSid],
          payload: {
            session_id: childSid,
            agent_state: agentStateDir(sub.root, proj, appAgent),
            provider: "custom",
            model_id: MOCK_MODEL_ID,
            workspace: path.join(sub.root, "ws"),
            source: "subagent",
          },
        },
        new Map(),
      );
      expect(registered?.sessionId).toBe(childSid);
      expect(sub.deps.sessionsRepo.findById(childSid)?.appId).toBe(`${appAgent}/board`);

      // Restart the server completely so in-memory `childRoots` is empty, then directly run the child.
      const restarted = await restartTestApp(sub);
      try {
        const bobClient = apiClient(
          restarted.app,
          (await loginUser(restarted.app, "bob", "password-bob")).cookie,
        );

        const runRes = await bobClient.post(`/api/sessions/${childSid}/tasks`, {
          input: [{ type: "text", text: "sub-check" }],
        });
        expect(runRes.status, await runRes.clone().text()).toBe(202);
        await waitFor(() => restarted.deps.manager.statusOf(childSid) === "idle", 20_000);

        const answered = mock.requests.find((req) => {
          const text = requestText(req);
          return text.includes('"tool_result"') && text.includes("SUB_ENV=");
        });
        const raw = /SUB_ENV=(\{.*?\})(?:\\n|"|\r|\n)/.exec(
          answered ? requestText(answered) : "",
        )?.[1];
        expect(raw).toBeDefined();
        expect(JSON.parse(raw!.replace(/\\"/g, '"'))).toEqual({
          app: `${appAgent}/board`,
          session: childSid,
        });
      } finally {
        await restarted.cleanup();
      }
    } finally {
      await mock.close();
      await sub.cleanup().catch(() => {});
    }
  });
});
