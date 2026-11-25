/**
 * End-to-end QA suite for controlled Agent sessions, AgentRole workflows, mismatch fallback,
 * and permission upgrade requests (`allowed_once`, `allowed_for_agent`, `always_allowed`).
 *
 * Drives a real Agent Session (`exec_command` tool execution + real `penguin` CLI subprocess)
 * against a live HTTP server across:
 *   1. Default AgentRole workflows (`none`, `readonly`, `general`, `general-with-ask`,
 *      `system-maintainer`, `admin`, `full-permissions`) and permission introspection
 *   2. Controlled Agent Session restrictions (`@self` refiner denial, missing role grant denial,
 *      structured 403 `suggestedWithAsk` / `suggestedUpgradeGrants` / `upgradeRequestEndpoint`)
 *   3. Permission Upgrade Requests across all three approval modes:
 *      - `allowed_once`: allows one matching call, then auto-consumes
 *      - `allowed_for_agent`: persists across calls in the agent session without writing DB role
 *      - `always_allowed`: writes persistent role configuration
 *   4. Role upgrade/downgrade mismatch detection and safe fallback to `readonly`
 *   5. Custom `AgentRole` definition (`defineRole`)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import type { AgentAuth } from "../src/mechanisms/agent-auth.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

const CLI_DIST_ENTRY = path.resolve(import.meta.dirname, "../../cli/dist/penguin.js");
const maybeE2e = fs.existsSync(CLI_DIST_ENTRY) ? it : it.skip;

describe("Controlled Agent Auth QA: end-to-end session restrictions and permission upgrade requests", () => {
  maybeE2e(
    "bounds Agent Session CLI and REST actions and enforces allowed_once, allowed_for_agent, and always_allowed upgrades",
    { timeout: 120_000 },
    async () => {
      const llmServer = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          messages?: Array<{
            role?: string;
            content?: string | Array<{ text?: string }>;
          }>;
        };
        const messages = body.messages ?? [];
        const lastMsg = messages[messages.length - 1] ?? {};

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        if (lastMsg.role === "user") {
          const content =
            typeof lastMsg.content === "string"
              ? lastMsg.content
              : Array.isArray(lastMsg.content)
                ? lastMsg.content.map((p) => p.text ?? "").join("")
                : "";
          const match = content.match(/CMD_TO_RUN:\s*(.+)$/m);
          const cmd = match ? match[1]!.trim() : "echo ok";
          const callId = `call_${Date.now()}`;
          const argsJson = JSON.stringify({ description: "Run E2E auth probe", cmd });

          const chunk1 = {
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: callId,
                      type: "function",
                      function: { name: "exec_command", arguments: argsJson },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          const chunk2 = {
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
          res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
          res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          const chunk1 = {
            id: "chatcmpl-2",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Probe completed." },
                finish_reason: null,
              },
            ],
          };
          const chunk2 = {
            id: "chatcmpl-2",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          };
          res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
          res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      });

      await new Promise<void>((resolve) => llmServer.listen(0, "127.0.0.1", () => resolve()));
      const llmPort = (llmServer.address() as AddressInfo).port;

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

      const t = await createTestApp({
        durableDatabase: true,
        config: {
          port,
          cliEntry: CLI_DIST_ENTRY,
        },
      });

      currentFetch = (req) => t.app.fetch(req);

      try {
        const { cookie: adminCookie } = await loginAdmin(t.app);
        const adminHttp = apiClient(t.app, adminCookie);
        const agentAuth = t.boot.tree.api<AgentAuth>("IdentityModule", "AgentAuth");

        // 1. Inspect seeded default_agent auth and available workflows
        const seedAuthRes = await adminHttp.get(
          "/api/projects/default_project/agents/default_agent/auth",
        );
        expect(seedAuthRes.status).toBe(200);
        const seedAuthBody = (await seedAuthRes.json()) as {
          role: string;
          availableAgentRoles: Array<{ id: string }>;
          refinedRoutes: Record<string, string[]>;
        };
        expect(seedAuthBody.role).toBe("general");
        const workflowIds = seedAuthBody.availableAgentRoles.map((r) => r.id);
        for (const wf of [
          "none",
          "readonly",
          "general",
          "general-with-ask",
          "system-maintainer",
          "admin",
          "full-permissions",
        ]) {
          expect(workflowIds).toContain(wf);
        }
        expect(seedAuthBody.refinedRoutes["agent.config.update"]).toEqual(["self"]);

        // Configure local OpenAI-compatible model under `custom` group
        const putModelsRes = await adminHttp.put("/api/projects/default_project/models", {
          models: [
            {
              provider: "custom",
              modelId: "local-e2e-model",
              clientType: "openai-chat",
              apiKey: "sk-e2e-local",
              baseUrl: `http://127.0.0.1:${llmPort}/v1`,
            },
          ],
          defaultModel: { provider: "custom", modelId: "local-e2e-model" },
        });
        expect(putModelsRes.status).toBe(200);

        // Create `qa_runner` and `qa_peer`
        expect(
          (
            await adminHttp.post("/api/projects/default_project/agents", {
              agentId: "qa_runner",
            })
          ).status,
        ).toBe(201);
        expect(
          (
            await adminHttp.post("/api/projects/default_project/agents", {
              agentId: "qa_peer",
            })
          ).status,
        ).toBe(201);

        const rootToken = t.deps.authService.localApiToken();
        // Simulate a pre-existing Agent from before the migration (no `auth_generations` or
        // `auth_role_sessions` rows in DB) and verify that starting its Session still provisions
        // a role-scoped Agent Session token rather than falling back to `rootToken`.
        agentAuth.revokeAll("default_project", "qa_runner");
        expect(agentAuth.generationOf("default_project", "qa_runner")).toBeNull();

        const createSessRes = await adminHttp.post(
          "/api/projects/default_project/agents/qa_runner/sessions",
          {
            provider: "custom",
            modelId: "local-e2e-model",
            approvalMode: "allow-all",
          },
        );
        expect(createSessRes.status).toBe(201);
        const { session } = (await createSessRes.json()) as {
          session: { sessionId: string };
        };
        let sessionId = session.sessionId;

        const runSessionTurn = async (cmdToRun: string) => {
          const startRes = await adminHttp.post(`/api/sessions/${sessionId}/tasks`, {
            input: [{ type: "text", text: `CMD_TO_RUN: ${cmdToRun}` }],
          });
          expect(startRes.status).toBe(202);
          const started = (await startRes.json()) as { sessionId: string };
          sessionId = started.sessionId;

          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 150));
            if (t.deps.manager.statusOf(sessionId) === "idle") break;
          }
          expect(t.deps.manager.statusOf(sessionId)).toBe("idle");
        };

        // =========================================================================
        // TURN 1: Verify restrictions under `general` role and file upgrade requests
        // =========================================================================
        const turn1Script = path.join(t.root, "probe-turn1.mjs");
        const turn1ReportPath = path.join(t.root, "report-turn1.json");
        fs.writeFileSync(
          turn1Script,
          `import { execFileSync } from "node:child_process";
import fs from "node:fs";

const apiUrl = process.env.PENGUIN_API_URL;
const token = process.env.PENGUIN_API_TOKEN;
const projectId = process.env.PENGUIN_PROJECT_ID;
const agentId = process.env.PENGUIN_AGENT_ID;
const cliEntry = ${JSON.stringify(CLI_DIST_ENTRY)};

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, stdout: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      exitCode: err.status ?? 1,
      stderr: String(err.stderr ?? "").trim(),
    };
  }
}

async function callApi(method, pathUrl, body) {
  const res = await fetch(\`\${apiUrl}\${pathUrl}\`, {
    method,
    headers: {
      origin: apiUrl,
      authorization: \`Bearer \${token}\`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json ?? text };
}

const ownAuth = await callApi("GET", \`/api/projects/\${projectId}/agents/\${agentId}/auth\`);
const ownConfig = await callApi("PUT", \`/api/projects/\${projectId}/agents/\${agentId}/config\`, {
  description: "Self updated by qa_runner in Turn 1",
});
const peerConfigDenied = await callApi("PUT", \`/api/projects/\${projectId}/agents/qa_peer/config\`, {
  description: "Unauthorized cross-agent update",
});
const adminUsersDenied = await callApi("GET", "/api/admin/users");
const cliAgentLs = runCli(["agent", "ls", "--json"]);
const cliVaultSetDenied = runCli(["config", "vault", "set", "--agent-id", agentId, "--key", "TURN1_KEY", "--value", "secret"]);

const reqOnce = await callApi("POST", \`/api/projects/\${projectId}/agents/\${agentId}/auth/requests\`, {
  grants: ["vault.maintain"],
  routeId: "vault.setEntry",
  reason: "Need one-time access to set vault entry",
});
const reqSession = await callApi("POST", \`/api/projects/\${projectId}/agents/\${agentId}/auth/requests\`, {
  grants: ["agent.maintain"],
  routeId: "agent.config.update",
  reason: "Need session-scoped cross-agent config maintenance",
});

fs.writeFileSync(${JSON.stringify(turn1ReportPath)}, JSON.stringify({
  sessionToken: token,
  ownAuthStatus: ownAuth.status,
  ownRole: ownAuth.body?.role,
  ownConfigStatus: ownConfig.status,
  peerConfigDeniedStatus: peerConfigDenied.status,
  peerConfigDeniedDetails: peerConfigDenied.body?.error?.details,
  adminUsersDeniedStatus: adminUsersDenied.status,
  adminUsersDeniedDetails: adminUsersDenied.body?.error?.details,
  cliAgentLsOk: cliAgentLs.ok,
  cliVaultSetDeniedOk: cliVaultSetDenied.ok,
  reqOnceId: reqOnce.body?.request?.requestId,
  reqSessionId: reqSession.body?.request?.requestId,
}, null, 2));
`,
        );

        await runSessionTurn(`${process.execPath} ${turn1Script}`);
        const r1 = JSON.parse(fs.readFileSync(turn1ReportPath, "utf8")) as {
          sessionToken: string;
          ownAuthStatus: number;
          ownRole: string;
          ownConfigStatus: number;
          peerConfigDeniedStatus: number;
          peerConfigDeniedDetails: {
            reason: string;
            suggestedWithAsk: string;
            upgradeRequestEndpoint: string;
          };
          adminUsersDeniedStatus: number;
          adminUsersDeniedDetails: { reason: string; suggestedWithAsk: string };
          cliAgentLsOk: boolean;
          cliVaultSetDeniedOk: boolean;
          reqOnceId: string;
          reqSessionId: string;
        };

        expect(r1.sessionToken).toBeTruthy();
        expect(r1.sessionToken).not.toBe(rootToken);
        expect(r1.ownAuthStatus).toBe(200);
        expect(r1.ownRole).toBe("general");
        expect(r1.ownConfigStatus).toBe(200);
        expect(r1.peerConfigDeniedStatus).toBe(403);
        expect(r1.peerConfigDeniedDetails.reason).toBe("refiner_denied");
        expect(r1.peerConfigDeniedDetails.suggestedWithAsk).toContain("agent.maintain@withAsk");
        expect(r1.peerConfigDeniedDetails.upgradeRequestEndpoint).toBe(
          "/api/projects/default_project/agents/qa_runner/auth/requests",
        );
        expect(r1.adminUsersDeniedStatus).toBe(403);
        expect(r1.adminUsersDeniedDetails.reason).toBe("role_missing_route_grant");
        expect(r1.cliAgentLsOk).toBe(true);
        expect(r1.cliVaultSetDeniedOk).toBe(false);

        // Approve Request A with `allowed_once` and Request B with `allowed_for_agent`
        expect(
          (
            await adminHttp.post(
              `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqOnceId}/decide`,
              { decision: "allowed_once" },
            )
          ).status,
        ).toBe(200);
        // Repeating `allowed_once` or flipping to `deny` on an already decided request is rejected with 409
        expect(
          (
            await adminHttp.post(
              `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqOnceId}/decide`,
              { decision: "allowed_once" },
            )
          ).status,
        ).toBe(409);
        expect(
          (
            await adminHttp.post(
              `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqSessionId}/decide`,
              { decision: "allowed_for_agent" },
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await adminHttp.post(
              `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqSessionId}/decide`,
              { decision: "deny" },
            )
          ).status,
        ).toBe(409);

        // =========================================================================
        // TURN 2: Verify `allowed_once` single-use consumption & `allowed_for_agent`
        // =========================================================================
        const turn2Script = path.join(t.root, "probe-turn2.mjs");
        const turn2ReportPath = path.join(t.root, "report-turn2.json");
        fs.writeFileSync(
          turn2Script,
          `import { execFileSync } from "node:child_process";
import fs from "node:fs";

const apiUrl = process.env.PENGUIN_API_URL;
const token = process.env.PENGUIN_API_TOKEN;
const projectId = process.env.PENGUIN_PROJECT_ID;
const agentId = process.env.PENGUIN_AGENT_ID;
const cliEntry = ${JSON.stringify(CLI_DIST_ENTRY)};

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, stdout: stdout.trim() };
  } catch (err) {
    return { ok: false, exitCode: err.status ?? 1 };
  }
}

async function callApi(method, pathUrl, body) {
  const res = await fetch(\`\${apiUrl}\${pathUrl}\`, {
    method,
    headers: {
      origin: apiUrl,
      authorization: \`Bearer \${token}\`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json ?? text };
}

const firstVaultSet = runCli(["config", "vault", "set", "--agent-id", agentId, "--key", "ONCE_KEY_1", "--value", "val1"]);
const secondVaultSet = runCli(["config", "vault", "set", "--agent-id", agentId, "--key", "ONCE_KEY_2", "--value", "val2"]);
const peerUpdate1 = await callApi("PUT", \`/api/projects/\${projectId}/agents/qa_peer/config\`, {
  description: "Updated by qa_runner call 1",
});
const peerUpdate2 = await callApi("PUT", \`/api/projects/\${projectId}/agents/qa_peer/config\`, {
  description: "Updated by qa_runner call 2",
});
const reqAlways = await callApi("POST", \`/api/projects/\${projectId}/agents/\${agentId}/auth/requests\`, {
  grants: ["vault.maintain"],
  routeId: "vault.setEntry",
  reason: "Need permanent vault maintenance",
});

fs.writeFileSync(${JSON.stringify(turn2ReportPath)}, JSON.stringify({
  firstVaultSetOk: firstVaultSet.ok,
  secondVaultSetOk: secondVaultSet.ok,
  peerUpdate1Status: peerUpdate1.status,
  peerUpdate2Status: peerUpdate2.status,
  reqAlwaysId: reqAlways.body?.request?.requestId,
}, null, 2));
`,
        );

        await runSessionTurn(`${process.execPath} ${turn2Script}`);
        const r2 = JSON.parse(fs.readFileSync(turn2ReportPath, "utf8")) as {
          firstVaultSetOk: boolean;
          secondVaultSetOk: boolean;
          peerUpdate1Status: number;
          peerUpdate2Status: number;
          reqAlwaysId: string;
        };

        expect(r2.firstVaultSetOk).toBe(true);
        expect(r2.secondVaultSetOk).toBe(false);
        expect(r2.peerUpdate1Status).toBe(200);
        expect(r2.peerUpdate2Status).toBe(200);

        const midAuth = (await (
          await adminHttp.get("/api/projects/default_project/agents/qa_runner/auth")
        ).json()) as {
          apiIds: string[];
          temporaryGrants: { agentSessionGrants: string[] };
        };
        expect(midAuth.temporaryGrants.agentSessionGrants).toContain("agent.maintain");
        expect(midAuth.apiIds).not.toContain("agent.maintain");

        // Approve Request C with `always_allowed`
        expect(
          (
            await adminHttp.post(
              `/api/projects/default_project/agents/qa_runner/auth/requests/${r2.reqAlwaysId}/decide`,
              { decision: "always_allowed" },
            )
          ).status,
        ).toBe(200);

        const afterAlwaysAuth = (await (
          await adminHttp.get("/api/projects/default_project/agents/qa_runner/auth")
        ).json()) as { apiIds: string[] };
        expect(afterAlwaysAuth.apiIds).toContain("vault.maintain");

        // =========================================================================
        // TURN 3: Verify `always_allowed` permanent role grant across calls
        // =========================================================================
        const turn3Script = path.join(t.root, "probe-turn3.mjs");
        const turn3ReportPath = path.join(t.root, "report-turn3.json");
        fs.writeFileSync(
          turn3Script,
          `import { execFileSync } from "node:child_process";
import fs from "node:fs";

const agentId = process.env.PENGUIN_AGENT_ID;
const cliEntry = ${JSON.stringify(CLI_DIST_ENTRY)};

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, stdout: stdout.trim() };
  } catch (err) {
    return { ok: false, exitCode: err.status ?? 1 };
  }
}

const perm1 = runCli(["config", "vault", "set", "--agent-id", agentId, "--key", "PERM_1", "--value", "v1"]);
const perm2 = runCli(["config", "vault", "set", "--agent-id", "qa_peer", "--key", "PERM_2", "--value", "v2"]);

fs.writeFileSync(${JSON.stringify(turn3ReportPath)}, JSON.stringify({ perm1Ok: perm1.ok, perm2Ok: perm2.ok }, null, 2));
`,
        );

        await runSessionTurn(`${process.execPath} ${turn3Script}`);
        const r3 = JSON.parse(fs.readFileSync(turn3ReportPath, "utf8")) as {
          perm1Ok: boolean;
          perm2Ok: boolean;
        };
        expect(r3.perm1Ok).toBe(true);
        expect(r3.perm2Ok).toBe(true);

        // =========================================================================
        // Verify Role Mismatch Fallback & Custom AgentRole (`defineRole`)
        // =========================================================================
        const mismatchRes = await adminHttp.put(
          "/api/projects/default_project/agents/qa_peer/auth",
          {
            role: "deprecated-role-v1",
            inherits: ["uninstalled_plugin.maintain", "obsolete.route@self"],
          },
        );
        expect(mismatchRes.status).toBe(200);
        const mismatchBody = (await mismatchRes.json()) as {
          mismatches: {
            hasMismatch: boolean;
            unknownPrimaryRole?: boolean;
            fallbackRole?: string;
            unknownRoles: string[];
            unknownRoutes: string[];
          };
        };
        expect(mismatchBody.mismatches.hasMismatch).toBe(true);
        expect(mismatchBody.mismatches.unknownPrimaryRole).toBe(true);
        expect(mismatchBody.mismatches.fallbackRole).toBe("readonly");
        expect(mismatchBody.mismatches.unknownRoles).toContain("deprecated-role-v1");
        expect(mismatchBody.mismatches.unknownRoles).toContain("uninstalled_plugin.maintain");
        expect(mismatchBody.mismatches.unknownRoutes).toContain("obsolete.route");

        const customRoleRes = await adminHttp.put(
          "/api/projects/default_project/agents/qa_peer/auth",
          {
            defineRole: {
              id: "custom-reviewer",
              title: "Custom Reviewer",
              description: "Readonly plus self schedule maintenance",
              inherits: ["readonly", "schedule.maintain@self"],
            },
            role: "custom-reviewer",
          },
        );
        expect(customRoleRes.status).toBe(200);
        const customRoleBody = (await customRoleRes.json()) as {
          role: string;
          refinedRoutes: Record<string, string[]>;
        };
        expect(customRoleBody.role).toBe("custom-reviewer");
        expect(customRoleBody.refinedRoutes["schedule.create"]).toEqual(["self"]);
      } finally {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        await new Promise<void>((resolve) => llmServer.close(() => resolve()));
        await t.cleanup();
      }
    },
  );
});
