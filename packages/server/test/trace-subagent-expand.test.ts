/**
 * Sub-session expansion in historical messages (conversation history).
 *
 * The parent Trace records only a single `subagent` pointer event at the spawn
 * point (holding just the child Session id); the content stays in the child
 * Session's own Trace. `TraceService.readMessages` uses the pointer to locate
 * the child Trace within the Project, recursively reads back the child messages,
 * and attaches the origin chain — otherwise, after a page refresh the frontend
 * would have no way to reattach the sub-session to its run_subagent tool card,
 * and the sub-session view would disappear entirely.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assistantText,
  sessionMeta,
  subagentEvent,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core";
import { TraceService } from "../src/services/trace-service.js";

const PROJECT = "proj";
const PARENT_AGENT = "default_agent";
const CHILD_AGENT = "worker";
const PARENT = "session-2026-07-09-10-00-00-aaaa0001";
const CHILD = "session-2026-07-09-10-00-01-bbbb0002";
const GRANDCHILD = "session-2026-07-09-10-00-02-cccc0003";

function meta(sessionId: string, agentId: string): OmniMessage {
  const payload: SessionMetaPayload = {
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "",
    tools: [],
    thinking_level: "medium",
    agent_state: `/root/${PROJECT}/${agentId}/agent_state`,
    workspace: "/tmp/w",
  };
  return sessionMeta(payload);
}

async function writeTrace(
  root: string,
  agentId: string,
  sessionId: string,
  messages: OmniMessage[],
): Promise<void> {
  const dir = path.join(root, PROJECT, "agents", agentId, "traces", "2026-07-09");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${sessionId}_001.jsonl`),
    messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
}

describe("TraceService.readMessages — sub-session expansion", () => {
  let root: string;
  let svc: TraceService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-trace-expand-"));
    svc = new TraceService(root);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("inserts child-session messages in place per the pointer and attaches the origin chain (the child Agent is located within the Project by Session id)", async () => {
    await writeTrace(root, PARENT_AGENT, PARENT, [
      meta(PARENT, PARENT_AGENT),
      userText("run a sub-agent"),
      toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "c1" }),
      subagentEvent(CHILD), // pointer: holds only the child Session id
      toolCallOutput({ output: "done", toolCallId: "c1" }),
    ]);
    await writeTrace(root, CHILD_AGENT, CHILD, [
      meta(CHILD, CHILD_AGENT),
      assistantText("sub-session answer"),
    ]);

    const msgs = await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    const texts = msgs.map((m) => (m.payload as { text?: string; type?: string }).text ?? m.type);
    expect(texts).toEqual([
      "session_meta",
      "run a sub-agent",
      "model_msg", // tool_call
      "session_meta", // the child session's own meta (replaces the pointer, matching the live-stream forwarding shape)
      "sub-session answer",
      "model_msg", // tool_call_output
    ]);

    // The pointer event is replaced by the child Trace content and no longer appears; all child messages carry an origin chain.
    expect(msgs.some((m) => (m.payload as { type?: string }).type === "subagent")).toBe(false);
    const nested = msgs.filter((m) => m.origin !== undefined);
    expect(nested).toHaveLength(2);
    for (const m of nested) expect(m.origin).toEqual([CHILD]);
  });

  it("recursively expands grandchild sessions; the origin chain is prefixed level by level", async () => {
    await writeTrace(root, PARENT_AGENT, PARENT, [
      meta(PARENT, PARENT_AGENT),
      subagentEvent(CHILD),
    ]);
    await writeTrace(root, CHILD_AGENT, CHILD, [
      meta(CHILD, CHILD_AGENT),
      subagentEvent(GRANDCHILD),
    ]);
    await writeTrace(root, CHILD_AGENT, GRANDCHILD, [
      meta(GRANDCHILD, CHILD_AGENT),
      assistantText("grandchild answer"),
    ]);

    const msgs = await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    const deepest = msgs.find((m) => (m.payload as { text?: string }).text === "grandchild answer");
    expect(deepest?.origin).toEqual([CHILD, GRANDCHILD]);
    expect(msgs.filter((m) => m.type === "session_meta")).toHaveLength(3);
  });

  it("cyclic pointers (self / ancestor) are not expanded; the pointer event is kept", async () => {
    // Never produced by normal operation (core only writes a direct child-session
    // pointer at the spawn point); this guards against expansion runaway on a
    // tampered/corrupted Trace.
    await writeTrace(root, PARENT_AGENT, PARENT, [
      meta(PARENT, PARENT_AGENT),
      subagentEvent(PARENT), // self-reference
      subagentEvent(CHILD),
    ]);
    await writeTrace(root, CHILD_AGENT, CHILD, [
      meta(CHILD, CHILD_AGENT),
      subagentEvent(PARENT), // points back to an ancestor
      assistantText("sub-session answer"),
    ]);

    const msgs = await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    // Self-referencing and ancestor-pointing pointers are kept as-is; CHILD expands normally exactly once.
    const pointers = msgs.filter((m) => (m.payload as { type?: string }).type === "subagent");
    expect(pointers).toHaveLength(2);
    expect(msgs.filter((m) => m.type === "session_meta")).toHaveLength(2);
    expect(
      msgs.filter((m) => (m.payload as { text?: string }).text === "sub-session answer"),
    ).toHaveLength(1);
  });

  it("a missing child Trace keeps the pointer event (the child content can't be recovered, but the spawn record doesn't vanish)", async () => {
    await writeTrace(root, PARENT_AGENT, PARENT, [
      meta(PARENT, PARENT_AGENT),
      subagentEvent(CHILD),
    ]);

    const msgs = await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.type).toBe("event_msg");
    expect(msgs[1]!.payload).toMatchObject({ type: "subagent", session_id: CHILD });
  });
});
