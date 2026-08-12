/** Read-only, locale-aware Prompt used by the chat-level learning bridge. */
import { afterEach, describe, expect, it } from "vitest";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  buildSessionLearningPrompt,
  canLearnFromSession,
} from "../src/features/chat/session-learning";

afterEach(() => setActiveStrings(zh));

const source = {
  agentId: "kimi-agent",
  sessionId: "session-123",
  tracePath: "/tmp/Penguin Harness/kimi-agent/traces/trace.jsonl",
  workspace: "/tmp/project",
};

describe("buildSessionLearningPrompt", () => {
  it("identifies the exact source and keeps path values unambiguous", () => {
    const prompt = buildSessionLearningPrompt(source);
    expect(prompt).toContain('source_agent_id: "kimi-agent"');
    expect(prompt).toContain('source_session_id: "session-123"');
    expect(prompt).toContain(
      'source_trace_path: "/tmp/Penguin Harness/kimi-agent/traces/trace.jsonl"',
    );
    expect(prompt).toContain('source_workspace: "/tmp/project"');
  });

  it("requires a read-only proposal and preserves the Harness validation boundary", () => {
    const prompt = buildSessionLearningPrompt(source);
    expect(prompt).toContain("不得修改任何文件");
    expect(prompt).toContain("memory");
    expect(prompt).toContain("skill");
    expect(prompt).toContain("agent_evolution");
    expect(prompt).toContain("Development Benchmark");
    expect(prompt).toContain("Promotion");
    expect(prompt).toContain("等待用户明确确认");
  });

  it("follows the active locale", () => {
    setActiveStrings(en);
    expect(buildSessionLearningPrompt(source)).toContain("read-only Learning Review");
    expect(S.chat.learnFromSession).toBe("Learn from this chat");
    setActiveStrings(zh);
    expect(buildSessionLearningPrompt(source)).toContain("只读 Learning Review");
  });

  it("JSON-quotes control characters in source values", () => {
    const prompt = buildSessionLearningPrompt({ ...source, workspace: 'line1\n"line2"' });
    expect(prompt).toContain('source_workspace: "line1\\n\\"line2\\""');
    expect(prompt).not.toContain('source_workspace: line1\n"line2"');
  });
});

describe("canLearnFromSession", () => {
  it("allows a settled user chat as soon as either the list or loaded stream proves a Task exists", () => {
    expect(canLearnFromSession({ hasTrace: true, taskCount: 0, taskState: "idle" })).toBe(true);
    expect(canLearnFromSession({ hasTrace: false, taskCount: 1, taskState: "idle" })).toBe(true);
  });

  it("rejects empty, running, and system-origin Sessions", () => {
    expect(canLearnFromSession({ hasTrace: false, taskCount: 0, taskState: "idle" })).toBe(false);
    expect(canLearnFromSession({ hasTrace: true, taskCount: 1, taskState: "running" })).toBe(false);
    expect(
      canLearnFromSession({
        source: "promotion",
        hasTrace: true,
        taskCount: 1,
        taskState: "idle",
      }),
    ).toBe(false);
  });
});
