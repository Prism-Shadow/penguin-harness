import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexBridge, TOOLS } from "../skills/codex/scripts/bridge.mjs";
import { CodexClient } from "../skills/codex/scripts/client.mjs";

class FakeCodex {
  listeners = new Set();
  calls = [];
  sent = [];
  account = { type: "chatgpt", planType: "plus", secret: "do-not-expose" };
  async start() {}
  emit(method, params, id) {
    for (const listener of this.listeners)
      listener({ method, params, ...(id === undefined ? {} : { id }) });
  }
  send(msg) {
    this.sent.push(msg);
  }
  close() {
    this.emit("bridge/closed", { message: "closed" });
  }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "account/read") return { account: this.account };
    if (method === "account/login/start")
      return {
        loginId: "login",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD",
      };
    if (method === "model/list")
      return {
        data: [{ id: params.cursor ? "new-model" : "another-model" }],
        nextCursor: params.cursor ? null : "page2",
      };
    if (method === "thread/start" || method === "thread/resume")
      return { thread: { id: params.threadId ?? "thread" } };
    if (method === "turn/start") {
      this.emit("item/agentMessage/delta", { threadId: "thread", delta: "working" });
      return { turn: { id: "turn" } };
    }
    if (method === "turn/interrupt")
      this.emit("turn/completed", { threadId: "thread", turn: { status: "interrupted" } });
    return {};
  }
}
function setup(t) {
  const client = new FakeCodex();
  const bridge = new CodexBridge({ client, cwd: "/workspace" });
  t.after(() => bridge.close());
  return { client, bridge };
}

test("device login completion, cancellation, sign-out, and account output exclude credentials", async (t) => {
  const { bridge, client } = setup(t);
  const login = await bridge.call("codex_connect");
  assert.equal(login.userCode, "ABCD");
  assert.equal((await bridge.call("codex_status")).login.status, "pending");
  await bridge.call("codex_connect");
  assert.ok(client.calls.some((c) => c.method === "account/login/cancel"));
  client.emit("account/login/completed", { loginId: "login", success: true });
  const status = await bridge.call("codex_status");
  assert.equal(status.login.status, "connected");
  assert.equal(JSON.stringify(status).includes("do-not-expose"), false);
  assert.equal((await bridge.call("codex_disconnect")).status, "disconnected");
});

test("model discovery paginates and run refuses API-key billing", async (t) => {
  const { bridge, client } = setup(t);
  assert.equal((await bridge.call("codex_models")).models.length, 2);
  client.account = { type: "apiKey" };
  await assert.rejects(bridge.call("codex_run", { prompt: "inspect" }), /ChatGPT/);
  assert.equal(
    client.calls.some((c) => c.method === "thread/start"),
    false,
  );
});

test("login completion arriving before the start response is retained", async (t) => {
  const { bridge, client } = setup(t);
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === "account/login/start")
      client.emit("account/login/completed", { loginId: "login", success: true });
    return request(method, params);
  };
  assert.equal((await bridge.call("codex_connect")).status, "connected");
});

test("unanswered approvals and task deadlines interrupt work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { bridge, client } = setup(t);
  const run = await bridge.call("codex_run", { prompt: "inspect" });
  client.emit("item/fileChange/requestApproval", { threadId: "thread" }, 22);
  t.mock.timers.tick(5 * 60_000);
  await Promise.resolve();
  assert.equal((await bridge.call("codex_poll", { task_id: run.task_id })).status, "interrupted");
  assert.equal(client.sent[0].error.message, "Human response timed out");
  const next = await bridge.call("codex_run", { prompt: "inspect" });
  t.mock.timers.tick(30 * 60_000);
  await Promise.resolve();
  const poll = await bridge.call("codex_poll", { task_id: next.task_id });
  assert.equal(poll.status, "interrupted");
  assert.ok(poll.events.some((event) => event.type === "timeout"));
});

test("run captures early events, preserves thread continuity and requires explicit writable sandbox", async (t) => {
  const { bridge, client } = setup(t);
  const run = await bridge.call("codex_run", { prompt: "inspect" });
  assert.equal(client.calls.find((c) => c.method === "thread/start").params.sandbox, "read-only");
  assert.equal(
    client.calls.find((c) => c.method === "thread/start").params.approvalPolicy,
    "untrusted",
  );
  assert.equal(
    client.calls.find((c) => c.method === "thread/start").params.approvalsReviewer,
    "user",
  );
  assert.equal(
    (await bridge.call("codex_poll", { task_id: run.task_id })).events[0].data.delta,
    "working",
  );
  await assert.rejects(bridge.call("codex_connect"), /running/);
  await assert.rejects(bridge.call("codex_run", { prompt: "conflicting edit" }), /One Codex task/);
  client.emit("turn/completed", { threadId: "thread", turn: { status: "completed" } });
  await bridge.call("codex_run", {
    prompt: "edit",
    thread_id: run.thread_id,
    sandbox: "workspace-write",
  });
  assert.equal(
    client.calls.find((c) => c.method === "thread/resume").params.threadId,
    run.thread_id,
  );
  assert.equal(
    client.calls.find((c) => c.method === "thread/resume").params.sandbox,
    "workspace-write",
  );
});

test("approvals wait for an explicit response and cannot be answered twice", async (t) => {
  const { bridge, client } = setup(t);
  const run = await bridge.call("codex_run", { prompt: "edit" });
  client.emit(
    "item/commandExecution/requestApproval",
    { threadId: "thread", turnId: "turn", command: "test" },
    19,
  );
  assert.equal(client.sent.length, 0);
  const poll = await bridge.call("codex_poll", { task_id: run.task_id });
  const id = poll.requests[0].request_id;
  await bridge.call("codex_respond", { task_id: run.task_id, request_id: id, decision: "decline" });
  assert.deepEqual(client.sent[0], { id: 19, result: { decision: "decline" } });
  await assert.rejects(
    bridge.call("codex_respond", { task_id: run.task_id, request_id: id, decision: "accept" }),
    /no longer pending/,
  );
  assert.equal(TOOLS.find((t) => t.name === "codex_respond").annotations.readOnlyHint, false);
});

test("user questions relay answers; unsupported permission expansion fails closed", async (t) => {
  const { bridge, client } = setup(t);
  const run = await bridge.call("codex_run", { prompt: "inspect" });
  client.emit("item/tool/requestUserInput", { threadId: "thread", questions: [{ id: "q" }] }, 20);
  const poll = await bridge.call("codex_poll", { task_id: run.task_id });
  await bridge.call("codex_respond", {
    task_id: run.task_id,
    request_id: poll.requests[0].request_id,
    answers: { q: ["yes"] },
  });
  assert.deepEqual(client.sent[0].result, { answers: { q: { answers: ["yes"] } } });
  client.emit(
    "item/permissions/requestApproval",
    { threadId: "thread", permissions: { network: true } },
    21,
  );
  assert.equal(client.sent[1].error.code, -32601);
});

test("progress cursors are repeatable, output is bounded, cancellation and process loss are terminal", async (t) => {
  const { bridge, client } = setup(t);
  const run = await bridge.call("codex_run", { prompt: "inspect" });
  for (let i = 0; i < 200; i++)
    client.emit("item/agentMessage/delta", { threadId: "thread", delta: "x".repeat(1000) });
  const first = await bridge.call("codex_poll", { task_id: run.task_id });
  assert.equal(first.truncated, true);
  assert.ok(JSON.stringify(first).length < 110_000);
  assert.deepEqual(await bridge.call("codex_poll", { task_id: run.task_id }), first);
  assert.equal(
    (await bridge.call("codex_poll", { task_id: run.task_id, cursor: first.cursor })).events.length,
    0,
  );
  await bridge.call("codex_cancel", { task_id: run.task_id });
  assert.equal((await bridge.call("codex_poll", { task_id: run.task_id })).status, "interrupted");
  const next = await bridge.call("codex_run", { prompt: "inspect" });
  client.close();
  assert.equal((await bridge.call("codex_poll", { task_id: next.task_id })).status, "failed");
});

test("invalid arguments fail before contacting Codex", async (t) => {
  const { bridge, client } = setup(t);
  for (const args of [
    {},
    { prompt: "" },
    { prompt: "ok", sandbox: "danger-full-access" },
    { prompt: "ok", cwd: "/other" },
  ])
    await assert.rejects(bridge.call("codex_run", args));
  assert.equal(client.calls.length, 0);
});

test("transport isolates project home and host secrets, initializes, bounds errors and shuts down", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "penguin-codex-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "secret";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  let options;
  let argv;
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("exit", 0);
  child.stdin.on("data", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id)
      child.stdout.write(
        JSON.stringify(
          msg.method === "initialize"
            ? { id: msg.id, result: {} }
            : { id: msg.id, error: { code: 401, message: "token-secret" } },
        ) + "\n",
      );
  });
  const client = new CodexClient({
    projectDir: root,
    cwd: root,
    spawnProcess: (_file, args, opts) => {
      argv = args;
      options = opts;
      return child;
    },
  });
  t.after(() => client.close());
  await client.start();
  assert.equal(options.env.CODEX_HOME, path.join(root, "coding-agents", "codex"));
  assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.ok(argv.includes('forced_login_method="chatgpt"'));
  await assert.rejects(
    client.request("account/read"),
    (error) => error.message.includes("401") && !error.message.includes("token-secret"),
  );
  client.close();
  await assert.rejects(client.request("account/read"), /closed/);
});
