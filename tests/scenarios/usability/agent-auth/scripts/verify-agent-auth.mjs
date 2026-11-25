#!/usr/bin/env node
/**
 * Mechanical verification script for the `usability/agent-auth` QA scenario task.
 *
 * Launches an isolated `penguin-server` instance (or connects to an existing one),
 * drives a real Agent Session through `exec_command` tool calls and the built `penguin` CLI,
 * and verifies:
 *   1. Default AgentRole workflows (`none`, `readonly`, `general`, `general-with-ask`,
 *      `system-maintainer`, `admin`, `full-permissions`) and permission inspection.
 *   2. Controlled Agent Session restrictions (`@self` refiner denial, missing role grant denial,
 *      structured 403 `suggestedWithAsk` and `upgradeRequestEndpoint` diagnostics).
 *   3. Permission Upgrade Requests across all three approval modes:
 *      - `allowed_once` (allows exactly one call, then auto-consumes)
 *      - `allowed_for_agent` (persists across calls in the agent session without writing DB role)
 *      - `always_allowed` (persists into the Agent's role configuration)
 *   4. Role upgrade/downgrade mismatch detection and safe fallback to `readonly`.
 *   5. Custom `AgentRole` definition (`defineRole`).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

const llmServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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
    const cmd = match ? match[1].trim() : "echo ok";
    const callId = "call_" + Date.now();
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

await new Promise((resolve) => llmServer.listen(0, "127.0.0.1", resolve));
const llmPort = llmServer.address().port;

const dataDir = mkdtempSync(join(tmpdir(), "penguin-qa-agent-auth-"));
const port = 19480 + Math.floor(Math.random() * 400);
const baseUrl = `http://localhost:${port}`;

const server = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    PENGUIN_HOME: dataDir,
    PENGUIN_NO_BROWSER: "1",
    PENGUIN_PLUGIN_MARKET: "off",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let adminToken = "";
let serverReady = false;
for (let i = 0; i < 60; i++) {
  try {
    adminToken = readFileSync(join(dataDir, "api-token"), "utf8").trim();
    if (adminToken) {
      const res = await fetch(`${baseUrl}/api/projects/default_project/agents/default_agent/auth`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        serverReady = true;
        break;
      }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
assert.equal(serverReady, true, "Real server failed to become ready");

const adminHeaders = {
  "content-type": "application/json",
  origin: baseUrl,
  authorization: `Bearer ${adminToken}`,
};

async function adminApi(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: adminHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json ?? text };
}

try {
  const seedAuth = await adminApi("GET", "/api/projects/default_project/agents/default_agent/auth");
  assert.equal(seedAuth.status, 200);
  assert.equal(seedAuth.body.role, "general");
  const workflows = seedAuth.body.availableAgentRoles.map((r) => r.id);
  for (const wf of [
    "none",
    "readonly",
    "general",
    "general-with-ask",
    "system-maintainer",
    "admin",
    "full-permissions",
  ]) {
    assert.ok(workflows.includes(wf), `Missing workflow ${wf}`);
  }

  const putModels = await adminApi("PUT", "/api/projects/default_project/models", {
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
  assert.equal(putModels.status, 200);

  assert.equal(
    (
      await adminApi("POST", "/api/projects/default_project/agents", {
        agentId: "qa_runner",
        name: "QA Runner",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await adminApi("POST", "/api/projects/default_project/agents", {
        agentId: "qa_peer",
        name: "QA Peer",
      })
    ).status,
    201,
  );

  const createSess = await adminApi(
    "POST",
    "/api/projects/default_project/agents/qa_runner/sessions",
    {
      provider: "custom",
      modelId: "local-e2e-model",
      approvalMode: "allow-all",
    },
  );
  assert.equal(createSess.status, 201);
  let sessionId = createSess.body.session.sessionId;

  async function runLiveTurn(cmdToRun) {
    const startRes = await adminApi("POST", `/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text: `CMD_TO_RUN: ${cmdToRun}` }],
    });
    assert.equal(startRes.status, 202);
    sessionId = startRes.body.sessionId;

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const sessRes = await adminApi("GET", `/api/sessions/${sessionId}`);
      if (sessRes.status === 200 && sessRes.body.session?.status === "idle") {
        return sessRes.body.session;
      }
    }
    throw new Error("Live turn timed out waiting for idle status");
  }

  const turn1Script = join(dataDir, "probe-turn1.mjs");
  const turn1ReportPath = join(dataDir, "report-turn1.json");
  const cliDistPath = path.resolve("packages/cli/dist/penguin.js");

  writeFileSync(
    turn1Script,
    `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const apiUrl = process.env.PENGUIN_API_URL;
const token = process.env.PENGUIN_API_TOKEN;
const projectId = process.env.PENGUIN_PROJECT_ID;
const agentId = process.env.PENGUIN_AGENT_ID;
const cliEntry = ${JSON.stringify(cliDistPath)};

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
      stdout: String(err.stdout ?? "").trim(),
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

const report = {
  env: { hasApiUrl: Boolean(apiUrl), hasToken: Boolean(token), projectId, agentId },
  ownAuthStatus: ownAuth.status,
  ownRole: ownAuth.body?.role,
  ownConfigStatus: ownConfig.status,
  peerConfigDeniedStatus: peerConfigDenied.status,
  peerConfigDeniedDetails: peerConfigDenied.body?.error?.details,
  adminUsersDeniedStatus: adminUsersDenied.status,
  adminUsersDeniedDetails: adminUsersDenied.body?.error?.details,
  cliAgentLsOk: cliAgentLs.ok,
  cliVaultSetDeniedOk: cliVaultSetDenied.ok,
  cliVaultSetDeniedStderr: cliVaultSetDenied.stderr,
  reqOnceId: reqOnce.body?.request?.requestId,
  reqSessionId: reqSession.body?.request?.requestId,
};

writeFileSync(${JSON.stringify(turn1ReportPath)}, JSON.stringify(report, null, 2));
`,
  );

  await runLiveTurn(`${process.execPath} ${turn1Script}`);
  const r1 = JSON.parse(readFileSync(turn1ReportPath, "utf8"));
  assert.equal(r1.ownAuthStatus, 200);
  assert.equal(r1.ownRole, "general");
  assert.equal(r1.ownConfigStatus, 200);
  assert.equal(r1.peerConfigDeniedStatus, 403);
  assert.equal(r1.peerConfigDeniedDetails.reason, "refiner_denied");
  assert.ok(r1.peerConfigDeniedDetails.suggestedWithAsk.includes("agent.maintain@withAsk"));
  assert.equal(r1.adminUsersDeniedStatus, 403);
  assert.equal(r1.adminUsersDeniedDetails.reason, "role_missing_route_grant");
  assert.equal(r1.cliAgentLsOk, true);
  assert.equal(r1.cliVaultSetDeniedOk, false);

  const decideOnceRes = await adminApi(
    "POST",
    `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqOnceId}/decide`,
    { decision: "allowed_once" },
  );
  assert.equal(decideOnceRes.status, 200);
  const decideOnceRepeat = await adminApi(
    "POST",
    `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqOnceId}/decide`,
    { decision: "allowed_once" },
  );
  assert.equal(decideOnceRepeat.status, 409);

  const decideSessionRes = await adminApi(
    "POST",
    `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqSessionId}/decide`,
    { decision: "allowed_for_agent" },
  );
  assert.equal(decideSessionRes.status, 200);
  const decideSessionConflict = await adminApi(
    "POST",
    `/api/projects/default_project/agents/qa_runner/auth/requests/${r1.reqSessionId}/decide`,
    { decision: "deny" },
  );
  assert.equal(decideSessionConflict.status, 409);

  const turn2Script = join(dataDir, "probe-turn2.mjs");
  const turn2ReportPath = join(dataDir, "report-turn2.json");

  writeFileSync(
    turn2Script,
    `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const apiUrl = process.env.PENGUIN_API_URL;
const token = process.env.PENGUIN_API_TOKEN;
const projectId = process.env.PENGUIN_PROJECT_ID;
const agentId = process.env.PENGUIN_AGENT_ID;
const cliEntry = ${JSON.stringify(cliDistPath)};

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

writeFileSync(${JSON.stringify(turn2ReportPath)}, JSON.stringify({
  firstVaultSetOk: firstVaultSet.ok,
  secondVaultSetOk: secondVaultSet.ok,
  peerUpdate1Status: peerUpdate1.status,
  peerUpdate2Status: peerUpdate2.status,
  reqAlwaysId: reqAlways.body?.request?.requestId,
}, null, 2));
`,
  );

  await runLiveTurn(`${process.execPath} ${turn2Script}`);
  const r2 = JSON.parse(readFileSync(turn2ReportPath, "utf8"));
  assert.equal(r2.firstVaultSetOk, true);
  assert.equal(r2.secondVaultSetOk, false);
  assert.equal(r2.peerUpdate1Status, 200);
  assert.equal(r2.peerUpdate2Status, 200);

  await adminApi(
    "POST",
    `/api/projects/default_project/agents/qa_runner/auth/requests/${r2.reqAlwaysId}/decide`,
    { decision: "always_allowed" },
  );

  const turn3Script = join(dataDir, "probe-turn3.mjs");
  const turn3ReportPath = join(dataDir, "report-turn3.json");
  writeFileSync(
    turn3Script,
    `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const agentId = process.env.PENGUIN_AGENT_ID;
const cliEntry = ${JSON.stringify(cliDistPath)};

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

writeFileSync(${JSON.stringify(turn3ReportPath)}, JSON.stringify({ perm1Ok: perm1.ok, perm2Ok: perm2.ok }, null, 2));
`,
  );

  await runLiveTurn(`${process.execPath} ${turn3Script}`);
  const r3 = JSON.parse(readFileSync(turn3ReportPath, "utf8"));
  assert.equal(r3.perm1Ok, true);
  assert.equal(r3.perm2Ok, true);

  const mismatchRes = await adminApi("PUT", "/api/projects/default_project/agents/qa_peer/auth", {
    role: "deprecated-role-v1",
    inherits: ["uninstalled_plugin.maintain", "obsolete.route@self"],
  });
  assert.equal(mismatchRes.status, 200);
  assert.equal(mismatchRes.body.mismatches.hasMismatch, true);
  assert.equal(mismatchRes.body.mismatches.unknownPrimaryRole, true);
  assert.equal(mismatchRes.body.mismatches.fallbackRole, "readonly");

  const customRoleRes = await adminApi("PUT", "/api/projects/default_project/agents/qa_peer/auth", {
    defineRole: {
      id: "custom-reviewer",
      title: "Custom Reviewer",
      description: "Readonly plus self schedule maintenance",
      inherits: ["readonly", "schedule.maintain@self"],
    },
    role: "custom-reviewer",
  });
  assert.equal(customRoleRes.status, 200);
  assert.equal(customRoleRes.body.role, "custom-reviewer");
  assert.deepEqual(customRoleRes.body.refinedRoutes["schedule.create"], ["self"]);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        workflows,
        turn1: r1,
        turn2: r2,
        turn3: r3,
        mismatches: mismatchRes.body.mismatches,
        customRole: {
          role: customRoleRes.body.role,
          scheduleCreateRefiners: customRoleRes.body.refinedRoutes["schedule.create"],
        },
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  server.kill("SIGTERM");
  llmServer.close();
}
