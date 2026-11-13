/**
 * A subagent pointer whose Trace never landed must not cost a Project-wide reconcile on
 * every read of its parent Session.
 *
 * The pointer is re-read each time the parent is opened, and the old miss path force-scanned
 * the whole Project's trace tree to answer it — inline, on the server's event loop. On a real
 * install (~3.5k shards) that measured 46s, then 72s, per conversation open, with every other
 * route queued behind it. A dead pointer can only be answered "not here", so the read says so
 * from the index it has, and ONE detached scan keeps the index honest for pointers that are
 * merely late rather than dead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assistantText, sessionMeta, subagentEvent } from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core";
import type { TraceService } from "../src/services/trace-service.js";
import { makeTraceHarness } from "./helpers.js";

const PROJECT = "proj";
const PARENT_AGENT = "default_agent";
const PARENT = "session-2026-07-09-10-00-00-aaaa0001";
/** A subagent Session whose Trace never reached disk (aborted run, pruned file). */
const DEAD_CHILD = "session-2026-07-09-10-00-09-dead0099";

function meta(sessionId: string, agentId: string): OmniMessage {
  const payload: SessionMetaPayload = {
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: `/root/${PROJECT}/${agentId}/agent_state`,
    workspace: "/tmp/w",
    source: "user",
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

describe("TraceService.readMessages — a pointer whose Trace never landed", () => {
  let root: string;
  let svc: TraceService;
  let harness: ReturnType<typeof makeTraceHarness>;
  let scans: () => number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-trace-deadchild-"));
    harness = makeTraceHarness(root);
    svc = harness.service;
    // Count the Project-wide force-reconcile: the cost this test is about.
    const real = harness.traceIndex.reconcileProject.bind(harness.traceIndex);
    let count = 0;
    scans = () => count;
    vi.spyOn(harness.traceIndex, "reconcileProject").mockImplementation(
      (projectId: string, opts?: { force?: boolean }) => {
        if (opts?.force === true) count += 1;
        return real(projectId, opts);
      },
    );
    await writeTrace(root, PARENT_AGENT, PARENT, [
      meta(PARENT, PARENT_AGENT),
      subagentEvent(DEAD_CHILD),
      assistantText("the run stopped before the child wrote anything"),
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    harness.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps the parent's own messages and leaves the pointer unexpanded", async () => {
    const msgs = await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    const texts = msgs.map((m) => (m.payload as { text?: string; type?: string }).text ?? m.type);
    expect(texts).toContain("the run stopped before the child wrote anything");
    // Nothing to expand: the pointer stays exactly as the Trace recorded it (the same shape
    // the cyclic-pointer case keeps), and no child message or origin chain is invented.
    expect(msgs.some((m) => (m.payload as { type?: string }).type === "subagent")).toBe(true);
    expect(msgs.filter((m) => m.origin !== undefined)).toHaveLength(0);
  });

  it("never blocks the read on a Project scan", async () => {
    // A scan that takes longer than any test timeout would hang the old implementation; the
    // read must return regardless, so this only asserts it completed at all.
    await expect(svc.readMessages(PROJECT, PARENT_AGENT, PARENT)).resolves.toBeDefined();
  });

  it("scans at most once across repeated reads of the same dead pointer", async () => {
    await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    const afterFirst = scans();
    for (let i = 0; i < 4; i++) await svc.readMessages(PROJECT, PARENT_AGENT, PARENT);
    // The first read may schedule exactly one detached scan; the rest must add none.
    expect(afterFirst).toBeLessThanOrEqual(1);
    expect(scans()).toBe(afterFirst);
  });
});