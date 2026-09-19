import { randomUUID } from "node:crypto";
import { CodexClient } from "./client.mjs";

const str = { type: "string", minLength: 1 };
const schema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const tool = (name, description, inputSchema, readOnlyHint = false) => ({
  name,
  description,
  inputSchema,
  annotations: { readOnlyHint, openWorldHint: true },
});
export const TOOLS = [
  tool(
    "codex_status",
    "Read the project Codex account, pending login, and subscription usage limits. Never returns credentials.",
    schema(),
    true,
  ),
  tool(
    "codex_connect",
    "Start ChatGPT device sign-in for this Penguin project. Show the returned URL and code to the user, then poll codex_status. Requires official Codex CLI.",
    schema(),
  ),
  tool(
    "codex_disconnect",
    "Cancel pending login and sign out this project's Codex account. Refuses while delegated tasks are running.",
    schema(),
  ),
  tool(
    "codex_models",
    "List models available to the connected Codex account. These are delegated-agent models, not Penguin model providers.",
    schema(),
    true,
  ),
  tool(
    "codex_run",
    "Delegate a bounded coding task to Codex in this session's workspace. Codex runs its own agent loop. Returns a task ID immediately; poll for progress and approvals. Review edits before accepting them. Resume a prior thread with thread_id.",
    schema(
      {
        prompt: str,
        model: str,
        thread_id: str,
        sandbox: { type: "string", enum: ["read-only", "workspace-write"], default: "read-only" },
      },
      ["prompt"],
    ),
  ),
  tool(
    "codex_poll",
    "Read delegated task progress since a cursor, including pending requests requiring a human decision. Poll until completed, failed, or interrupted. The cursor permits retry without losing output.",
    schema({ task_id: str, cursor: { type: "integer", minimum: 0 } }, ["task_id"]),
    true,
  ),
  tool(
    "codex_cancel",
    "Interrupt a running delegated Codex task. Wait for its interrupted status before editing the same files.",
    schema({ task_id: str }, ["task_id"]),
  ),
  tool(
    "codex_respond",
    "Relay a human's decision to a pending Codex request. Never infer an approval from task output. Accept applies to one command or file-change request only; answers is for a user-input request.",
    schema(
      {
        task_id: str,
        request_id: str,
        decision: { type: "string", enum: ["accept", "decline", "cancel"] },
        answers: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
        },
      },
      ["task_id", "request_id"],
    ),
  ),
];

export class CodexBridge {
  constructor(options) {
    this.client = options.client ?? new CodexClient(options);
    this.cwd = options.cwd;
    this.tasks = new Map();
    this.login = null;
    this.loginCompletion = null;
    this.client.listeners.add((message) => this.onMessage(message));
  }

  ready() {
    return (this.started ??= this.client.start());
  }

  event(task, event) {
    const entry = { cursor: ++task.cursor, ...event };
    // Bounded retained output per task. Cursor gaps are reported, not silently dropped.
    let text = JSON.stringify(entry);
    if (text.length > 24_000) {
      entry.data = { truncated: true, text: text.slice(0, 20_000) };
      text = JSON.stringify(entry);
    }
    task.events.push(entry);
    task.size += text.length;
    while (task.size > 100_000 && task.events.length > 1)
      task.size -= JSON.stringify(task.events.shift()).length;
  }

  finish(task, status) {
    task.status = status;
    clearTimeout(task.deadline);
    for (const request of task.requests.values()) clearTimeout(request.timer);
    task.requests.clear();
  }

  onMessage(msg) {
    const p = msg.params ?? {};
    if (msg.method === "bridge/closed") {
      for (const task of this.tasks.values())
        if (task.status === "running") {
          this.event(task, { type: "error", data: p });
          this.finish(task, "failed");
        }
      return;
    }
    if (msg.method === "account/login/completed") {
      this.loginCompletion = { loginId: p.loginId, status: p.success ? "connected" : "failed" };
      if (this.login?.loginId === p.loginId) this.login = this.loginCompletion;
      return;
    }
    const task = [...this.tasks.values()].find(
      (t) => t.threadId === p.threadId && t.status === "running",
    );
    if (msg.id !== undefined) {
      if (
        !task ||
        task.requests.size >= 32 ||
        ![
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/tool/requestUserInput",
        ].includes(msg.method)
      ) {
        this.client.send({
          id: msg.id,
          error: {
            code: -32601,
            message: "This request is not supported by the Penguin Codex bridge",
          },
        });
        if (task) this.event(task, { type: "unsupported_request", data: { method: msg.method } });
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        task.requests.delete(requestId);
        this.client.send({
          id: msg.id,
          error: { code: -32000, message: "Human response timed out" },
        });
        this.event(task, { type: "request_expired", data: { requestId } });
        void this.cancel(task).catch(() => {});
      }, 5 * 60_000);
      task.requests.set(requestId, { id: msg.id, method: msg.method, params: p, timer });
      this.event(task, { type: "request", data: { requestId, method: msg.method, params: p } });
      return;
    }
    if (!task) return;
    if (msg.method === "serverRequest/resolved") {
      for (const [id, request] of task.requests)
        if (request.id === p.requestId) {
          clearTimeout(request.timer);
          task.requests.delete(id);
        }
    } else if (msg.method === "turn/completed") {
      this.event(task, {
        type: msg.method,
        data: {
          status: p.turn?.status,
          error: p.turn?.error ? "Codex turn failed; inspect the delegated task in Codex." : null,
        },
      });
      this.finish(
        task,
        p.turn?.status === "completed"
          ? "completed"
          : p.turn?.status === "interrupted"
            ? "interrupted"
            : "failed",
      );
    } else if (
      [
        "item/agentMessage/delta",
        "item/started",
        "item/completed",
        "turn/started",
        "turn/diff/updated",
      ].includes(msg.method)
    ) {
      this.event(task, { type: msg.method, data: p });
    }
  }

  task(id) {
    const task = this.tasks.get(id);
    if (!task)
      throw new Error(
        "Unknown task ID in this MCP connection. Use the saved thread_id to resume after reconnecting.",
      );
    return task;
  }

  async cancel(task) {
    if (task.status !== "running") return { status: task.status };
    if (!task.turnId) throw new Error("Task is still starting; poll and retry cancellation.");
    await this.client.request("turn/interrupt", { threadId: task.threadId, turnId: task.turnId });
    return { status: "interrupt_requested" };
  }

  async call(name, args = {}) {
    validate(name, args);
    await this.ready();
    if (name === "codex_status") {
      const { account } = await this.client.request("account/read", { refreshToken: false });
      let limits = null;
      if (account?.type === "chatgpt") {
        try {
          limits = await this.client.request("account/rateLimits/read");
        } catch {
          /* Account state remains useful if limits are unavailable. */
        }
      }
      return {
        account: account ? { type: account.type, planType: account.planType ?? null } : null,
        login: this.login,
        limits,
      };
    }
    if (name === "codex_connect" || name === "codex_disconnect") {
      if ([...this.tasks.values()].some((t) => t.status === "running"))
        throw new Error("Finish or cancel running Codex tasks before changing accounts.");
      if (this.login?.status === "pending")
        await this.client.request("account/login/cancel", { loginId: this.login.loginId });
      this.login = null;
      if (name === "codex_disconnect") {
        await this.client.request("account/logout");
        return { status: "disconnected" };
      }
      this.loginCompletion = null;
      const result = await this.client.request("account/login/start", {
        type: "chatgptDeviceCode",
      });
      this.login =
        this.loginCompletion?.loginId === result.loginId
          ? this.loginCompletion
          : { loginId: result.loginId, status: "pending" };
      return {
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
        status: this.login.status,
      };
    }
    if (name === "codex_models") {
      const models = [];
      let cursor;
      for (let page = 0; page < 20; page++) {
        const result = await this.client.request("model/list", { ...(cursor ? { cursor } : {}) });
        models.push(...(result.data ?? []));
        cursor = result.nextCursor;
        if (!cursor) return { models };
      }
      throw new Error("Codex model catalog pagination exceeded its limit");
    }
    if (name === "codex_run") {
      const { account } = await this.client.request("account/read", { refreshToken: false });
      if (account?.type !== "chatgpt")
        throw new Error(
          "Connect a ChatGPT account with codex_connect first. API-key billing is not used by this bridge.",
        );
      if ([...this.tasks.values()].some((t) => t.status === "running"))
        throw new Error(
          "One Codex task may run per MCP connection; finish or cancel it before starting another.",
        );
      // Spellings verified against the CLI-generated v2 schema (Codex 0.146.0).
      const params = {
        cwd: this.cwd,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: args.sandbox ?? "read-only",
        ...(args.model ? { model: args.model } : {}),
      };
      const result = await this.client.request(args.thread_id ? "thread/resume" : "thread/start", {
        ...params,
        ...(args.thread_id ? { threadId: args.thread_id } : {}),
      });
      while (this.tasks.size >= 8) this.tasks.delete(this.tasks.keys().next().value);
      const id = randomUUID();
      const task = {
        id,
        threadId: result.thread.id,
        status: "running",
        turnId: null,
        cursor: 0,
        events: [],
        size: 0,
        requests: new Map(),
      };
      this.tasks.set(id, task);
      task.deadline = setTimeout(() => {
        this.event(task, { type: "timeout", data: "30-minute task limit reached" });
        void this.cancel(task).catch(() => this.client.close());
      }, 30 * 60_000);
      try {
        const turn = await this.client.request("turn/start", {
          threadId: task.threadId,
          input: [{ type: "text", text: args.prompt }],
        });
        task.turnId = turn.turn.id;
      } catch (err) {
        this.finish(task, "failed");
        throw err;
      }
      return { task_id: id, thread_id: task.threadId, status: task.status };
    }
    const task = this.task(args.task_id);
    if (name === "codex_poll") {
      const cursor = args.cursor ?? 0;
      return {
        task_id: task.id,
        thread_id: task.threadId,
        status: task.status,
        cursor: task.cursor,
        truncated: cursor < (task.events[0]?.cursor ?? 1) - 1,
        events: task.events.filter((e) => e.cursor > cursor),
        requests: [...task.requests].map(([requestId, r]) => ({
          request_id: requestId,
          method: r.method,
          params: r.params,
        })),
      };
    }
    if (name === "codex_cancel") return this.cancel(task);
    const request = task.requests.get(args.request_id);
    if (!request) throw new Error("Request no longer pending");
    let result;
    if (request.method === "item/tool/requestUserInput") {
      if (!args.answers || args.decision)
        throw new Error("User-input requests require answers keyed by question ID");
      const questions = request.params.questions ?? [];
      if (
        questions.some((q) => !args.answers[q.id]?.length) ||
        Object.keys(args.answers).some((id) => !questions.some((q) => q.id === id))
      )
        throw new Error("Provide an answer for each requested question ID, and no others");
      result = {
        answers: Object.fromEntries(
          Object.entries(args.answers).map(([key, answers]) => [key, { answers }]),
        ),
      };
    } else {
      if (!args.decision || args.answers) throw new Error("Approval requests require a decision");
      result = { decision: args.decision };
    }
    this.client.send({ id: request.id, result });
    clearTimeout(request.timer);
    task.requests.delete(args.request_id);
    return { status: "answered" };
  }

  async close() {
    await Promise.allSettled(
      [...this.tasks.values()].filter((t) => t.status === "running").map((t) => this.cancel(t)),
    );
    this.client.close();
  }
}

// Keep the shipped bridge dependency-free so the plugin installer can copy it intact.
// Validate the small public tool schemas before forwarding anything to Codex.
function validate(name, args) {
  const definition = TOOLS.find((t) => t.name === name);
  if (!definition) throw new Error("Unknown Codex tool");
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("Arguments must be an object");
  for (const required of definition.inputSchema.required)
    if (!(required in args)) throw new Error(`Missing ${required}`);
  for (const [key, value] of Object.entries(args)) {
    const prop = definition.inputSchema.properties[key];
    if (!prop) throw new Error(`Unknown argument: ${key}`);
    if (
      prop.type === "string" &&
      (typeof value !== "string" || !value.trim() || value.length > 100_000)
    )
      throw new Error(`Invalid ${key}`);
    if (prop.enum && !prop.enum.includes(value)) throw new Error(`Invalid ${key}`);
    if (prop.type === "integer" && (!Number.isSafeInteger(value) || value < 0))
      throw new Error(`Invalid ${key}`);
    if (
      prop.type === "object" &&
      (!value ||
        Array.isArray(value) ||
        typeof value !== "object" ||
        !Object.values(value).every(
          (v) => Array.isArray(v) && v.every((s) => typeof s === "string"),
        ))
    )
      throw new Error(`Invalid ${key}`);
  }
}
