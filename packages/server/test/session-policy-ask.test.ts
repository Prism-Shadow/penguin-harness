/**
 * A call a command-policy `ask` rule matched, as the server takes it: core's policy wrapper
 * hands the call to the Session's approve callback with a policy reason, and the callback
 * (runtime/approvals.ts) puts it to a person whatever the approval mode.
 *
 * - Given an allow-all conversation on a real core Session, the model's `gh pr merge 7` waits
 *   for a person: the `approval_request` names the rule as its reason, a reconnecting page is
 *   told the same, and the person's no is the call's decision.
 * - Given a deny-all Session, such a call is denied and nobody is asked.
 * - Given an organization's Session (nobody watching), it is denied at once and nothing is
 *   pushed.
 * - The children's fallback approval sink is the same callback, so a child's call that
 *   arrives there with a policy reason reaches a person too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type {
  AmspRecord,
  ApprovalDecision,
  ApprovalReason,
  ApproveFn,
} from "@prismshadow/penguin-core";
import type {
  ProjectCreateResponse,
  ServerEvent,
  SessionCreateResponse,
} from "../src/api/types.js";
import type { RunOpts, RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM } from "./live-session.js";
import type { MockLLM } from "./live-session.js";

const PROJECT = "owner-default_project";
const RULE = "gh-pr-merge-close";
/** What core's policy wrapper tells the callback about a call the rule above matched. */
const REASON: ApprovalReason = { kind: "policy", rule: RULE };

const mergeCall = (id: string) =>
  toolCall({
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "gh pr merge 7 --squash" }),
    toolCallId: id,
  });

/** A runtime whose Task makes one call an `ask` rule matched, and records the answer it got. */
function askingSession(sessionId: string, answers: ApprovalDecision[]): RuntimeSession {
  return fakeSession(sessionId, {
    async *run(_input: AmspRecord[], opts: RunOpts) {
      const tc = mergeCall("tc-ask");
      yield tc;
      const decision = await opts.approve(tc, { reason: REASON });
      answers.push(decision);
      yield approvalDecision(decision, "tc-ask");
      yield assistantText("done");
    },
  });
}

/** The `approval_request` events a Session's channel carried. */
function requests(t: TestApp, sessionId: string) {
  const seen: Extract<ServerEvent, { type: "approval_request" }>[] = [];
  t.deps.channels.get(sessionId).subscribe((evt) => {
    if (evt.event !== "server_event") return;
    const ev = JSON.parse(evt.data) as ServerEvent;
    if (ev.type === "approval_request") seen.push(ev);
  });
  return seen;
}

describe("a command-policy ask hit in a real conversation", { timeout: 30_000 }, () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let mock: MockLLM;
  let projectId: string;

  beforeAll(async () => {
    // The model asks to merge once, then answers in text.
    mock = await startMockLLM((n) =>
      n === 1
        ? {
            toolUse: {
              id: "toolu_merge",
              name: "exec_command",
              input: { cmd: "gh pr merge 7 --squash" },
            },
          }
        : "Not merged.",
    );
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    api = apiClient(t.app, (await provisionUser(t.app, "merge_user")).cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "merge_user-ask", name: "ask project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    const models = await api.put(`/api/projects/${projectId}/models`, {
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

  it("waits for a person under allow-all, naming the rule, and the person's no is the decision", async () => {
    const res = await api.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      approvalMode: "allow-all",
    });
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as SessionCreateResponse;
    const sessionId = session.sessionId;
    const records: AmspRecord[] = [];
    const seen = requests(t, sessionId);
    t.deps.channels.get(sessionId).subscribe((e) => {
      if (e.event === undefined) records.push(JSON.parse(e.data) as AmspRecord);
    });

    const task = await api.post(`/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text: "merge PR 7" }],
    });
    expect(task.status).toBe(202);
    await waitFor(() => seen.length === 1, 20_000);
    expect(seen[0]!.reason).toEqual(REASON);
    expect(seen[0]!.toolCall.payload.tool_call_id).toBe("toolu_merge");
    // A reconnecting page is told the same reason (the subscribe replay reads this list).
    expect(t.deps.manager.pendingApprovals(sessionId)[0]?.reason).toEqual(REASON);

    const decided = await api.post(`/api/sessions/${sessionId}/approvals/toolu_merge`, {
      decision: "deny",
    });
    expect(decided.status).toBe(204);
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle", 20_000);
    const decision = records.find(
      (m) => (m.payload as { type?: string }).type === "approval_decision",
    );
    expect((decision?.payload as { decision?: string } | undefined)?.decision).toBe("deny");
  });
});

describe("a command-policy ask hit on the server", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
  });

  it("waits for a person under allow-all, and the person's answer decides", async () => {
    const answers: ApprovalDecision[] = [];
    const seen = requests(t, SID);
    adoptSession(t.deps, askingSession(SID, answers), {
      projectId: PROJECT,
      approvalMode: "allow-all",
    });
    await t.deps.manager.startTask(SID, [userText("ship it")]);
    await waitFor(() => seen.length === 1);
    expect(seen[0]!.reason).toEqual(REASON);

    const res = await api.post(`/api/sessions/${SID}/approvals/tc-ask`, { decision: "allow" });
    expect(res.status).toBe(204);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(answers).toEqual(["allow"]);
  });

  it("is denied under deny-all, and nobody is asked", async () => {
    const answers: ApprovalDecision[] = [];
    const seen = requests(t, SID);
    adoptSession(t.deps, askingSession(SID, answers), {
      projectId: PROJECT,
      approvalMode: "deny-all",
    });
    await t.deps.manager.startTask(SID, [userText("ship it")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(answers).toEqual(["deny"]);
    expect(seen).toEqual([]);
  });

  it("is denied at once in an organization's Session, which nobody is watching", async () => {
    const answers: ApprovalDecision[] = [];
    const seen = requests(t, SID);
    adoptSession(t.deps, askingSession(SID, answers), {
      projectId: PROJECT,
      approvalMode: "allow-all",
      client: "org",
    });
    await t.deps.manager.startTask(SID, [userText("ship it")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(answers).toEqual(["deny"]);
    expect(seen).toEqual([]);
  });

  it("reaches a person through the children's fallback sink too", async () => {
    let fallback: ApproveFn | undefined;
    const seen = requests(t, SID);
    adoptSession(
      t.deps,
      fakeSession(SID, {
        setSubagentApprovalFallback: (approve) => {
          fallback = approve;
        },
      }),
      { projectId: PROJECT, approvalMode: "allow-all" },
    );
    expect(fallback).toBeDefined();

    const child = { ...mergeCall("tc-child"), origin: ["child-session"] };
    const decision = fallback!(child, { reason: REASON });
    await waitFor(() => seen.length === 1);
    expect(seen[0]!.origin).toEqual(["child-session"]);
    expect(seen[0]!.reason).toEqual(REASON);

    expect(t.deps.manager.decideApproval(SID, "tc-child", "allow")).toBe(true);
    expect(await decision).toBe("allow");
  });
});
