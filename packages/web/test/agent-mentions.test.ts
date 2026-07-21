/**
 * agent-mentions.ts unit tests: @ mention matching (cursor prefix / boundary
 * rules), candidate filtering, send-time parsing of a leading @ mention,
 * generation of the first new-conversation <handoff_from> origin block, and
 * <scheduled_task> origin block parsing.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import {
  filterAgents,
  handoffMessage,
  matchMention,
  parseHandoffMessage,
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

describe("handoffMessage (the first new-conversation <handoff_from> origin block)", () => {
  it("full origin: agent display name and Session title as parentheticals, Workspace on its own line", () => {
    const text = handoffMessage({
      agentId: "default_agent",
      agentName: "General Agent",
      sessionId: "session-01ABC",
      sessionTitle: "Fix the parser",
      workspace: "/data/ws",
    });
    expect(text.startsWith("<handoff_from>\n")).toBe(true);
    expect(text.endsWith("\n</handoff_from>")).toBe(true);
    expect(text).toContain("agent: default_agent (General Agent)");
    expect(text).toContain("session: session-01ABC (Fix the parser)");
    expect(text).toContain("workspace: /data/ws");
  });

  it("draft state (no Session) carries only the source agent; the parenthetical is omitted when the display name equals the id or is absent", () => {
    const text = handoffMessage({ agentId: "researcher", agentName: "researcher" });
    expect(text).toContain("agent: researcher\n");
    expect(text).not.toContain("session:");
    expect(text).not.toContain("workspace:");
    expect(handoffMessage({ agentId: "researcher" })).toContain("agent: researcher\n");
  });

  it("the parenthetical is omitted when the Session title is absent", () => {
    const text = handoffMessage({
      agentId: "default_agent",
      sessionId: "session-01ABC",
      workspace: "/data/ws",
    });
    expect(text).toContain("session: session-01ABC\n");
  });
});

describe("parseHandoffMessage (reverse-parses the origin block, driving the handoff notice rendering)", () => {
  it("round-trips with handoffMessage (including a Session title containing parentheses)", () => {
    const origin = {
      agentId: "default_agent",
      agentName: "General Agent",
      sessionId: "session-01ABC",
      sessionTitle: "Fix (the) parser",
      workspace: "/data/ws",
    };
    expect(parseHandoffMessage(handoffMessage(origin))).toEqual(origin);
  });

  it("minimal origin (agent only) round-trips; with display name equal to the id, generation omits the parenthetical and parsing restores only the id", () => {
    expect(parseHandoffMessage(handoffMessage({ agentId: "researcher" }))).toEqual({
      agentId: "researcher",
    });
    expect(
      parseHandoffMessage(handoffMessage({ agentId: "researcher", agentName: "researcher" })),
    ).toEqual({ agentId: "researcher" });
  });

  it("plain messages and longer messages merely containing an origin block are not misdetected", () => {
    expect(parseHandoffMessage("hello @default_agent")).toBeNull();
    expect(parseHandoffMessage(`before\n${handoffMessage({ agentId: "a1" })}`)).toBeNull();
    expect(parseHandoffMessage(`${handoffMessage({ agentId: "a1" })}\nafter`)).toBeNull();
  });
});

describe("parseScheduledMessage (parses the scheduled-task origin block, driving the schedule notice rendering)", () => {
  /** Shape of the server-side scheduledMessage output (scheduler.ts). */
  const scheduled = (name: string, firedAt: string, prompt: string): string =>
    [
      "<scheduled_task>",
      "This message was sent automatically by a scheduled task; its origin is listed below and the task prompt follows.",
      `schedule: ${name}`,
      `fired_at: ${firedAt}`,
      "</scheduled_task>",
      "",
      prompt,
    ].join("\n");

  it("parses the origin block and returns the remaining body (rendered as usual)", () => {
    const text = scheduled(
      "daily_report",
      "2026-07-16T01:00:00.000Z",
      "Write the daily report\nattach yesterday's data",
    );
    expect(parseScheduledMessage(text)).toEqual({
      origin: { name: "daily_report", firedAt: "2026-07-16T01:00:00.000Z" },
      rest: "Write the daily report\nattach yesterday's data",
    });
  });

  it("plain messages and mid-text blocks are not misdetected; a missing task name means it is not an origin block", () => {
    expect(parseScheduledMessage("hello")).toBeNull();
    expect(
      parseScheduledMessage(`preamble\n${scheduled("t", "2026-01-01T00:00:00Z", "p")}`),
    ).toBeNull();
    expect(
      parseScheduledMessage(
        "<scheduled_task>\nfired_at: 2026-01-01T00:00:00Z\n</scheduled_task>\n\np",
      ),
    ).toBeNull();
  });
});
