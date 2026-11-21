/**
 * End-to-end QA suite for controlled Agent sessions and live LLM tool execution.
 *
 * Covers the 8 required QA categories under real HTTP + CLI subprocess + live model turns:
 *   1. Server operations CLI commands (`penguin version`, `penguin server status`, `penguin server stop`, `penguin server reset-admin-password`)
 *   2. Admin CLI commands (`penguin config model list`, `penguin config vault set/list`, `penguin auth token`)
 *   3. Admin RESTful APIs (`GET /api/admin/users`, `GET|PUT /api/admin/settings`, `PUT /api/projects/:p/agents/:a/auth`)
 *   4. Normal CLI commands (`penguin agent ls`, `penguin ls`, `penguin project ls`, `penguin cost`, `penguin schedule ls`)
 *   5. Normal RESTful APIs (`GET /api/me`, `GET /api/projects/:p/agents`, `GET .../auth`, `GET .../schedules`, `PUT .../config` on self)
 *   6. Plugin CLI commands (`penguin plugin list`, `penguin exec ls`, `penguin exec @qa/plugin:qa-ping`)
 *   7. Plugin RESTful APIs (`GET /api/plugins`, `GET .../plugins/installed`, `GET /api/cli/commands`, `POST /api/cli/commands/run`)
 *   8. Failure cases & hot-reload (`none` role, `@self` cross-agent rejection with admin repair prompt,
 *      `@undefined` refiner rejection, cross-project rejection, invalid Bearer 401, and live generation hot-reload across turns).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import type { CliCommandCode } from "@prismshadow/penguin-core/cli";
import { parseManifest, type ModuleDef } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../src/plugin/host.js";
import { ADMIN_REPAIR_INSTRUCTION } from "../src/auth/auth-refiners.js";
import type { AgentAuth } from "../src/mechanisms/agent-auth.js";
import { apiClient, createTestApp, loginAdmin, tokenClient } from "./helpers.js";

const CANDIDATE_PROJECT_CONFIGS = [
  process.env.PENGUIN_QA_PROJECT_CONFIG,
  path.join(os.homedir(), "penguin-web-deploy-data", "default_project", ".project_config.toml"),
  path.join(os.homedir(), "penguin-web-deploy-data", "qa-default_project", ".project_config.toml"),
  path.join(os.homedir(), ".penguin", "data", "default_project", ".project_config.toml"),
].filter((p): p is string => typeof p === "string" && fs.existsSync(p));
const HOST_PROJECT_CONFIG = CANDIDATE_PROJECT_CONFIGS[0];
const CLI_DIST_ENTRY = path.resolve(import.meta.dirname, "../../cli/dist/penguin.js");
const runLive =
  process.env.PENGUIN_E2E === "1" &&
  HOST_PROJECT_CONFIG !== undefined &&
  fs.existsSync(CLI_DIST_ENTRY);
const maybeLive = runLive ? it : it.skip;

function createQaPlugin(): ModuleDef {
  const manifest = parseManifest({
    name: "QaPluginModule",
    requires: {},
    provides: {},
    contributes: {
      "PluginCliCommandsProvider.commands": [
        {
          id: "qa.ping",
          key: "qa.ping",
          summary: { en: "QA ping command", zh: "QA 测试命令" },
        },
      ],
    },
    children: [],
  });
  const code: CliCommandCode = {
    register: (node) => {
      (node as unknown as {
        argument(spec: string, desc: string): { action(fn: (who?: string) => void): void };
      })
        .argument("[who]", "Target name")
        .action((who?: string) => {
          process.stdout.write(`qa-pong:${who ?? "world"}\n`);
        });
    },
  };
  return {
    manifest,
    create: () => ({
      api: {},
      bind: { "qa.ping": code },
    }),
  };
}

describe("Controlled Agent Auth QA: live LLM execution & 8 use-case categories", () => {
  maybeLive(
    "drives a real LLM through controlled Agent sessions across CLI, RESTful, Plugin, Refiner, and Failure use cases",
    { timeout: 240_000 },
    async () => {
      let currentFetch: (req: Request) => Response | Promise<Response> = () =>
        new Response("booting", { status: 503 });

      const httpServer = serve({
        fetch: (req) => currentFetch(req),
        hostname: "127.0.0.1",
        port: 0,
      });
      await new Promise<void>((resolve) => {
        if (httpServer.listening) resolve();
        else httpServer.once("listening", () => resolve());
      });
      const port = (httpServer.address() as AddressInfo).port;

      const host = new PluginHost();
      host.use({
        specifier: "@qa/plugin",
        modules: [createQaPlugin()],
        replaces: [],
      });

      const t = await createTestApp({
        durableDatabase: true,
        plugins: host,
        config: {
          port,
          cliEntry: CLI_DIST_ENTRY,
        },
        beforeSeed: async (root) => {
          const defaultProjectDir = path.join(root, "default_project");
          fs.mkdirSync(defaultProjectDir, { recursive: true });
          // Copy the host's model configuration file directly without reading or logging its contents.
          fs.copyFileSync(
            HOST_PROJECT_CONFIG!,
            path.join(defaultProjectDir, ".project_config.toml"),
          );
        },
      });

      currentFetch = (req) => t.app.fetch(req);

      try {
        const { cookie: adminCookie } = await loginAdmin(t.app);
        const adminHttp = apiClient(t.app, adminCookie);
        const agentAuth = t.boot.tree.api<AgentAuth>("IdentityModule", "AgentAuth");

        // Create two agents in default_project: `qa_runner` (the controlled agent under test)
        // and `qa_peer` (a second agent to test cross-agent @self refiner isolation).
        const createRunnerRes = await adminHttp.post("/api/projects/default_project/agents", {
          agentId: "qa_runner",
        });
        expect(createRunnerRes.status).toBe(201);

        const createPeerRes = await adminHttp.post("/api/projects/default_project/agents", {
          agentId: "qa_peer",
        });
        expect(createPeerRes.status).toBe(201);

        // Create a second project (`other_project`) to test cross-project isolation.
        const createOtherProjRes = await adminHttp.post("/api/projects", {
          projectId: "other_project",
        });
        expect(createOtherProjRes.status).toBe(201);

        const modelsInfo = await t.deps.projectConfigService.getModels("default_project");
        const defaultModel = modelsInfo.defaultModel;
        const configuredModel =
          modelsInfo.models.find(
            (m) =>
              defaultModel != null &&
              m.provider === defaultModel.provider &&
              m.modelId === defaultModel.modelId &&
              m.effective.apiKeySource !== "none",
          ) ?? modelsInfo.models.find((m) => m.effective.apiKeySource !== "none");
        if (!configuredModel) {
          throw new Error(
            `No model with apiKeySource !== "none" found in default_project (total models=${modelsInfo.models.length})`,
          );
        }

        // Create a live session for `qa_runner` with approvalMode="allow-all" so tool calls run non-interactively.
        const createSessRes = await adminHttp.post(
          "/api/projects/default_project/agents/qa_runner/sessions",
          {
            provider: configuredModel.provider,
            modelId: configuredModel.modelId,
            approvalMode: "allow-all",
          },
        );
        if (createSessRes.status !== 201) {
          throw new Error(`createSessRes failed (${createSessRes.status}): ${await createSessRes.text()}`);
        }
        expect(createSessRes.status).toBe(201);
        const { session } = (await createSessRes.json()) as {
          session: { sessionId: string };
        };
        let sessionId = session.sessionId;
        await adminHttp.patch(`/api/sessions/${sessionId}`, {
          thinkingLevel: "low",
        });

        /**
         * Helper: runs one live LLM turn on `sessionId`, waits until the session returns to idle,
         * and returns all records written so far.
         */
        const runLiveTurn = async (prompt: string) => {
          const startRes = await adminHttp.post(`/api/sessions/${sessionId}/tasks`, {
            input: [{ type: "text", text: prompt }],
          });
          if (startRes.status !== 202) {
            throw new Error(`startTask failed (${startRes.status}): ${await startRes.text()}`);
          }
          expect(startRes.status).toBe(202);
          const started = (await startRes.json()) as { sessionId: string };
          sessionId = started.sessionId;

          const deadline = Date.now() + 90_000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 250));
            if (t.deps.manager.statusOf(sessionId) === "idle") break;
          }
          expect(t.deps.manager.statusOf(sessionId)).toBe("idle");

          const records = await t.deps.traceService.readMessages(
            "default_project",
            "qa_runner",
            sessionId,
          );
          return records;
        };

        // =========================================================================
        // TURN 1 (Live LLM under default `general` role):
        // Ask the real model to execute a comprehensive QA probe script via `exec_command`
        // that exercises all 8 categories under its injected controlled PENGUIN_API_TOKEN,
        // writes the structured JSON report to `qa-turn1-report.json`, and summarizes it.
        // =========================================================================
        const turn1ScriptPath = path.join(t.root, "run-qa-turn1.mjs");
        fs.writeFileSync(
          turn1ScriptPath,
          `import { execFileSync } from "node:child_process";
import fs from "node:fs";

const apiUrl = process.env.PENGUIN_API_URL;
const token = process.env.PENGUIN_API_TOKEN;
const projectId = process.env.PENGUIN_PROJECT_ID;
const agentId = process.env.PENGUIN_AGENT_ID;

function runCli(args) {
  try {
    const stdout = execFileSync("penguin", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, stdout: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      exitCode: err.status ?? 1,
      stdout: String(err.stdout ?? "").trim(),
      stderr: String(err.stderr ?? "").trim(),
    };
  }
}

async function callApi(method, pathUrl, body, customToken = token) {
  const headers = {
    origin: apiUrl,
    ...(customToken ? { authorization: \`Bearer \${customToken}\` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch(\`\${apiUrl}\${pathUrl}\`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json ?? text };
}

const report = {
  env: {
    hasApiUrl: Boolean(apiUrl),
    hasToken: Boolean(token),
    projectId,
    agentId,
  },
  // 1. Server ops CLI commands under general role
  serverOpsCli: {
    version: runCli(["version", "--json"]),
    serverStatusDenied: runCli(["server", "status"]),
    serverStopDenied: runCli(["server", "stop"]),
    resetPasswordDenied: runCli(["server", "reset-admin-password"]),
  },
  // 2. Admin CLI commands under general role
  adminCli: {
    modelListAllowed: runCli(["config", "model", "list"]),
    vaultListDenied: runCli(["config", "vault", "list", "--agent-id", "qa_runner"]),
    vaultSetDenied: runCli(["config", "vault", "set", "--key", "QA_KEY", "--value", "secret", "--agent-id", "qa_runner"]),
    authTokenDenied: runCli(["auth", "token"]),
  },
  // 3. Admin RESTful APIs under general role
  adminRest: {
    listUsersDenied: await callApi("GET", "/api/admin/users"),
    getSettingsDenied: await callApi("GET", "/api/admin/settings"),
    putSettingsDenied: await callApi("PUT", "/api/admin/settings", { companyMode: false }),
    putAgentAuthDenied: await callApi(
      "PUT",
      "/api/projects/default_project/agents/qa_runner/auth",
      { role: "admin", apiIds: [] },
    ),
  },
  // 4. Normal CLI commands under general role
  normalCli: {
    agentLs: runCli(["agent", "ls", "--json"]),
    sessionLs: runCli(["session", "ls", "--json"]),
    projectLs: runCli(["project", "ls", "--json"]),
    cost: runCli(["cost", "--json"]),
    scheduleLs: runCli(["schedule", "ls", "--json", "--agent-id", "qa_runner"]),
  },
  // 5. Normal RESTful APIs under general role
  normalRest: {
    me: await callApi("GET", "/api/me"),
    agents: await callApi("GET", "/api/projects/default_project/agents"),
    selfAuth: await callApi("GET", "/api/projects/default_project/agents/qa_runner/auth"),
    selfSchedules: await callApi("GET", "/api/projects/default_project/agents/qa_runner/schedules"),
    selfConfigPut: await callApi("PUT", "/api/projects/default_project/agents/qa_runner/config", {
      systemPrompt: "Updated by self under general role.",
    }),
  },
  // 6. Plugin CLI commands under general role
  pluginCli: {
    pluginList: runCli(["plugin", "list", "--json"]),
    execLs: runCli(["exec", "ls"]),
    execPingDenied: runCli(["exec", "@qa/plugin:qa.ping", "GeneralAgent"]),
  },
  // 7. Plugin RESTful APIs under general role
  pluginRest: {
    library: await callApi("GET", "/api/plugins"),
    installed: await callApi("GET", "/api/projects/default_project/plugins/installed"),
    cliCommandsList: await callApi("GET", "/api/cli/commands"),
    cliCommandsRunDenied: await callApi("POST", "/api/cli/commands/run", {
      package: "@qa/plugin",
      prog: "penguin exec @qa/plugin:qa.ping",
      args: ["qa", "ping", "GeneralAgent"],
      language: "en",
    }),
  },
  // 8. Failure cases (cross-agent @self refiner mismatch, cross-project, invalid token)
  failureCases: {
    crossAgentConfigPut: await callApi(
      "PUT",
      "/api/projects/default_project/agents/qa_peer/config",
      { systemPrompt: "Attempt cross-agent write" },
    ),
    crossProjectGet: await callApi("GET", "/api/projects/other_project/agents"),
    forgedBearer: await callApi("GET", "/api/me", undefined, "forged-invalid-token-123"),
  },
};

fs.writeFileSync(${JSON.stringify(path.join(t.root, "qa-turn1-report.json"))}, JSON.stringify(report, null, 2));
console.log("QA_TURN1_DONE");
`,
        );

        const turn1Records = await runLiveTurn(
          `Run \`node ${turn1ScriptPath}\` using exec_command and reply with QA_TURN1_COMPLETE once it finishes.`,
        );

        // Verify the real LLM invoked `exec_command` and executed the Turn 1 probe script.
        const turn1ToolCalls = turn1Records.filter(
          (r) => (r.payload as { type?: string }).type === "tool_call",
        );
        expect(turn1ToolCalls.length).toBeGreaterThanOrEqual(1);

        const turn1ReportRaw = fs.readFileSync(
          path.join(t.root, "qa-turn1-report.json"),
          "utf8",
        );
        const r1 = JSON.parse(turn1ReportRaw);

        // Verify Turn 1 (`general` role) results across all 8 categories:
        expect(r1.env).toEqual({
          hasApiUrl: true,
          hasToken: true,
          projectId: "default_project",
          agentId: "qa_runner",
        });
        // Wait: verify that the token injected into the Agent subprocess is NOT the root admin localApiToken!
        const rootToken = t.deps.authService.localApiToken();
        const issuedAgentToken = agentAuth.ensureSessionToken(
          "default_project",
          "qa_runner",
          new Date(),
        );
        expect(issuedAgentToken).not.toBe(rootToken);

        // 1. Server ops CLI under `general`: `version` succeeds; `server status`, `server stop`, `reset-admin-password` are denied (403)
        expect(r1.serverOpsCli.version.ok).toBe(true);
        expect(r1.serverOpsCli.serverStatusDenied.ok).toBe(false);
        expect(r1.serverOpsCli.serverStatusDenied.stderr).toContain("admin.settings.get");
        expect(r1.serverOpsCli.serverStopDenied.ok).toBe(false);
        expect(r1.serverOpsCli.serverStopDenied.stderr).toContain("admin.settings.update");
        expect(r1.serverOpsCli.resetPasswordDenied.ok).toBe(false);
        expect(r1.serverOpsCli.resetPasswordDenied.stderr).toContain("admin.users.list");

        // 2. Admin CLI under `general`: `config model list` succeeds; `vault list`, `vault set`, `auth token` are denied (403)
        expect(r1.adminCli.modelListAllowed.ok).toBe(true);
        expect(r1.adminCli.vaultListDenied.ok).toBe(false);
        expect(r1.adminCli.vaultListDenied.stderr).toContain("vault.get");
        expect(r1.adminCli.vaultSetDenied.ok).toBe(false);
        expect(r1.adminCli.vaultSetDenied.stderr).toContain("vault.setEntry");
        expect(r1.adminCli.authTokenDenied.ok).toBe(false);
        expect(r1.adminCli.authTokenDenied.stderr).toContain("admin.users.list");

        // 3. Admin RESTful APIs under `general`: all 403 `permission_required`
        expect(r1.adminRest.listUsersDenied.status).toBe(403);
        expect(r1.adminRest.listUsersDenied.body.error.code).toBe("permission_required");
        expect(r1.adminRest.getSettingsDenied.status).toBe(403);
        expect(r1.adminRest.getSettingsDenied.body.error.code).toBe("permission_required");
        expect(r1.adminRest.putSettingsDenied.status).toBe(403);
        expect(r1.adminRest.putSettingsDenied.body.error.code).toBe("permission_required");
        expect(r1.adminRest.putAgentAuthDenied.status).toBe(403);
        expect(r1.adminRest.putAgentAuthDenied.body.error.code).toBe("permission_required");

        // 4. Normal CLI under `general`: all succeed
        expect(r1.normalCli.agentLs.ok).toBe(true);
        expect(r1.normalCli.sessionLs.ok).toBe(true);
        expect(r1.normalCli.projectLs.ok).toBe(true);
        expect(r1.normalCli.cost.ok).toBe(true);
        expect(r1.normalCli.scheduleLs.ok).toBe(true);

        // 5. Normal RESTful under `general`: all 200 OK (including `PUT .../qa_runner/config` via `agent.maintain@self`)
        expect(r1.normalRest.me.status).toBe(200);
        expect(r1.normalRest.agents.status).toBe(200);
        expect(r1.normalRest.selfAuth.status).toBe(200);
        expect(r1.normalRest.selfAuth.body.role).toBe("general");
        expect(r1.normalRest.selfSchedules.status).toBe(200);
        expect(r1.normalRest.selfConfigPut.status).toBe(200);

        // 6. Plugin CLI under `general`: listing succeeds; `penguin exec @qa/plugin:qa.ping` is denied (403 `cli.commands.run`)
        expect(r1.pluginCli.pluginList.ok).toBe(true);
        expect(r1.pluginCli.execLs.ok).toBe(true);
        expect(r1.pluginCli.execLs.stdout).toContain("qa.ping");
        expect(r1.pluginCli.execPingDenied.ok).toBe(false);
        expect(r1.pluginCli.execPingDenied.stderr).toContain("cli.commands.run");

        // 7. Plugin RESTful under `general`: listing 200 OK; `POST /api/cli/commands/run` 403 `permission_required`
        expect(r1.pluginRest.library.status).toBe(200);
        expect(r1.pluginRest.installed.status).toBe(200);
        expect(r1.pluginRest.cliCommandsList.status).toBe(200);
        expect(r1.pluginRest.cliCommandsList.body.commands).toEqual([
          expect.objectContaining({ package: "@qa/plugin", key: "qa.ping" }),
        ]);
        expect(r1.pluginRest.cliCommandsRunDenied.status).toBe(403);
        expect(r1.pluginRest.cliCommandsRunDenied.body.error.code).toBe("permission_required");

        // 8. Failure cases under `general`:
        // - Cross-agent write to `qa_peer` is rejected by `AuthSelfRefiner` (`403 permission_required`)
        expect(r1.failureCases.crossAgentConfigPut.status).toBe(403);
        expect(r1.failureCases.crossAgentConfigPut.body.error.code).toBe("permission_required");
        expect(r1.failureCases.crossAgentConfigPut.body.error.message).toContain(
          'Auth refiner "@self" denied action "agent.config.update"',
        );
        // - Cross-project access to `other_project` is rejected with 403 `permission_required`
        expect(r1.failureCases.crossProjectGet.status).toBe(403);
        expect(r1.failureCases.crossProjectGet.body.error.code).toBe("permission_required");
        // - Forged Bearer token is rejected with 401 `unauthorized`
        expect(r1.failureCases.forgedBearer.status).toBe(401);
        expect(r1.failureCases.forgedBearer.body.error.code).toBe("unauthorized");

        // =========================================================================
        // INTER-TURN FAILURE CHECKS (via Admin RESTful API `PUT /api/projects/:p/agents/:a/auth`):
        // Test `none` role, `@undefinedRefiner`, and `@self` scope mismatch (`auth_refiner_mismatch`)
        // before upgrading the session to `admin` for Turn 2.
        // =========================================================================
        const agentClient = tokenClient(t.app, issuedAgentToken);

        // Set role to `none`: even `GET /api/me` and `GET /api/version` are 403 `permission_required`
        const setNoneRes = await adminHttp.put(
          "/api/projects/default_project/agents/qa_runner/auth",
          {
            role: "none",
            apiIds: [],
          },
        );
        expect(setNoneRes.status).toBe(200);
        expect(((await setNoneRes.json()) as { generation: number }).generation).toBe(1);
        expect((await agentClient.get("/api/me")).status).toBe(403);
        expect((await agentClient.get("/api/version")).status).toBe(403);

        // Set extra grant with undefined refiner `agent.maintain@nonExistentRefiner`:
        // immediate 403 `auth_refiner_undefined` with admin repair instruction
        const setUndefRefinerRes = await adminHttp.put(
          "/api/projects/default_project/agents/qa_runner/auth",
          {
            role: "none",
            apiIds: ["agent.maintain@nonExistentRefiner"],
          },
        );
        expect(setUndefRefinerRes.status).toBe(200);
        const undefPutRes = await agentClient.put(
          "/api/projects/default_project/agents/qa_runner/config",
          { systemPrompt: "test" },
        );
        expect(undefPutRes.status).toBe(403);
        const undefBody = (await undefPutRes.json()) as {
          error: { code: string; message: string };
        };
        expect(undefBody.error.code).toBe("auth_refiner_undefined");
        expect(undefBody.error.message).toContain(ADMIN_REPAIR_INSTRUCTION);

        // Set extra grant with out-of-scope refiner `admin.maintain@self`:
        // `AuthSelfRefiner` only covers Agent-scoped domains (not `admin.`), so invoking
        // `PUT /api/admin/settings` triggers 403 `auth_refiner_mismatch` with admin repair instruction
        const setMismatchRefinerRes = await adminHttp.put(
          "/api/projects/default_project/agents/qa_runner/auth",
          {
            role: "none",
            apiIds: ["admin.maintain@self"],
          },
        );
        expect(setMismatchRefinerRes.status).toBe(200);
        const mismatchPutRes = await agentClient.put("/api/admin/settings", {
          companyMode: false,
        });
        expect(mismatchPutRes.status).toBe(403);
        const mismatchBody = (await mismatchPutRes.json()) as {
          error: { code: string; message: string };
        };
        expect(mismatchBody.error.code).toBe("auth_refiner_mismatch");
        expect(mismatchBody.error.message).toContain(ADMIN_REPAIR_INSTRUCTION);

        // =========================================================================
        // TURN 2 (Live generation hot-reload to `admin` in the SAME session):
        // Upgrade `qa_runner` to `admin` via RESTful API (`generation` bumps to 4) and
        // ask the real LLM in the same session to re-run the privileged CLI, RESTful,
        // and Plugin commands. Everything that was 403 in Turn 1 now succeeds!
        // =========================================================================
        const setAdminRes = await adminHttp.put(
          "/api/projects/default_project/agents/qa_runner/auth",
          {
            role: "admin",
            apiIds: [],
          },
        );
        expect(setAdminRes.status).toBe(200);
        const adminAuthState = (await setAdminRes.json()) as {
          role: string;
          generation: number;
          allEndpoints: boolean;
        };
        expect(adminAuthState.role).toBe("admin");
        expect(adminAuthState.generation).toBe(4);
        expect(adminAuthState.allEndpoints).toBe(true);

        const turn2ScriptPath = path.join(t.root, "run-qa-turn2.mjs");
        fs.writeFileSync(
          turn2ScriptPath,
          `import { execFileSync } from "node:child_process";
import fs from "node:fs";

const apiUrl = process.env.PENGUIN_API_URL;
const token = process.env.PENGUIN_API_TOKEN;

function runCli(args) {
  try {
    const stdout = execFileSync("penguin", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, stdout: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      exitCode: err.status ?? 1,
      stdout: String(err.stdout ?? "").trim(),
      stderr: String(err.stderr ?? "").trim(),
    };
  }
}

async function callApi(method, pathUrl, body) {
  const headers = {
    origin: apiUrl,
    authorization: \`Bearer \${token}\`,
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch(\`\${apiUrl}\${pathUrl}\`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json ?? text };
}

const report = {
  serverStatusAllowed: runCli(["server", "status"]),
  vaultSetAllowed: runCli(["config", "vault", "set", "--key", "QA_LIVE_KEY", "--value", "live_val", "--agent-id", "qa_runner"]),
  vaultListAllowed: runCli(["config", "vault", "list", "--agent-id", "qa_runner"]),
  adminUsersAllowed: await callApi("GET", "/api/admin/users"),
  adminSettingsAllowed: await callApi("GET", "/api/admin/settings"),
  crossAgentConfigAllowed: await callApi(
    "PUT",
    "/api/projects/default_project/agents/qa_peer/config",
    { systemPrompt: "Updated by admin agent in Turn 2." },
  ),
  pluginExecAllowed: runCli(["exec", "@qa/plugin:qa.ping", "LiveAdmin"]),
  pluginRestRunAllowed: await callApi("POST", "/api/cli/commands/run", {
    package: "@qa/plugin",
    prog: "penguin exec @qa/plugin:qa.ping",
    args: ["qa", "ping", "RestAdmin"],
    language: "en",
  }),
};

fs.writeFileSync(${JSON.stringify(path.join(t.root, "qa-turn2-report.json"))}, JSON.stringify(report, null, 2));
console.log("QA_TURN2_DONE");
`,
        );

        await runLiveTurn(
          `Your Agent permissions were hot-upgraded to admin. Run \`node ${turn2ScriptPath}\` using exec_command and reply with QA_TURN2_COMPLETE.`,
        );

        const turn2ReportRaw = fs.readFileSync(
          path.join(t.root, "qa-turn2-report.json"),
          "utf8",
        );
        const r2 = JSON.parse(turn2ReportRaw);

        expect(r2.serverStatusAllowed.ok).toBe(true);
        expect(JSON.parse(r2.serverStatusAllowed.stdout)).toHaveProperty("machineId");
        expect(r2.vaultSetAllowed.ok).toBe(true);
        expect(r2.vaultListAllowed.ok).toBe(true);
        expect(r2.vaultListAllowed.stdout).toContain("QA_LIVE_KEY");
        expect(r2.adminUsersAllowed.status).toBe(200);
        expect(r2.adminSettingsAllowed.status).toBe(200);
        expect(r2.crossAgentConfigAllowed.status).toBe(200);
        expect(r2.pluginExecAllowed.ok).toBe(true);
        expect(r2.pluginExecAllowed.stdout).toContain("qa-pong:LiveAdmin");
        expect(r2.pluginRestRunAllowed.status).toBe(200);
        expect(r2.pluginRestRunAllowed.body).toEqual({
          exitCode: 0,
          stdout: "qa-pong:RestAdmin\n",
          stderr: "",
        });
      } finally {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        await t.cleanup();
      }
    },
  );
});
