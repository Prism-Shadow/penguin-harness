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
});

const AGENTS: AgentSummary[] = [
  agent("default_agent", "General Agent"),
  agent("agent_creator", "Agent Creator"),
  agent("agent_optimizer", "Agent Optimizer"),
  agent("researcher"),
];

describe("matchMention（光标处正在输入的 @ 前缀）", () => {
  it("文首与空白后的 @ 触发；query 为 @ 到光标之间的前缀，光标在 token 末尾时 end == 光标", () => {
    expect(matchMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(matchMention("@age", 4)).toEqual({ start: 0, end: 4, query: "age" });
    expect(matchMention("fix it @res", 11)).toEqual({ start: 7, end: 11, query: "res" });
    expect(matchMention("line1\n@a", 8)).toEqual({ start: 6, end: 8, query: "a" });
  });

  it("非空白后的 @（如邮箱）不触发", () => {
    expect(matchMention("mail me a@b", 11)).toBeNull();
    expect(matchMention("a@", 2)).toBeNull();
  });

  it("@ 与光标之间含非 id 字符（空格等）不触发", () => {
    expect(matchMention("@agent done", 11)).toBeNull();
    expect(matchMention("no at here", 10)).toBeNull();
  });

  it("光标在 token 中间也生效：end 覆盖光标右侧的整个残段（替换不残留后半段）", () => {
    expect(matchMention("@agent_creator", 3)).toEqual({ start: 0, end: 14, query: "ag" });
    // The remainder stops at the token boundary (whitespace/end of text): trailing plain text is not swallowed.
    expect(matchMention("@ag rest", 3)).toEqual({ start: 0, end: 3, query: "ag" });
    expect(matchMention("see @agent_creator now", 7)).toEqual({ start: 4, end: 18, query: "ag" });
  });
});

describe("filterAgents（前缀过滤）", () => {
  it("空前缀返回全部候选", () => {
    expect(filterAgents(AGENTS, "")).toHaveLength(4);
  });

  it("按 agentId 前缀过滤，大小写不敏感", () => {
    expect(filterAgents(AGENTS, "agent_").map((a) => a.agentId)).toEqual([
      "agent_creator",
      "agent_optimizer",
    ]);
    expect(filterAgents(AGENTS, "RES").map((a) => a.agentId)).toEqual(["researcher"]);
  });

  it("显示名前缀同样命中", () => {
    expect(filterAgents(AGENTS, "General").map((a) => a.agentId)).toEqual(["default_agent"]);
  });
});

describe("splitLeadingMention（句首 @ 的发送时解析）", () => {
  it("以现有 agentId 开头：拆出目标与剩余正文（开头空白修剪，换行同样吸收）", () => {
    expect(splitLeadingMention("@researcher check this", AGENTS)).toEqual({
      agent: AGENTS[3],
      rest: "check this",
    });
    expect(splitLeadingMention("@researcher\nnext line", AGENTS)).toEqual({
      agent: AGENTS[3],
      rest: "next line",
    });
  });

  it("只 @ 无正文：rest 为空串；标点紧随 token 时保留在正文里", () => {
    expect(splitLeadingMention("@agent_creator", AGENTS)).toEqual({
      agent: AGENTS[1],
      rest: "",
    });
    expect(splitLeadingMention("@researcher, please", AGENTS)).toEqual({
      agent: AGENTS[3],
      rest: ", please",
    });
  });

  it("id 取最长 [\\w-]+ 串精确匹配：超长/不存在的 token 不算（@foo2 不算 @ 到 foo）", () => {
    expect(splitLeadingMention("@agent_creator2 x", AGENTS)).toBeNull();
    expect(splitLeadingMention("@nobody x", AGENTS)).toBeNull();
  });

  it("非句首的 @ 一律不解析（正文中间的 @ 是普通文字）", () => {
    expect(splitLeadingMention("hi @researcher", AGENTS)).toBeNull();
    expect(splitLeadingMention("plain text", AGENTS)).toBeNull();
  });
});

describe("handoffMessage（新对话首条 <handoff_from> 来源块）", () => {
  it("完整来源：agent 显示名与 Session 标题括注、Workspace 各占一行", () => {
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

  it("草稿态（无 Session）只带来源 agent；显示名与 id 相同或缺省时省略括注", () => {
    const text = handoffMessage({ agentId: "researcher", agentName: "researcher" });
    expect(text).toContain("agent: researcher\n");
    expect(text).not.toContain("session:");
    expect(text).not.toContain("workspace:");
    expect(handoffMessage({ agentId: "researcher" })).toContain("agent: researcher\n");
  });

  it("Session 标题缺省时省略括注", () => {
    const text = handoffMessage({
      agentId: "default_agent",
      sessionId: "session-01ABC",
      workspace: "/data/ws",
    });
    expect(text).toContain("session: session-01ABC\n");
  });
});

describe("parseHandoffMessage（来源块逆向解析，驱动交接提示渲染）", () => {
  it("与 handoffMessage 往返一致（含带括号的 Session 标题）", () => {
    const origin = {
      agentId: "default_agent",
      agentName: "General Agent",
      sessionId: "session-01ABC",
      sessionTitle: "Fix (the) parser",
      workspace: "/data/ws",
    };
    expect(parseHandoffMessage(handoffMessage(origin))).toEqual(origin);
  });

  it("最小来源（仅 agent）往返；显示名与 id 相同时生成端省略括注、解析端只还原 id", () => {
    expect(parseHandoffMessage(handoffMessage({ agentId: "researcher" }))).toEqual({
      agentId: "researcher",
    });
    expect(
      parseHandoffMessage(handoffMessage({ agentId: "researcher", agentName: "researcher" })),
    ).toEqual({ agentId: "researcher" });
  });

  it("普通消息与只是包含来源块的更长消息不误判", () => {
    expect(parseHandoffMessage("hello @default_agent")).toBeNull();
    expect(parseHandoffMessage(`before\n${handoffMessage({ agentId: "a1" })}`)).toBeNull();
    expect(parseHandoffMessage(`${handoffMessage({ agentId: "a1" })}\nafter`)).toBeNull();
  });
});

describe("parseScheduledMessage（定时任务来源块解析，驱动定时提示渲染）", () => {
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

  it("解析来源块并返回剩余正文（正文照常渲染）", () => {
    const text = scheduled("daily_report", "2026-07-16T01:00:00.000Z", "写日报\n附昨日数据");
    expect(parseScheduledMessage(text)).toEqual({
      origin: { name: "daily_report", firedAt: "2026-07-16T01:00:00.000Z" },
      rest: "写日报\n附昨日数据",
    });
  });

  it("普通消息与中途出现的块不误判；缺任务名视为非来源块", () => {
    expect(parseScheduledMessage("hello")).toBeNull();
    expect(
      parseScheduledMessage(`前言\n${scheduled("t", "2026-01-01T00:00:00Z", "p")}`),
    ).toBeNull();
    expect(
      parseScheduledMessage(
        "<scheduled_task>\nfired_at: 2026-01-01T00:00:00Z\n</scheduled_task>\n\np",
      ),
    ).toBeNull();
  });
});
