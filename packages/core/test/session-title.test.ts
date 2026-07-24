/**
 * Session title generation unit tests: prompt shape, sanitization rules, single-shot request
 * driving (fake LLM), and Session.generateTitle's composition-layer wiring (no real requests sent).
 */
import { describe, it, expect } from "vitest";
import {
  assistantText,
  emptyTokenCounts,
  sanitizeTitle,
  Session,
  stripConversationMarkers,
  thinkingMessage,
  tokenUsage,
  userText,
} from "../src/index.js";
// Prompt/request internals are no longer exported via the barrel: imported directly from the internal module.
import { buildTitlePrompt, generateTitleWithLLM } from "../src/internal/session-title.js";
import type {
  EnvironmentInterface,
  LLMInterface,
  LLMOutcome,
  OmniMessage,
  SessionMetaPayload,
} from "../src/index.js";

/** A fake LLM: yields the given messages and finishes with the outcome; records the prompt received. */
function fakeLLM(
  outputs: OmniMessage[],
  outcome: LLMOutcome = { status: "completed" },
  seenPrompts: string[] = [],
): LLMInterface {
  return {
    async *streamGenerate({ newMessages }) {
      const first = newMessages[0];
      if (first) seenPrompts.push((first.payload as { text: string }).text);
      for (const msg of outputs) yield msg;
      return outcome;
    },
  };
}

const fakeEnvironment: EnvironmentInterface = {
  listTools: async () => [],
  // eslint-disable-next-line require-yield
  executeTool: async function* () {
    throw new Error("not used");
  },
  toolPermission: () => undefined,
};

const META: SessionMetaPayload = {
  session_id: "session-title-1",
  provider: "custom",
  model_id: "m1",
  model_context_window: 1000,
  system_prompt: "sp",
  tools: [],
  agent_state: "/tmp/state",
  workspace: "/tmp/w",
};

describe("session-title", () => {
  it("generateTitleWithLLM: collects model text and usage, returns the sanitized result", async () => {
    const seen: string[] = [];
    const result = await generateTitleWithLLM(
      fakeLLM(
        [
          thinkingMessage("想一下"), // thinking does not count
          assistantText("「Tailwind 主题配置」。"),
          tokenUsage(emptyTokenCounts(), { cache_read: 1, cache_write: 2, output: 3, total: 6 }),
        ],
        { status: "completed" },
        seen,
      ),
      { userText: "解释 @theme", assistantText: "好的……" },
    );
    expect(result.title).toBe("Tailwind 主题配置");
    expect(result.usage).toEqual({ cache_read: 1, cache_write: 2, output: 3, total: 6 });
    expect(seen[0]).toBe(buildTitlePrompt("解释 @theme", "好的……"));
    expect(seen[0]).toContain("SAME language");
  });

  it("sends no request when material is empty; title is null when the outcome is not completed (usage kept)", async () => {
    const seen: string[] = [];
    const empty = await generateTitleWithLLM(fakeLLM([], { status: "completed" }, seen), {
      userText: "  ",
      assistantText: "a",
    });
    expect(empty).toEqual({ title: null, usage: null });
    expect(seen).toHaveLength(0);

    const failed = await generateTitleWithLLM(
      fakeLLM(
        [
          assistantText("partial"),
          tokenUsage(emptyTokenCounts(), { cache_read: 0, cache_write: 0, output: 1, total: 1 }),
        ],
        { status: "failed", message: "401" },
      ),
      { userText: "u", assistantText: "a" },
    );
    expect(failed.title).toBeNull();
    expect(failed.usage?.total).toBe(1);
  });

  it("still generates with empty assistant material (tool-only turn): uses only the user request, prompt omits the assistant section", async () => {
    const seen: string[] = [];
    const result = await generateTitleWithLLM(
      fakeLLM([assistantText("配置 Tailwind 主题")], { status: "completed" }, seen),
      { userText: "帮我配置 @theme", assistantText: "" },
    );
    expect(result.title).toBe("配置 Tailwind 主题");
    expect(seen[0]).toBe(buildTitlePrompt("帮我配置 @theme", ""));
    expect(seen[0]).not.toContain("[Assistant]");
  });

  it("sanitizeTitle: strips quotes/punctuation to a fixed point, collapses whitespace, truncates overlong input, returns null for empty", () => {
    expect(sanitizeTitle("“ 构建配置 说明 。”")).toBe("构建配置 说明");
    expect(sanitizeTitle("『标题』！")).toBe("标题");
    expect(sanitizeTitle("  \n ")).toBeNull();
    expect(sanitizeTitle("x".repeat(50))).toHaveLength(30);
    // A leaked <use_skills> block is stripped from the model output.
    expect(sanitizeTitle("<use_skills>\nskills: web-design\n</use_skills>\n构建落地页")).toBe(
      "构建落地页",
    );
  });

  it("stripConversationMarkers: removes machine marker blocks, keeps the human body", () => {
    // The skill-invocation block that wraps a first user message must not reach the title.
    expect(
      stripConversationMarkers(
        "<use_skills>\nskills: penguin-sdk, web-design\n</use_skills>\n做一个 RAG 应用",
      ),
    ).toBe("做一个 RAG 应用");
    // Handoff and scheduled-task markers are stripped too; ordinary angle-bracket text stays.
    expect(stripConversationMarkers("<handoff_from>data_analyst</handoff_from>继续分析")).toBe(
      "继续分析",
    );
    expect(stripConversationMarkers("render a <div> element")).toBe("render a <div> element");
  });

  it("Session.generateTitle: sends via createBareLLM; returns null when no factory is provided", async () => {
    const withFactory = new Session({
      meta: META,
      llm: fakeLLM([]),
      environment: fakeEnvironment,
      createBareLLM: () => fakeLLM([assistantText("Title A")]),
    });
    expect(
      await withFactory.generateTitle({ material: { userText: "u", assistantText: "a" } }),
    ).toEqual({
      title: "Title A",
      usage: null,
    });

    const withoutFactory = new Session({
      meta: META,
      llm: fakeLLM([]),
      environment: fakeEnvironment,
    });
    expect(await withoutFactory.generateTitle()).toEqual({
      title: null,
      usage: null,
    });
  });

  it("Session.generateTitle: self-collects material (run gathers the user input and model text), none needed from the caller", async () => {
    const seen: string[] = [];
    const session = new Session({
      meta: META,
      llm: fakeLLM([thinkingMessage("thinking"), assistantText("answer body")]),
      environment: fakeEnvironment,
      createBareLLM: () => fakeLLM([assistantText("Title B")], { status: "completed" }, seen),
    });
    for await (const _ of session.run([userText("user question")])) {
      void _; // Drains the output stream; once run finishes, the material is settled
    }
    const res = await session.generateTitle();
    expect(res.title).toBe("Title B");
    // Material = the first Task's user text + model text (thinking does not count), matching
    // buildTitlePrompt's shape.
    expect(seen[0]).toBe(buildTitlePrompt("user question", "answer body"));
    // Anti-CoT shape: an explicit no-thinking rule, and the prompt ends with an empty think
    // block so reasoning models treat their thinking phase as already closed.
    expect(seen[0]).toContain("do not think aloud");
    expect(seen[0]!.endsWith("<think></think>")).toBe(true);

    // No request is sent when no material has been collected (run was never called).
    const idle = new Session({
      meta: META,
      llm: fakeLLM([]),
      environment: fakeEnvironment,
      createBareLLM: () => fakeLLM([assistantText("must not be produced")]),
    });
    expect(await idle.generateTitle()).toEqual({ title: null, usage: null });
  });
});
