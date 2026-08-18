/**
 * Protocol-path suffix for the base URL field (pure mapping): which path the AgentHub
 * client appends to a custom base URL, keyed off (provider, clientType). The expected
 * paths mirror the vendored agenthub clients: Anthropic direct posts /v1/messages,
 * OpenAI and MiniMax direct use a Responses API (/responses), Google direct hits
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
  });

  it("the MiniMax M3 client speaks MiniMax's Responses API, not chat completions", () => {
    expect(protocolPathForModel("minimax", "minimax-m3")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "minimax-m3")).toBe("/responses");
  });

  it("the remaining direct vendors speak chat completions", () => {
    expect(protocolPathForModel("deepseek", "")).toBe("/chat/completions");
    expect(protocolPathForModel("zhipu", "")).toBe("/chat/completions");
    expect(protocolPathForModel("moonshot", "")).toBe("/chat/completions");
  });

  it("gateway groups always carry client_type openai and get /chat/completions", () => {
    for (const provider of [
      "openrouter",
      "fireworks",
      "siliconflow",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
    ]) {
      expect(protocolPathForModel(provider, "openai")).toBe("/chat/completions");
    }
  });

  it("custom and user-defined groups get /chat/completions (with or without the explicit client type)", () => {
    expect(protocolPathForModel("custom", "openai")).toBe("/chat/completions");
    // Legacy TOML entries in a user-defined group may lack client_type; the group still means the OpenAI protocol.
    expect(protocolPathForModel("myproxy", "")).toBe("/chat/completions");
  });

  it("an explicit openai client type wins over vendor-group membership", () => {
    expect(protocolPathForModel("anthropic", "openai")).toBe("/chat/completions");
    expect(protocolPathForModel("google", "openai")).toBe("/chat/completions");
  });

  it("legacy explicit client types pin the family like auto-routing would", () => {
    expect(protocolPathForModel("myproxy", "claude-5")).toBe("/v1/messages");
    expect(protocolPathForModel("myproxy", "claude-4-6")).toBe("/v1/messages");
    expect(protocolPathForModel("myproxy", "gemini-3.6")).toBe("/v1beta/models");
    expect(protocolPathForModel("myproxy", "gpt-5.5")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "deepseek-v4")).toBe("/chat/completions");
    expect(protocolPathForModel("myproxy", "glm-5.2")).toBe("/chat/completions");
    expect(protocolPathForModel("myproxy", "kimi-k3")).toBe("/chat/completions");
  });

  it("client type matching is trim- and case-insensitive", () => {
    expect(protocolPathForModel("custom", " OpenAI ")).toBe("/chat/completions");
    expect(protocolPathForModel("anthropic", " Claude-5 ")).toBe("/v1/messages");
  });
});
