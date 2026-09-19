import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { methods } from "@agentclientprotocol/sdk";
import { CodexBridge } from "../src/bridge.mjs";
import { codexEnvironment } from "../src/codex-profile.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const info = {
  authMethods: [{ id: "chat-gpt-device-code" }],
  agentCapabilities: { auth: { logout: {} }, sessionCapabilities: { resume: {}, close: {} } },
};
class FakeAcp {
  listeners = new Set();
  handlers = new Map();
  calls = [];
  account = "chat-gpt";
  turns = [];
  starts = 0;
  async start() {
    this.starts++;
    return info;
  }
  emit(method, params) {
    for (const listener of this.listeners) listener({ method, params });
  }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "authentication/status")
      return { type: this.account, email: "private@example.test" };
    if (method === methods.agent.authenticate) {
      this.auth = deferred();
      this.authResponse = this.handlers.get(methods.client.elicitation.create)({
        mode: "url",
        url: "https://auth.openai.com/codex/device",
        message: "Enter TEST-CODE",
        elicitationId: "login",
      });
      return this.auth.promise;
    }
    if (method === methods.agent.logout) {
      this.account = "unauthenticated";
      return {};
    }
    if ([methods.agent.session.new, methods.agent.session.resume].includes(method))
      return {
        sessionId: params.sessionId ?? "session",
        modes: { availableModes: [{ id: "read-only" }, { id: "agent" }] },
        models: { availableModels: [{ modelId: "live-model" }] },
        configOptions: [{ id: "model", category: "model" }],
      };
    if (method === methods.agent.session.prompt) {
      const turn = deferred();
      this.turns.push(turn);
      return turn.promise;
    }
    return {};
  }
  async notify(method, params) {
    this.calls.push({ method, params });
  }
  close() {
    this.closed = true;
    this.emit("bridge/closed", {});
    for (const turn of this.turns) turn.reject(new Error("closed"));
    this.auth?.reject(new Error("closed"));
  }
}
function setup(t, options = {}) {
  const client = new FakeAcp();
  const bridge = new CodexBridge({ client, cwd: process.cwd(), ...options });
  t.after(() => bridge.close());
  return { client, bridge };
}

test("rejects removed sandbox options before launching, and exposes actual writable policy", async (t) => {
  const { client, bridge } = setup(t);
  await assert.rejects(bridge.call("codex_run", { prompt: "review", sandbox: "read-only" }));
  assert.equal(client.starts, 0);
  const task = await bridge.call("codex_run", { prompt: "edit", model: "live-model" });
  assert.deepEqual(task.execution_policy, {
    sandbox: "workspace-write",
    approval_policy: "on-request",
    approvals_reviewer: "user",
  });
  assert.equal(
    client.calls.find((c) => c.method === methods.agent.session.setMode).params.modeId,
    "read-only",
  );
  assert.equal(
    client.calls.find((c) => c.method === methods.agent.session.setConfigOption).params.value,
    "live-model",
  );
  await assert.rejects(bridge.call("codex_run", { prompt: "concurrent" }), /One delegated task/);
});
test("login URL arrives asynchronously, no credentials leak, and completion is observed", async (t) => {
  const { client, bridge } = setup(t);
  client.account = "unauthenticated";
  await bridge.call("codex_connect");
  const status = await bridge.call("codex_status");
  assert.equal(status.login.message, "Enter TEST-CODE");
  assert.equal(status.account.email, undefined);
  assert.equal(status.limits, null);
  client.account = "chat-gpt";
  client.emit(methods.client.elicitation.complete, { elicitationId: "login" });
  assert.deepEqual(await client.authResponse, { action: "accept" });
  client.auth.resolve({});
  await sleep(0);
  assert.equal((await bridge.call("codex_status")).login.status, "connected");
  await bridge.call("codex_disconnect");
  assert.equal(client.account, "unauthenticated");
});
test("API-key accounts cannot delegate; model discovery closes its unprompted session", async (t) => {
  const { client, bridge } = setup(t);
  client.account = "api-key";
  await assert.rejects(bridge.call("codex_run", { prompt: "edit" }), /ChatGPT/);
  client.account = "chat-gpt";
  const result = await bridge.call("codex_models");
  assert.equal(result.models.availableModels[0].modelId, "live-model");
  assert.equal(client.turns.length, 0);
  assert.ok(client.calls.some((c) => c.method === methods.agent.session.close));
});
test("permissions wait for a human, select one-time options, and cannot be reused", async (t) => {
  const { client, bridge } = setup(t);
  const task = await bridge.call("codex_run", { prompt: "edit" });
  const reply = client.handlers.get(methods.client.session.requestPermission)({
    sessionId: "session",
    toolCall: { title: "Command" },
    options: [
      { kind: "allow_always", optionId: "always" },
      { kind: "allow_once", optionId: "once" },
    ],
  });
  const request_id = (await bridge.call("codex_poll", { task_id: task.task_id })).requests[0]
    .request_id;
  await bridge.call("codex_respond", { task_id: task.task_id, request_id, decision: "accept" });
  assert.deepEqual(await reply, { outcome: { outcome: "selected", optionId: "once" } });
  await assert.rejects(
    bridge.call("codex_respond", { task_id: task.task_id, request_id, decision: "accept" }),
    /no longer pending/,
  );
});
test("form answers validate schema; peer cancellation removes stale requests", async (t) => {
  const { client, bridge } = setup(t);
  const task = await bridge.call("codex_run", { prompt: "edit" });
  const signal = new AbortController();
  const reply = client.handlers.get(methods.client.elicitation.create)(
    {
      mode: "form",
      message: "Choose",
      requestedSchema: {
        type: "object",
        properties: { choice: { type: "string", enum: ["one", "two"] } },
        required: ["choice"],
        additionalProperties: false,
      },
    },
    signal.signal,
  );
  const request_id = (await bridge.call("codex_poll", { task_id: task.task_id })).requests[0]
    .request_id;
  await assert.rejects(
    bridge.call("codex_respond", {
      task_id: task.task_id,
      request_id,
      decision: "accept",
      answers: { choice: "invalid" },
    }),
  );
  signal.abort();
  assert.deepEqual(await reply, { action: "cancel" });
  assert.equal((await bridge.call("codex_poll", { task_id: task.task_id })).requests.length, 0);
  assert.deepEqual(
    await client.handlers.get(methods.client.elicitation.create)({
      mode: "url",
      url: "https://example.test",
    }),
    { action: "cancel" },
  );
});
test("updates are bounded and repeatable, sessions resume, cancellation waits for stop", async (t) => {
  const { client, bridge } = setup(t);
  const task = await bridge.call("codex_run", { prompt: "edit" });
  for (let i = 0; i < 12; i++)
    client.emit(methods.client.session.update, {
      sessionId: "session",
      update: { text: "x".repeat(30000) },
    });
  const poll = await bridge.call("codex_poll", { task_id: task.task_id });
  assert.equal(poll.truncated, true);
  assert.ok(JSON.stringify(poll.events).length < 110000);
  assert.deepEqual(await bridge.call("codex_poll", { task_id: task.task_id }), poll);
  client.turns[0].resolve({ stopReason: "end_turn" });
  await sleep(0);
  const resumed = await bridge.call("codex_run", { prompt: "continue", thread_id: task.thread_id });
  assert.ok(client.calls.some((c) => c.method === methods.agent.session.resume));
  await bridge.call("codex_cancel", { task_id: resumed.task_id });
  assert.equal((await bridge.call("codex_poll", { task_id: resumed.task_id })).status, "running");
  client.turns[1].resolve({ stopReason: "cancelled" });
  await sleep(0);
  assert.equal(
    (await bridge.call("codex_poll", { task_id: resumed.task_id })).status,
    "interrupted",
  );
});
test("unanswered requests expire and a non-cooperative task is terminated", async (t) => {
  const { client, bridge } = setup(t, { requestTimeoutMs: 10, cancelTimeoutMs: 10 });
  const task = await bridge.call("codex_run", { prompt: "edit" });
  const reply = client.handlers.get(methods.client.session.requestPermission)({
    sessionId: "session",
    options: [],
  });
  assert.deepEqual(await reply, { outcome: { outcome: "cancelled" } });
  await sleep(40);
  assert.equal(client.closed, true);
  assert.equal((await bridge.call("codex_poll", { task_id: task.task_id })).status, "failed");
});
test("deadline cancels and stop reasons do not claim incomplete work completed", async (t) => {
  const { client, bridge } = setup(t, { taskTimeoutMs: 10, cancelTimeoutMs: 100 });
  const task = await bridge.call("codex_run", { prompt: "edit" });
  await sleep(30);
  assert.ok(client.calls.some((c) => c.method === methods.agent.session.cancel));
  client.turns[0].resolve({ stopReason: "max_tokens" });
  await sleep(0);
  assert.equal((await bridge.call("codex_poll", { task_id: task.task_id })).status, "stopped");
});
test("project profile strips host credentials and adapter overrides", () => {
  const env = codexEnvironment("project-home", {
    PATH: "bin",
    CODEX_HOME: "desktop",
    CODEX_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    CODEX_PATH: "other",
    DEFAULT_AUTH_REQUEST: "api-key",
    INITIAL_AGENT_MODE: "agent-full-access",
    NODE_OPTIONS: "--require injection",
  });
  assert.equal(env.CODEX_HOME, "project-home");
  assert.equal(env.INITIAL_AGENT_MODE, "read-only");
  for (const key of [
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_PATH",
    "NODE_OPTIONS",
    "DEFAULT_AUTH_REQUEST",
  ])
    assert.equal(env[key], undefined);
  assert.equal(JSON.parse(env.CODEX_CONFIG).forced_login_method, "chatgpt");
});
