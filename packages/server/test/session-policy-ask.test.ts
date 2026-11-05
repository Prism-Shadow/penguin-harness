/**
 * A call a command-policy `ask` rule matched, as the server takes it: core hands the hit to
 * `RunOptions.askHuman` (runtime/approvals.ts) instead of to the approval mode, so these
 * scenarios drive that route from a fake runtime the way core's policy wrapper does.
 *
 * - Given an allow-all Session, an `ask` hit waits for a person: the `approval_request` names
 *   the rule as its reason, and the person's answer is the call's decision.
 * - Given a deny-all Session, an `ask` hit is denied and nobody is asked.
 * - Given an organization's Session (nobody watching), an `ask` hit is denied at once and
 *   nothing is pushed.
 * - The children's fallback approval sink is handed the same route, so a child's `ask` hit
 *   that lands there reaches a person too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type { AmspRecord, ApprovalDecision, AskHumanFn } from "@prismshadow/penguin-core";
import type { ServerEvent } from "../src/api/types.js";
import type { RunOpts, RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-default_project";
const RULE = "gh-pr-merge-close";

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
      const decision = await opts.askHuman(tc, { rule: RULE });
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

let t: TestApp;
let api: ReturnType<typeof apiClient>;

beforeAll(async () => {
  t = await createTestApp();
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

describe("a command-policy ask hit on the server", () => {
  let SID: string;
  beforeEach(() => {
    SID = uniqueSessionId();
  });

  it("waits for a person under allow-all, naming the rule, and the person's answer decides", async () => {
    const answers: ApprovalDecision[] = [];
    const seen = requests(t, SID);
    adoptSession(t.deps, askingSession(SID, answers), {
      projectId: PROJECT,
      approvalMode: "allow-all",
    });
    await t.deps.manager.startTask(SID, [userText("ship it")]);
    await waitFor(() => seen.length === 1);
    expect(seen[0]!.reason).toEqual({ kind: "policy", rule: RULE });
    expect(seen[0]!.toolCall.payload.tool_call_id).toBe("tc-ask");
    // A reconnecting page is told the same reason (the subscribe replay reads this list).
    expect(t.deps.manager.pendingApprovals(SID)[0]?.reason).toEqual({ kind: "policy", rule: RULE });

    const res = await api.post(`/api/sessions/${SID}/approvals/tc-ask`, { decision: "deny" });
    expect(res.status).toBe(204);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(answers).toEqual(["deny"]);
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
    let fallbackAsk: AskHumanFn | undefined;
    const seen = requests(t, SID);
    adoptSession(
      t.deps,
      fakeSession(SID, {
        setSubagentApprovalFallback: (_approve, askHuman) => {
          fallbackAsk = askHuman;
        },
      }),
      { projectId: PROJECT, approvalMode: "allow-all" },
    );
    expect(fallbackAsk).toBeDefined();

    const child = { ...mergeCall("tc-child"), origin: ["child-session"] };
    const decision = fallbackAsk!(child, { rule: RULE });
    await waitFor(() => seen.length === 1);
    expect(seen[0]!.origin).toEqual(["child-session"]);
    expect(seen[0]!.reason).toEqual({ kind: "policy", rule: RULE });

    expect(t.deps.manager.decideApproval(SID, "tc-child", "allow")).toBe(true);
    expect(await decision).toBe("allow");
  });
});
