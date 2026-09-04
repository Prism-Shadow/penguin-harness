/**
 * Protocol-path suffix for the base URL field (pure mapping): which path the AgentHub
 * client appends to a custom base URL, keyed off (provider, clientType). The expected
 * paths mirror the vendored agenthub clients: Anthropic direct posts /v1/messages,
 * OpenAI, MiniMax and DeepSeek direct use a Responses API (/responses), Google direct hits
 * /v1beta/models/<id>:…, and every OpenAI-compatible client posts /chat/completions.
 */
import { describe, expect, it } from "vitest";
import { protocolPathForModel } from "../src/features/models/protocol-path";

describe("protocolPathForModel", () => {
  it("first-party vendor groups (auto-routed, no client type) map to their official protocol path", () => {
    expect(protocolPathForModel("anthropic", "")).toBe("/v1/messages");
    expect(protocolPathForModel("openai", "")).toBe("/responses");
    expect(protocolPathForModel("google", "")).toBe("/v1beta/models");
    expect(protocolPathForModel("minimax", "")).toBe("/responses");
    expect(protocolPathForModel("deepseek", "")).toBe("/responses");
  });

  it("the MiniMax M3 client speaks MiniMax's Responses API, not chat completions", () => {
    expect(protocolPathForModel("minimax", "minimax-m3")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "minimax-m3")).toBe("/responses");
  });

  it("the DeepSeek V4 client speaks DeepSeek's Responses API (agenthub 0.4.6)", () => {
    // Until 0.4.6 this client posted /chat/completions; the vendored client now posts
    // /responses, and the hint has to name the endpoint shape a custom base URL must serve.
    expect(protocolPathForModel("deepseek", "deepseek-v4")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "deepseek-v4")).toBe("/responses");
  });

  it("the remaining direct vendors speak chat completions", () => {
    expect(protocolPathForModel("zhipu", "")).toBe("/chat/completions");
    expect(protocolPathForModel("moonshot", "")).toBe("/chat/completions");
  });

  it("gateway groups always carry client_type openai-chat and get /chat/completions", () => {
    for (const provider of [
      "openrouter",
      "fireworks",
      "siliconflow",
      "tokendance",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
    ]) {
      expect(protocolPathForModel(provider, "openai-chat")).toBe("/chat/completions");
    }
  });

  it("custom and user-defined groups get /chat/completions (with or without the explicit client type)", () => {
    expect(protocolPathForModel("custom", "openai-chat")).toBe("/chat/completions");
    // The deprecated bare "openai" alias (configs saved before AgentHub 0.4.2) means the same client.
    expect(protocolPathForModel("custom", "openai")).toBe("/chat/completions");
    // Legacy TOML entries in a user-defined group may lack client_type; the group still means the OpenAI protocol.
    expect(protocolPathForModel("myproxy", "")).toBe("/chat/completions");
  });

  it("openai-chat-vllm-adapter is chat completions, whatever the model id looks like", () => {
    // It contains "openai" and reaches the same branch, which is the right answer: the vLLM
    // client subclasses openai-chat and POSTs the same path. The DeepSeek id is the one that
    // would go wrong if the group implied the path — the vendor's own client uses /responses.
    expect(protocolPathForModel("vllm", "openai-chat-vllm-adapter")).toBe("/chat/completions");
    expect(protocolPathForModel("custom", "openai-chat-vllm-adapter")).toBe("/chat/completions");
  });

  it("an explicit openai-chat client type wins over vendor-group membership", () => {
    expect(protocolPathForModel("anthropic", "openai-chat")).toBe("/chat/completions");
    expect(protocolPathForModel("google", "openai-chat")).toBe("/chat/completions");
    // The gateway rows reselling DeepSeek pin openai-chat, so they stay on chat completions
    // even though the vendor's own client moved to /responses.
    expect(protocolPathForModel("siliconflow", "openai-chat")).toBe("/chat/completions");
  });

  it("the generic protocol clients (agenthub 0.4.2) map to their own endpoint shapes", () => {
    // openai-responses contains "openai" but speaks the Responses API; ant-messages speaks
    // the Anthropic Messages API — both must win over the generic openai substring match.
    expect(protocolPathForModel("custom", "openai-responses")).toBe("/responses");
    expect(protocolPathForModel("custom", "ant-messages")).toBe("/v1/messages");
    expect(protocolPathForModel("deepseek", "openai-responses")).toBe("/responses");
    expect(protocolPathForModel("myproxy", " Ant-Messages ")).toBe("/v1/messages");
    // The built-in OpenRouter openai/* presets pin openai-responses, so the gateway's base
    // URL must be hinted with /responses rather than the group's usual /chat/completions.
    expect(protocolPathForModel("openrouter", "openai-responses")).toBe("/responses");
  });

  it("legacy explicit client types pin the family like auto-routing would", () => {
    expect(protocolPathForModel("myproxy", "claude-5")).toBe("/v1/messages");
    expect(protocolPathForModel("myproxy", "claude-4-6")).toBe("/v1/messages");
    expect(protocolPathForModel("myproxy", "gemini-3.6")).toBe("/v1beta/models");
    expect(protocolPathForModel("myproxy", "gpt-5.5")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "glm-5.2")).toBe("/chat/completions");
    expect(protocolPathForModel("myproxy", "kimi-k3")).toBe("/chat/completions");
  });

  it("client type matching is trim- and case-insensitive", () => {
    expect(protocolPathForModel("custom", " OpenAI ")).toBe("/chat/completions");
    expect(protocolPathForModel("anthropic", " Claude-5 ")).toBe("/v1/messages");
  });
});
