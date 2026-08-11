/**
 * agent-handoff.ts unit tests: the `/agent` picker's candidate filtering, the staged-switch
 * send decision (`/agent` and `/model` only act on Enter — this is where "act on what, and
 * when" is pinned down), and the re-export wiring for the origin marker blocks (their own
 * semantics — both forms, anchoring, legacy compat — are covered by
 * packages/core/test/markers.test.ts).
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import {
  filterAgents,
  handoffMessage,
  modelSwitchMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
  stagedSendRoute,
} from "../src/features/chat/agent-handoff";

const agent = (agentId: string, name?: string): AgentSummary => ({
  agentId,
  ...(name !== undefined ? { name } : {}),
  activeSessionCount: 0,
  sessionCount: 0,
  sessionActivity: [],
  toolCount: 0,
  version: 1,
  vaultKeyCount: 0,
  scheduleCount: 0,
  skillCount: 0,
  memoryCount: 0,
});

const AGENTS: AgentSummary[] = [
  agent("default_agent", "General Agent"),
  agent("agent_creator", "Agent Creator"),
  agent("agent_optimizer", "Agent Optimizer"),
  agent("researcher"),
];

describe("filterAgents (the /agent picker's search box)", () => {
  it("an empty or whitespace-only query returns all candidates", () => {
    expect(filterAgents(AGENTS, "")).toHaveLength(4);
    expect(filterAgents(AGENTS, "   ")).toHaveLength(4);
  });

  it("filters by agentId, case-insensitively", () => {
    expect(filterAgents(AGENTS, "agent_").map((a) => a.agentId)).toEqual([
      "agent_creator",
      "agent_optimizer",
    ]);
    expect(filterAgents(AGENTS, "RES").map((a) => a.agentId)).toEqual(["researcher"]);
  });

  it("display names match too", () => {
    expect(filterAgents(AGENTS, "General").map((a) => a.agentId)).toEqual(["default_agent"]);
  });

  it("matches anywhere in the id/name, not only at its start (substring rule, like the model search box)", () => {
    expect(filterAgents(AGENTS, "creator").map((a) => a.agentId)).toEqual(["agent_creator"]);
    expect(filterAgents(AGENTS, "optim").map((a) => a.agentId)).toEqual(["agent_optimizer"]);
  });

  it("nothing matches: the picker gets an empty list (and renders its no-match copy)", () => {
    expect(filterAgents(AGENTS, "nobody")).toEqual([]);
  });
});

describe("stagedSendRoute (what a staged /agent or /model chip does on send)", () => {
  /** Defaults: an idle active session with nothing staged — the composer's ordinary state. */
  const route = (over: Partial<Parameters<typeof stagedSendRoute>[0]> = {}) =>
    stagedSendRoute({
      handoffTarget: false,
      pendingModel: false,
      canSwitchModel: true,
      sessionBusy: false,
      ...over,
    });

  it("nothing staged: the message is an ordinary post", () => {
    expect(route()).toBe("post");
    // Even mid-run: steering and the follow-up queue are both plain posts.
    expect(route({ sessionBusy: true })).toBe("post");
  });

  it("a staged handoff opens the new chat regardless of what this session is doing", () => {
    // The handoff neither reads nor writes the running session — it is safe mid-run, and was
    // already allowed there before the switches became staged.
    expect(route({ handoffTarget: true })).toBe("handoff");
    expect(route({ handoffTarget: true, sessionBusy: true })).toBe("handoff");
  });

  it("a staged model fork goes out only while this session is idle", () => {
    expect(route({ pendingModel: true })).toBe("model");
    // Running / compacting: the fork branches off a Trace still being appended to, and the run
    // may have started from outside the composer (queued follow-up, schedule, another tab).
    expect(route({ pendingModel: true, sessionBusy: true })).toBe("blocked");
  });

  it("blocked never degrades into a plain post: the message must not land in the session being left", () => {
    // The distinction that matters — "blocked" is not "post". Falling through would deliver the
    // draft to the very session the user staged a switch away from.
    expect(route({ pendingModel: true, sessionBusy: true })).not.toBe("post");
  });

  it("where a fork is impossible at all (the draft page has no session to fork), the chip cannot block a send", () => {
    expect(route({ pendingModel: true, canSwitchModel: false })).toBe("post");
    expect(route({ pendingModel: true, canSwitchModel: false, sessionBusy: true })).toBe("post");
  });

  it("should both chips ever coexist, the handoff wins — it is the one that touches nothing here", () => {
    expect(route({ handoffTarget: true, pendingModel: true })).toBe("handoff");
    expect(route({ handoffTarget: true, pendingModel: true, sessionBusy: true })).toBe("handoff");
  });
});

describe("origin marker blocks are re-exported from core", () => {
  it("handoff / model-switch producers emit the square form and round-trip through the feature module", () => {
    const handoff = handoffMessage({ agentId: "default_agent", workspace: "/data/ws" });
    expect(handoff.startsWith("[handoff_from]\n")).toBe(true);
    expect(parseHandoffMessage(handoff)).toEqual({
      agentId: "default_agent",
      workspace: "/data/ws",
    });
    const switched = modelSwitchMessage({ sessionId: "session-01", tracePath: "/t.jsonl" });
    expect(switched.startsWith("[model_switch_from]\n")).toBe(true);
    expect(parseModelSwitchMessage(switched)).toEqual({
      sessionId: "session-01",
      tracePath: "/t.jsonl",
    });
  });

  it("the scheduled-task parser (server-produced block) is reachable here for the banner", () => {
    expect(
      parseScheduledMessage(
        "[scheduled_task]\nschedule: daily\nfired_at: 2026-01-01T00:00:00Z\n[/scheduled_task]\n\nbody",
      ),
    ).toEqual({ origin: { name: "daily", firedAt: "2026-01-01T00:00:00Z" }, rest: "body" });
  });
});
