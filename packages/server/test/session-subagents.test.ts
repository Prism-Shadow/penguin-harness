/**
 * The panel's subagent endpoints and the child-liveness broadcast.
 *
 * - A message to a child is a user input whatever its state: steering while it runs, a
 *   follow-up run while it is idle, a revival when it was released (the resume carries the
 *   child's owning Agent from its session row); nothing to revive is a 404 subagent_gone, a
 *   child that cannot take it a 409 subagent_busy, no text a 400.
 * - An abort ends the running child's round (202); an idle or unknown child is a 204.
 * - task_state is republished with the live subagents listing on every child state ping, and
 *   the SSE subscribe snapshot carries the same listing.
 * - Foreign and unknown Sessions are 404s, as on every Session route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toolCall, withOrigin } from "@prismshadow/penguin-core";
import type {
  BackgroundSubagentInfo,
  OmniMessage,
  SubagentMessageOptions,
  SubagentMessageOutcome,
} from "@prismshadow/penguin-core";
import { ApprovalRegistry } from "../src/runtime/approvals.js";
import type { ServerEvent, SubagentMessageResponse } from "../src/api/types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "subuser-default_project";
const CHILD_RUNNING = "session-2026-08-24-10-01-00-child001";
const CHILD_IDLE = "session-2026-08-24-10-01-00-child002";

interface SentMessage {
  childSessionId: string;
  text: string;
  opts?: SubagentMessageOptions;
}

/** Fake Session over a mutable child list; message/abort mutate it like core's manager would. */
function subagentsFakeSession(
  sessionId: string,
  children: BackgroundSubagentInfo[],
  sent: SentMessage[],
  aborts: string[],
  stateListeners: (() => void)[],
): RuntimeSession {
  return fakeSession(sessionId, {
    listBackgroundSubagents: () => children.map((c) => ({ ...c })),
    sendToBackgroundSubagent: async (
      childSessionId: string,
      messages: OmniMessage[],
      opts?: SubagentMessageOptions,
    ): Promise<SubagentMessageOutcome> => {
      // The route turns the request's text into OmniMessage; the fake reads it back out.
      const text = messages.map((m) => (m.payload as { text?: string }).text ?? "").join("");
      sent.push({ childSessionId, text, ...(opts !== undefined ? { opts } : {}) });
      const child = children.find((c) => c.sessionId === childSessionId);
      if (!child) {
        // The released child revives only when the host resolved an owning agent for it —
        // exactly core's resume-fallback condition.
        if (opts?.resume) {
          children.push({ sessionId: childSessionId, subagentId: null, running: true });
          return "resumed";
        }
        return "gone";
      }
      if (child.running) return "steered";
      child.running = true;
      return "started";
    },
    abortBackgroundSubagentRun: (childSessionId: string): boolean => {
      const child = children.find((c) => c.sessionId === childSessionId);
      if (!child || !child.running) return false;
      aborts.push(childSessionId);
      child.running = false;
      return true;
    },
    onSubagentState: (listener: () => void) => {
      stateListeners.push(listener);
    },
    setSubagentApprovalFallback: () => {},
  });
}

describe("session subagent routes and liveness", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let SID: string;
  let CHILD_RELEASED: string;
  let children: BackgroundSubagentInfo[];
  let sent: SentMessage[];
  let aborts: string[];
  let stateListeners: (() => void)[];

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "subuser")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "outsider_s")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    CHILD_RELEASED = uniqueSessionId();
    children = [
      { sessionId: CHILD_RUNNING, subagentId: "subagent-child001", running: true },
      { sessionId: CHILD_IDLE, subagentId: null, running: false },
    ];
    sent = [];
    aborts = [];
    stateListeners = [];
    adoptSession(t.deps, subagentsFakeSession(SID, children, sent, aborts, stateListeners), {
      projectId: PROJECT,
      approvalMode: "always-ask",
    });
    // A released child with its own session row: the message route resolves its owning agent
    // from this row and asks core to revive it.
    t.deps.sessionsRepo.insert(sessionRow(CHILD_RELEASED, { projectId: PROJECT }));
  });

  it("message: steering while the child runs, a follow-up run while it is idle", async () => {
    const mid = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/message`, {
      text: "focus on the tests",
    });
    expect(mid.status).toBe(200);
    expect((await mid.json()) as SubagentMessageResponse).toEqual({ outcome: "steered" });

    const idle = await api.post(`/api/sessions/${SID}/subagents/${CHILD_IDLE}/message`, {
      text: "one more round",
    });
    expect(idle.status).toBe(200);
    expect((await idle.json()) as SubagentMessageResponse).toEqual({ outcome: "started" });

    expect(sent).toHaveLength(2);
    expect(sent[0]!.childSessionId).toBe(CHILD_RUNNING);
    expect(sent[0]!.text).toBe("focus on the tests");
    expect(sent[1]!.text).toBe("one more round");
  });

  it("message: a released child with a session row revives (outcome resumed, owning agent resolved)", async () => {
    const res = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RELEASED}/message`, {
      text: "wake up",
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as SubagentMessageResponse).toEqual({ outcome: "resumed" });
    // The route resolved the child's owning agent from its own session row.
    expect(sent[0]!.opts?.resume).toEqual({ agentId: "default_agent" });
  });

  it("message: 404 subagent_gone when no session row backs the child; 400 without text", async () => {
    const ghost = await api.post(`/api/sessions/${SID}/subagents/session-ghost/message`, {
      text: "hello",
    });
    expect(ghost.status).toBe(404);
    expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe("subagent_gone");
    // No row for the ghost child, so no resume option reached core.
    expect(sent[0]!.opts?.resume).toBeUndefined();

    const empty = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/message`, {
      text: "   ",
    });
    expect(empty.status).toBe(400);
    expect(sent).toHaveLength(1);
  });

  it("abort: 202 ends the running child's round; 204 when idle or unknown", async () => {
    const res = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/abort`, {});
    expect(res.status).toBe(202);
    expect(aborts).toEqual([CHILD_RUNNING]);

    const again = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/abort`, {});
    expect(again.status).toBe(204);
    const ghost = await api.post(`/api/sessions/${SID}/subagents/session-ghost/abort`, {});
    expect(ghost.status).toBe(204);
    expect(aborts).toEqual([CHILD_RUNNING]);
  });

  it("republishes task_state with the live subagents listing on every child state ping", async () => {
    const events: ServerEvent[] = [];
    t.deps.channels.get(SID).subscribe((evt) => {
      if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
    });
    expect(stateListeners).toHaveLength(1);

    children[0]!.running = false;
    stateListeners[0]!();
    const state = events.find((e) => e.type === "task_state");
    expect(state).toBeDefined();
    expect(state && state.type === "task_state" ? state.subagents : undefined).toEqual([
      { sessionId: CHILD_RUNNING, subagentId: "subagent-child001", running: false },
      { sessionId: CHILD_IDLE, subagentId: null, running: false },
    ]);
  });

  it("the SSE subscribe snapshot carries the live subagents listing", async () => {
    const res = await api.get(`/api/sessions/${SID}/stream`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(value);
    expect(frame).toContain('"type":"task_state"');
    expect(frame).toContain(`"subagents":[{"sessionId":"${CHILD_RUNNING}"`);
  });

  it("denyMain resolves only origin-less approvals; a child's stays pending for the user", async () => {
    const registry = new ApprovalRegistry();
    const main = registry.wait(
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "m1" }),
    );
    const child = registry.wait(
      withOrigin(
        toolCall({ name: "exec_command", arguments: "{}", toolCallId: "c1" }),
        "session-child",
      ),
    );
    // The task-boundary convergence (run end / user stop): the main approval dies with its
    // run, the subagent child's question survives — its session is still blocked on it.
    registry.denyMain();
    expect(await main).toBe("deny");
    expect(registry.size).toBe(1);
    expect(registry.decide("c1", "allow")).toBe(true);
    expect(await child).toBe("allow");
  });

  it("foreign and unknown sessions → 404 (same auth semantics as the other session routes)", async () => {
    expect(
      (
        await outsider.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/message`, {
          text: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (await outsider.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/abort`, {})).status,
    ).toBe(404);
    expect(
      (
        await api.post(`/api/sessions/session-ghost/subagents/${CHILD_RUNNING}/message`, {
          text: "x",
        })
      ).status,
    ).toBe(404);
    expect(sent).toEqual([]);
    expect(aborts).toEqual([]);
  });
});
