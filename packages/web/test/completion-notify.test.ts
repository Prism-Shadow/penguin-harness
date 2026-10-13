import { describe, expect, it } from "vitest";
import {
  createCompletionTracker,
  observedSessions,
  type ObservedSession,
} from "../src/lib/completion-notify";

import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";

const row = (sessionId: string, status: SessionStatus): ObservedSession => ({
  sessionId,
  status,
});

describe("createCompletionTracker", () => {
  it("fires when a known running session goes idle", () => {
    const t = createCompletionTracker();
    expect(t.observe([row("a", "running")], 0)).toEqual([]);
    expect(t.observe([row("a", "idle")], 1000)).toEqual(["a"]);
  });

  it("treats compacting as still active and fires only on the flip to idle", () => {
    const t = createCompletionTracker();
    t.observe([row("a", "running")], 0);
    expect(t.observe([row("a", "compacting")], 100)).toEqual([]);
    expect(t.observe([row("a", "idle")], 200)).toEqual(["a"]);
  });

  it("never fires on first observation, even an idle one after a running list load", () => {
    const t = createCompletionTracker();
    // A list that loads with idle sessions has witnessed nothing.
    expect(t.observe([row("a", "idle"), row("b", "idle")], 0)).toEqual([]);
    expect(t.observe([row("a", "idle"), row("b", "idle")], 100)).toEqual([]);
  });

  it("dedupes per run: repeated idle observations fire once", () => {
    const t = createCompletionTracker();
    t.observe([row("a", "running")], 0);
    expect(t.observe([row("a", "idle")], 1000)).toEqual(["a"]);
    expect(t.observe([row("a", "idle")], 2000)).toEqual([]);
    expect(t.observe([row("a", "idle")], 60_000)).toEqual([]);
  });

  it("fires again for a genuinely new run after the cooldown", () => {
    const t = createCompletionTracker(10_000);
    t.observe([row("a", "running")], 0);
    expect(t.observe([row("a", "idle")], 1000)).toEqual(["a"]);
    t.observe([row("a", "running")], 20_000);
    expect(t.observe([row("a", "idle")], 30_000)).toEqual(["a"]);
  });

  it("suppresses a stale-snapshot flap within the cooldown window", () => {
    const t = createCompletionTracker(10_000);
    t.observe([row("a", "running")], 0);
    expect(t.observe([row("a", "idle")], 1000)).toEqual(["a"]);
    // A stale reload snapshot resurrects "running", then the fresh state lands again:
    // the same finish must not notify twice.
    t.observe([row("a", "running")], 1100);
    expect(t.observe([row("a", "idle")], 1200)).toEqual([]);
  });

  it("tracks sessions independently and reports multiple completions", () => {
    const t = createCompletionTracker();
    t.observe([row("a", "running"), row("b", "running"), row("c", "idle")], 0);
    expect(t.observe([row("a", "idle"), row("b", "idle"), row("c", "idle")], 1000)).toEqual([
      "a",
      "b",
    ]);
  });

  it("prunes sessions that leave the list: reappearing is a fresh first observation", () => {
    const t = createCompletionTracker();
    t.observe([row("a", "running")], 0);
    // Project switch empties the list; the session's state is dropped.
    t.observe([], 100);
    expect(t.observe([row("a", "idle")], 200)).toEqual([]);
  });

  it("ignores duplicate ids within one observation (first occurrence wins)", () => {
    const t = createCompletionTracker();
    t.observe([row("a", "running")], 0);
    expect(t.observe([row("a", "idle"), row("a", "running")], 1000)).toEqual(["a"]);
    // The duplicate "running" row did not restart the run.
    expect(t.observe([row("a", "idle")], 60_000)).toEqual([]);
  });
});

describe("observedSessions", () => {
  const info = (sessionId: string, over: Partial<SessionInfo>): SessionInfo => ({
    sessionId,
    projectId: "p",
    agentId: "a1",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt: "2026-10-11T09:00:00.000Z",
    lastActiveAt: "2026-10-11T09:00:00.000Z",
    status: "running",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    ...over,
  });

  it("notifies for the sidebar's conversations only, not for the archived, subagent or organization Sessions a page holds", () => {
    const t = createCompletionTracker();
    const running = [
      info("mine", { source: "user" }),
      info("kept", { source: "cli" }),
      info("filed", { source: "user", archived: true }),
      info("program", { source: "api", archived: true }),
      info("child", { source: "subagent" }),
      info("desk", { source: "company", orgId: "o1" }),
    ];
    t.observe(observedSessions(running), 0);
    const settled = running.map((s) => ({ ...s, status: "idle" as const }));
    expect(t.observe(observedSessions(settled), 1000)).toEqual(["mine", "kept"]);
  });
});
