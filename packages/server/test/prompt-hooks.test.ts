/**
 * The composer's switches: POST /api/sessions/:id/tasks with `promptHooks`.
 *
 * - Each named hook package answers on the user's own words, and its context follows the user's
 *   message, stamped `sender: "harness"`, in the order named.
 * - A message queued behind a running Task waits with its contexts, while its queue line and its
 *   recall stay the user's own; a steered message takes none.
 * - A package the Agent does not have is a 409, and so is a hook that fails (with its reason):
 *   nothing starts or queues. A goal refuses the field.
 * - End to end, the shipped `plan` plugin's switch puts its prompt behind each message it is on
 *   for, and a message sent with it off goes out alone.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approvalDecision,
  assistantText,
  createAgent,
  installPlugin,
  libraryPlugin,
  saveProjectConfig,
  toolCall,
  userText,
} from "@prismshadow/penguin-core";
import type { ApproveFn, AmspRecord } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { SessionsRepo } from "@prismshadow/penguin-library-session/repos/sessions";
import { ChannelHub } from "../src/runtime/channel.js";
import { SessionManager, createCoreSessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, makeTempRoot, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM } from "./live-session.js";

const PROJECT = "switcher-default_project";

/** An input as its texts, each harness-injected one prefixed with its sender. */
const texts = (input: AmspRecord[]): string[] =>
  input.map((m) => {
    const p = m.payload as { text?: string; sender?: string };
    return p.sender === undefined ? (p.text ?? "") : `${p.sender}: ${p.text ?? ""}`;
  });

describe("the composer's switches on a Task", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;
  /** Each run's input texts, in start order. */
  let runs: string[][];
  /** Every hook package the Session was asked to run, with the prompt it was given. */
  let asked: Array<[string, string]>;
  let steered: AmspRecord[][];

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "switcher")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // A Session with two working hook packages (`plan`, `style`), one that fails, and none other;
  // every run parks on one approval, so it stays busy until the test decides.
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    asked = [];
    steered = [];
    const session = fakeSession(SID, {
      runUserPromptHook: async (name: string, prompt: string) => {
        asked.push([name, prompt]);
        if (name === "failing") throw new Error("the script exited with code 1");
        return name === "plan" || name === "style" ? { context: `${name} on: ${prompt}` } : null;
      },
      steer: (input: AmspRecord[]) => {
        steered.push(input);
        return true;
      },
      async *run(input: AmspRecord[], opts: { approve: ApproveFn; signal: AbortSignal }) {
        runs.push(texts(input));
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-sw" });
        yield tc;
        yield approvalDecision(await opts.approve(tc), "tc-sw");
        if (!opts.signal.aborted) yield assistantText("done");
      },
    });
    adoptSession(t.deps, session, { projectId: PROJECT, approvalMode: "always-ask" });
  });

  const post = (text: string, extra: Record<string, unknown> = {}) =>
    api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text }], ...extra });

  /** Lets the run in flight finish; the next queued message, if any, starts after it. */
  async function allow(): Promise<void> {
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-sw", "allow");
  }

  it("sends each switch's context behind the user's message, in the order named", async () => {
    const res = await post("Design the preview.", { promptHooks: ["style", "plan"] });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    expect(runs[0]).toEqual([
      "Design the preview.",
      "harness: style on: Design the preview.",
      "harness: plan on: Design the preview.",
    ]);
    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    // Turned off, the next message goes out alone.
    await post("Now the tests.");
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["Now the tests."]);
    await allow();
  });

  it("keeps a queued message's contexts with it, while its queue line stays the user's own", async () => {
    await post("task 1");
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    await post("next", { queueIfBusy: true, promptHooks: ["plan"] });
    expect(t.deps.manager.pendingFollowUpsOf(SID)).toMatchObject([{ text: "next" }]);

    await allow();
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["next", "harness: plan on: next"]);
    await allow();
  });

  it("gives a steered message no context", async () => {
    await post("task 1");
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const res = await post("also this", { steerIfBusy: true, promptHooks: ["plan"] });
    expect(await res.json()).toMatchObject({ steered: true });
    expect(steered.map(texts)).toEqual([["also this"]]);
    expect(asked).toEqual([]);
    await allow();
  });

  it("refuses a switch the Agent does not have, and starts nothing", async () => {
    const res = await post("Design the preview.", { promptHooks: ["plan", "missing"] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "prompt_hook_not_installed",
    );
    expect(runs).toEqual([]);
    expect(t.deps.manager.statusOf(SID)).toBe("idle");
  });

  it("refuses a switch whose hook fails, naming the reason", async () => {
    const res = await post("Design the preview.", { promptHooks: ["failing"] });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("prompt_hook_failed");
    expect(error.message).toContain("the script exited with code 1");
    expect(runs).toEqual([]);
  });

  it("cannot be combined with goal", async () => {
    const res = await post("Ship it.", { goal: { budget: -1 }, promptHooks: ["plan"] });
    expect(res.status).toBe(400);
    expect(asked).toEqual([]);
    expect(runs).toEqual([]);
  });
});

/** The text blocks of a request's last message (Anthropic Messages: one user turn, several blocks). */
function lastTurnTexts(request: { messages?: unknown[] }): string[] {
  const last = request.messages?.at(-1) as { content?: unknown } | undefined;
  if (typeof last?.content === "string") return [last.content];
  return ((last?.content as Array<{ type?: string; text?: string }> | undefined) ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "");
}

it(
  "the plan plugin's switch puts its prompt behind each message it is on for",
  { timeout: 45_000 },
  async () => {
    const root = await makeTempRoot();
    const mock = await startMockLLM(() => "What should the preview do offline?");
    const db = openDatabase(":memory:");
    const sessions = wire(SessionsRepo, { db });
    const channels = new ChannelHub();
    const manager = new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      loader: createCoreSessionLoader(root),
      recorder: { record: async () => {} },
      log: () => {},
    });
    try {
      const p = "test_project";
      const a = "plan_agent";
      const model = { provider: "custom", model_id: MOCK_MODEL_ID };
      await saveProjectConfig(root, p, {
        default_model: model,
        models: [{ ...model, context_window: 200000, api_key: "fixture", base_url: mock.url }],
      });
      const agent = await createAgent({ root, projectId: p, agentId: a });
      // Installed before the Session opens: a context reads its hook packages when it opens.
      await installPlugin(root, p, a, libraryPlugin("plan")!);
      const workspace = path.join(root, "workspace");
      await fs.mkdir(workspace);
      const core = await agent.createSession({ workspaceDir: workspace });
      const id = core.sessionId;
      const now = new Date().toISOString();
      const row = {
        sessionId: id,
        projectId: p,
        agentId: a,
        modelId: MOCK_MODEL_ID,
        provider: "custom",
        workspace,
        approvalMode: "allow-all" as const,
        title: null,
        createdAt: now,
        lastActiveAt: now,
      };
      sessions.insert(row);
      manager.adopt(row, core);
      const submit = async (prompt: string, promptHooks?: string[]) => {
        const before = mock.requests.length;
        await manager.startTask(id, [userText(prompt)], promptHooks ? { promptHooks } : {});
        await waitFor(() => manager.statusOf(id) === "idle", 20000);
        return mock.requests[before]!;
      };

      const planned = lastTurnTexts(await submit("Help me design the preview.", ["plan"]));
      // The user's words, then the plugin's prompt behind them.
      expect(planned.slice(0, -1).join("\n")).toContain("Help me design the preview.");
      expect(planned.at(-1)).not.toContain("Help me design the preview.");
      expect(planned.at(-1)!.trim()).not.toBe("");

      const plain = lastTurnTexts(await submit("Yes, it should work offline."));
      expect(plain.at(-1)).toContain("Yes, it should work offline.");
    } finally {
      await manager.shutdown();
      channels.dispose();
      db.close();
      await mock.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
