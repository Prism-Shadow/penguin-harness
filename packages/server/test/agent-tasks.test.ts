/**
 * AgentTasks (PRFC-0036): an Agent task a server module starts as a person, over the real
 * platform tree, a real core Session and a loopback model. The module reaches it the way a plugin
 * does: by requiring the host's interface.
 *
 * - Given a person who can reach the Project, a task opens their own conversation: a `user`
 *   Session in the Agent's list, with the approval mode given, each in a fresh Workspace of its
 *   own; its first message is the `[use_skills]` block followed by the person's text, sent as the
 *   person's; the run's driver is the person.
 * - A title given is the conversation's title.
 * - A stranger to the Project is refused 404 `project_not_found`, a missing Agent 404
 *   `agent_not_found`, the system Agent 409 `system_agent_no_sessions` and a mode no chat offers
 *   400 — and none of them leaves a Session behind.
 * - `status` follows a task: running while the model answers, completed once it has; running
 *   with a pending approval while a call waits on the person, failed once the task is stopped.
 *   A stranger, or a Session that does not exist, reads null.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSkillsMessage } from "@prismshadow/amsp/markers";
import { workspacesDir } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { SessionDrivers } from "@prismshadow/penguin-library-session";
import type { SessionsResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import type { AgentTasks, AgentTaskStart } from "../src/services/agent-tasks.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM, userTexts } from "./live-session.js";
import type { MockLLM, MockReply } from "./live-session.js";

/** A plugin module that requires AgentTasks and hands it to the test. */
function requiringTasks(seen: { tasks?: AgentTasks }): ModuleDef {
  return {
    manifest: parseManifest({
      name: "AcmeTasks",
      requires: { tasks: { iface: "@prismshadow/penguin-server#AgentTasks" } },
      provides: {},
      contributes: {},
      children: [],
    }),
    create({ use }) {
      seen.tasks = use.tasks as AgentTasks;
      return { api: {} };
    },
  };
}

/** Polls an async condition, as waitFor polls a sync one. */
async function eventually(cond: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("eventually timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("AgentTasks", { timeout: 30_000 }, () => {
  let t: TestApp;
  let mock: MockLLM;
  let userId: string;
  let cookie: string;
  let strangerId: string;
  let projectId: string;
  const seen: { tasks?: AgentTasks } = {};
  /** The model's answers, in order; each task's first request takes the next. */
  const script: MockReply[] = [];
  /** Held over the next request's answer, when set. */
  let gate: Promise<void> | undefined;

  beforeAll(async () => {
    mock = await startMockLLM(
      () => script.shift() ?? "Done.",
      () => {
        const held = gate;
        gate = undefined;
        return held;
      },
    );
    const host = new PluginHost();
    host.use({ specifier: "@acme/tasks", modules: [requiringTasks(seen)], replaces: [] });
    t = await createTestApp({ plugins: host, titles: { maybeGenerate: () => {} } });
    const person = await provisionUser(t.app, "ada");
    userId = person.user.userId;
    cookie = person.cookie;
    strangerId = (await provisionUser(t.app, "stranger")).user.userId;
    projectId = `${userId}-default_project`;
    const models = await apiClient(t.app, person.cookie).put(`/api/projects/${projectId}/models`, {
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
    });
    expect(models.status).toBe(200);
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  const tasks = () => seen.tasks!;
  const task = (over: Partial<AgentTaskStart> = {}): AgentTaskStart => ({
    userId,
    projectId,
    agentId: "default_agent",
    prompt: "Evaluate the report.",
    approvalMode: "allow-all",
    ...over,
  });
  const stateOf = async (sessionId: string) => (await tasks().status(userId, sessionId))?.status;

  it("opens the person's own conversation, Skills first, driven by them, each in a fresh Workspace", async () => {
    script.push("Evaluated.", "Evaluated again.");
    const first = await tasks().start(
      task({ skills: ["benchmark-design"], approvalMode: "read-only" }),
    );
    const second = await tasks().start(task());
    await eventually(async () => (await stateOf(first.sessionId)) === "completed");
    await eventually(async () => (await stateOf(second.sessionId)) === "completed");

    const listed = (await (
      await apiClient(t.app, cookie).get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as SessionsResponse;
    const row = listed.sessions.find((s) => s.sessionId === first.sessionId);
    expect(row).toMatchObject({ source: "user", approvalMode: "read-only" });
    const other = listed.sessions.find((s) => s.sessionId === second.sessionId)!;
    const own = workspacesDir(t.root, projectId, "default_agent");
    for (const workspace of [row!.workspace, other.workspace]) {
      expect(path.relative(own, workspace).startsWith("..")).toBe(false);
    }
    expect(row!.workspace).not.toBe(other.workspace);

    const messages = await t.deps.traceService.readMessages(
      projectId,
      "default_agent",
      first.sessionId,
    );
    expect(userTexts(messages as AmspRecord[])[0]).toEqual({
      sender: "user",
      text: buildSkillsMessage(["benchmark-design"], "Evaluate the report."),
    });
    const drivers = t.boot.tree.api<SessionDrivers>("SessionRuntimeModule", "SessionDrivers");
    expect(drivers.driverOf(first.sessionId)).toBe(userId);
  });

  it("titles the conversation as asked", async () => {
    const { sessionId } = await tasks().start(task({ title: "Report writing check" }));
    await eventually(async () => (await stateOf(sessionId)) === "completed");
    expect(t.deps.sessionsRepo.findById(sessionId)?.title).toBe("Report writing check");
    expect((await tasks().status(userId, sessionId))?.title).toBe("Report writing check");
  });

  it("refuses a stranger, a missing Agent, the system Agent and a bad mode, leaving no Session", async () => {
    const before = t.deps.sessionsRepo.listByProject(projectId).length;
    await expect(tasks().start(task({ userId: strangerId }))).rejects.toMatchObject({
      status: 404,
      code: "project_not_found",
    });
    await expect(tasks().start(task({ agentId: "ghost" }))).rejects.toMatchObject({
      status: 404,
      code: "agent_not_found",
    });
    await expect(tasks().start(task({ agentId: "system_agent" }))).rejects.toMatchObject({
      status: 409,
      code: "system_agent_no_sessions",
    });
    await expect(
      tasks().start(task({ approvalMode: "sometimes" as AgentTaskStart["approvalMode"] })),
    ).rejects.toMatchObject({ status: 400 });
    expect(t.deps.sessionsRepo.listByProject(projectId)).toHaveLength(before);
  });

  it("reads running while the model answers and completed once it has", async () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    script.push("Slow answer.");
    const asked = mock.requests.length;
    const { sessionId } = await tasks().start(task());
    await waitFor(() => mock.requests.length > asked, 20_000);
    expect(await tasks().status(userId, sessionId)).toMatchObject({
      status: "running",
      pendingApprovals: 0,
    });
    release();
    await eventually(async () => (await stateOf(sessionId)) === "completed");
  });

  it("counts a pending approval, reads failed once stopped, and null for a stranger or no Session", async () => {
    script.push({ toolUse: { id: "toolu_ls", name: "exec_command", input: { cmd: "ls" } } });
    const { sessionId } = await tasks().start(task({ approvalMode: "always-ask" }));
    await eventually(async () => (await tasks().status(userId, sessionId))?.pendingApprovals === 1);
    expect(await stateOf(sessionId)).toBe("running");
    expect(await tasks().status(strangerId, sessionId)).toBeNull();
    expect(await tasks().status(userId, "no-such-session")).toBeNull();

    t.deps.manager.abortTask(sessionId);
    await eventually(async () => (await stateOf(sessionId)) === "failed");
  });
});
