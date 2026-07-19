/**
 * Session title generation unit tests: prompt shape, sanitization rules, single-shot request
 * driving (fake LLM), and Session.generateTitle's composition-layer wiring (no real requests sent).
 */
import { describe, it, expect } from "vitest";
import {
  assistantText,
  buildTitlePrompt,
  emptyTokenCounts,
  generateTitleWithLLM,
  sanitizeTitle,
  Session,
  thinkingMessage,
  tokenUsage,
  userText,
} from "../src/index.js";
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
  thinking_level: "default",
  agent_state: "/tmp/state",
  workspace: "/tmp/w",
};

describe("session-title", () => {
  it("generateTitleWithLLM：收集模型 text 与用量，清洗后返回", async () => {
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

  it("素材为空不发请求；outcome 非 completed 时 title 为 null（usage 保留）", async () => {
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
          assistantText("半截"),
          tokenUsage(emptyTokenCounts(), { cache_read: 0, cache_write: 0, output: 1, total: 1 }),
        ],
        { status: "failed", message: "401" },
      ),
      { userText: "u", assistantText: "a" },
    );
    expect(failed.title).toBeNull();
    expect(failed.usage?.total).toBe(1);
  });

  it("助手素材为空也生成（纯工具轮次）：只据用户请求，prompt 省去助手段", async () => {
    const seen: string[] = [];
    const result = await generateTitleWithLLM(
      fakeLLM([assistantText("配置 Tailwind 主题")], { status: "completed" }, seen),
      { userText: "帮我配置 @theme", assistantText: "" },
    );
    expect(result.title).toBe("配置 Tailwind 主题");
    expect(seen[0]).toBe(buildTitlePrompt("帮我配置 @theme", ""));
    expect(seen[0]).not.toContain("[Assistant]");
  });

  it("sanitizeTitle：剥引号与句读到稳定、折叠空白、超长截断、空返回 null", () => {
    expect(sanitizeTitle("“ 构建配置 说明 。”")).toBe("构建配置 说明");
    expect(sanitizeTitle("『标题』！")).toBe("标题");
    expect(sanitizeTitle("  \n ")).toBeNull();
    expect(sanitizeTitle("x".repeat(50))).toHaveLength(30);
  });

  it("Session.generateTitle：经 createBareLLM 发起；未提供工厂时返回 null", async () => {
    const withFactory = new Session({
      meta: META,
      llm: fakeLLM([]),
      environment: fakeEnvironment,
      createBareLLM: () => fakeLLM([assistantText("标题 A")]),
    });
    expect(
      await withFactory.generateTitle({ material: { userText: "u", assistantText: "a" } }),
    ).toEqual({
      title: "标题 A",
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

  it("Session.generateTitle：素材自采（run 收集用户输入与模型正文），无需调用方提供", async () => {
    const seen: string[] = [];
    const session = new Session({
      meta: META,
      llm: fakeLLM([thinkingMessage("想想"), assistantText("答案正文")]),
      environment: fakeEnvironment,
      createBareLLM: () => fakeLLM([assistantText("标题 B")], { status: "completed" }, seen),
    });
    for await (const _ of session.run([userText("用户问题")])) {
      void _; // Drains the output stream; once run finishes, the material is settled
    }
    const res = await session.generateTitle();
    expect(res.title).toBe("标题 B");
    // Material = the first Task's user text + model text (thinking does not count), matching
    // buildTitlePrompt's shape.
    expect(seen[0]).toBe(buildTitlePrompt("用户问题", "答案正文"));

    // No request is sent when no material has been collected (run was never called).
    const idle = new Session({
      meta: META,
      llm: fakeLLM([]),
      environment: fakeEnvironment,
      createBareLLM: () => fakeLLM([assistantText("不应产生")]),
    });
    expect(await idle.generateTitle()).toEqual({ title: null, usage: null });
  });
});
