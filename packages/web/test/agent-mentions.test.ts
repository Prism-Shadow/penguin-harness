/**
 * agent-mentions.ts unit tests: @ mention matching (cursor prefix / boundary
 * rules), candidate filtering, send-time parsing of a leading @ mention,
 * and the re-export wiring for the origin marker blocks (their own semantics — both forms,
 * anchoring, legacy compat — are covered by packages/core/test/markers.test.ts).
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import {
  filterAgents,
  handoffMessage,
  matchMention,
  modelSwitchMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
  splitLeadingMention,
} from "../src/features/chat/agent-mentions";

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
});

const AGENTS: AgentSummary[] = [
  agent("default_agent", "General Agent"),
  agent("agent_creator", "Agent Creator"),
  agent("agent_optimizer", "Agent Optimizer"),
  agent("researcher"),
];

describe("matchMention (the @ prefix being typed at the cursor)", () => {
  it("@ at text start or after whitespace triggers; query is the prefix between @ and the cursor, end == cursor when the cursor sits at token end", () => {
    expect(matchMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(matchMention("@age", 4)).toEqual({ start: 0, end: 4, query: "age" });
    expect(matchMention("fix it @res", 11)).toEqual({ start: 7, end: 11, query: "res" });
    expect(matchMention("line1\n@a", 8)).toEqual({ start: 6, end: 8, query: "a" });
  });

  it("@ after non-whitespace (e.g. an email) does not trigger", () => {
    expect(matchMention("mail me a@b", 11)).toBeNull();
    expect(matchMention("a@", 2)).toBeNull();
  });

  it("non-id characters (spaces etc.) between @ and the cursor do not trigger", () => {
    expect(matchMention("@agent done", 11)).toBeNull();
    expect(matchMention("no at here", 10)).toBeNull();
  });

  it("works with the cursor mid-token: end covers the whole remainder right of the cursor (replacement leaves no tail behind)", () => {
    expect(matchMention("@agent_creator", 3)).toEqual({ start: 0, end: 14, query: "ag" });
    // The remainder stops at the token boundary (whitespace/end of text): trailing plain text is not swallowed.
    expect(matchMention("@ag rest", 3)).toEqual({ start: 0, end: 3, query: "ag" });
    expect(matchMention("see @agent_creator now", 7)).toEqual({ start: 4, end: 18, query: "ag" });
  });
});

describe("filterAgents (prefix filtering)", () => {
  it("an empty prefix returns all candidates", () => {
    expect(filterAgents(AGENTS, "")).toHaveLength(4);
  });

  it("filters by agentId prefix, case-insensitive", () => {
    expect(filterAgents(AGENTS, "agent_").map((a) => a.agentId)).toEqual([
      "agent_creator",
      "agent_optimizer",
    ]);
    expect(filterAgents(AGENTS, "RES").map((a) => a.agentId)).toEqual(["researcher"]);
  });

  it("display-name prefixes match too", () => {
    expect(filterAgents(AGENTS, "General").map((a) => a.agentId)).toEqual(["default_agent"]);
  });
});

describe("splitLeadingMention (send-time parsing of a leading @)", () => {
  it("starting with an existing agentId: splits out the target and the remaining body (leading whitespace trimmed, newlines absorbed too)", () => {
    expect(splitLeadingMention("@researcher check this", AGENTS)).toEqual({
      agent: AGENTS[3],
      rest: "check this",
    });
    expect(splitLeadingMention("@researcher\nnext line", AGENTS)).toEqual({
      agent: AGENTS[3],
      rest: "next line",
    });
  });

  it("@ alone with no body: rest is an empty string; punctuation right after the token stays in the body", () => {
    expect(splitLeadingMention("@agent_creator", AGENTS)).toEqual({
      agent: AGENTS[1],
      rest: "",
    });
    expect(splitLeadingMention("@researcher, please", AGENTS)).toEqual({
      agent: AGENTS[3],
      rest: ", please",
    });
  });

  it("the id is the longest [\\w-]+ run, matched exactly: overlong/unknown tokens do not count (@foo2 is not a mention of foo)", () => {
    expect(splitLeadingMention("@agent_creator2 x", AGENTS)).toBeNull();
    expect(splitLeadingMention("@nobody x", AGENTS)).toBeNull();
  });

  it("@ not at the start never parses (a mid-body @ is plain text)", () => {
    expect(splitLeadingMention("hi @researcher", AGENTS)).toBeNull();
    expect(splitLeadingMention("plain text", AGENTS)).toBeNull();
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
