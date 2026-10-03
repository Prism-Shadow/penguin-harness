/**
 * Protocol-path suffix for the base URL field (pure mapping): which path the MMSP client
 * appends to a custom base URL, keyed off (provider, clientType, modelId). The expected paths
 * mirror the MMSP 0.5.0 clients: the Anthropic Messages clients post /v1/messages; OpenAI's,
 * DeepSeek's and MiniMax's official clients and the compatible Responses client use a
 * Responses API (/responses); OpenAI's embedding ids and the compatible embedding client post
 * /embeddings; Google's official client speaks the Interactions API (/v1beta/interactions) and
 * the generateContent client /v1beta/models/<id>:…; and every Chat Completions client posts
 * /chat/completions.
 */
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "@prismshadow/penguin-core/model-catalog";
import { protocolPathForModel } from "../src/features/models/protocol-path";

describe("protocolPathForModel", () => {
  it("first-party vendor groups (no client type) map to their official client's path before an id is typed", () => {
    expect(protocolPathForModel("anthropic", "")).toBe("/v1/messages");
    expect(protocolPathForModel("openai", "")).toBe("/responses");
    expect(protocolPathForModel("google", "")).toBe("/v1beta/interactions");
    expect(protocolPathForModel("minimax", "")).toBe("/responses");
    expect(protocolPathForModel("deepseek", "")).toBe("/responses");
  });

  it("an unpinned id routes by the vendor family it begins with, as MMSP routes it", () => {
    expect(protocolPathForModel("anthropic", "", "claude-opus-5")).toBe("/v1/messages");
    expect(protocolPathForModel("openai", "", "gpt-5.6")).toBe("/responses");
    expect(protocolPathForModel("google", "", "gemini-3.8-flash")).toBe("/v1beta/interactions");
    expect(protocolPathForModel("minimax", "", "MiniMax-M3")).toBe("/responses");
    expect(protocolPathForModel("deepseek", "", "deepseek-flash")).toBe("/responses");
    expect(protocolPathForModel("zhipu", "", "glm-5.3")).toBe("/chat/completions");
    expect(protocolPathForModel("moonshot", "", "kimi-k3")).toBe("/chat/completions");
    // The id decides, not the group: a gpt- id reaches OpenAI's client wherever it sits.
    expect(protocolPathForModel("anthropic", "", "gpt-5.6")).toBe("/responses");
    // An id of no known family routes nowhere, so the group's own client stands in.
    expect(protocolPathForModel("deepseek", "", "qwen/qwen3.8-flash-next")).toBe("/responses");
  });

  it("OpenAI's embedding ids go to the Embeddings API, like the compatible embedding client", () => {
    expect(protocolPathForModel("openai", "", "text-embedding-3-small")).toBe("/embeddings");
    expect(protocolPathForModel("custom", "openai-embedding")).toBe("/embeddings");
  });

  it("each official client pinned explicitly maps to its own path", () => {
    expect(protocolPathForModel("myproxy", "openai-official")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "anthropic-official")).toBe("/v1/messages");
    expect(protocolPathForModel("myproxy", "gemini-official")).toBe("/v1beta/interactions");
    expect(protocolPathForModel("myproxy", "deepseek-official")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "minimax-official")).toBe("/responses");
    expect(protocolPathForModel("myproxy", "zai-official")).toBe("/chat/completions");
    expect(protocolPathForModel("myproxy", "moonshot-official")).toBe("/chat/completions");
  });

  it("Penguin Go's pins: the Gemini rows speak generateContent, the DeepSeek rows DeepSeek's Responses API", () => {
    const rows = MODEL_CATALOG.filter((m) => m.provider === "penguin-go");
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) {
      expect(protocolPathForModel(m.provider, m.clientType ?? "", m.modelId), m.modelId).toBe(
        m.modelId.startsWith("gemini-") ? "/v1beta/models" : "/responses",
      );
    }
  });

  it("ModelScope aggregate presets display the Responses path", () => {
    expect(protocolPathForModel("modelscope", "openai-responses")).toBe("/responses");
  });

  it("the remaining direct vendors speak chat completions", () => {
    expect(protocolPathForModel("zhipu", "")).toBe("/chat/completions");
    expect(protocolPathForModel("moonshot", "")).toBe("/chat/completions");
  });

  it("the gateway groups that pin openai-chat get /chat/completions", () => {
    // OpenRouter is the one gateway missing here: it pins openai-responses on every row, and
    // the Responses case below covers it.
    for (const provider of [
      "fireworks",
      "siliconflow",
      "atlascloud",
      "tokendance",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
    ]) {
      expect(protocolPathForModel(provider, "openai-chat")).toBe("/chat/completions");
    }
  });

  it("OpenCode Go rows: preset base URL plus the hinted path is the endpoint OpenCode documents", () => {
    // The group mixes three protocols, and its Messages rows use a base without /v1 because the
    // Anthropic SDK appends /v1/messages. Joined with the path the dialog shows, every row lands
    // on one of the three endpoints in the Go docs page's endpoint table.
    const endpoints = new Set([
      "https://opencode.ai/zen/go/v1/chat/completions",
      "https://opencode.ai/zen/go/v1/responses",
      "https://opencode.ai/zen/go/v1/messages",
    ]);
    const rows = MODEL_CATALOG.filter((m) => m.provider === "opencode-go");
    expect(rows).toHaveLength(27);
    const hit = new Set<string>();
    for (const m of rows) {
      const url = `${m.baseUrl}${protocolPathForModel(m.provider, m.clientType ?? "", m.modelId)}`;
      expect(endpoints.has(url), `${m.modelId} -> ${url}`).toBe(true);
      hit.add(url);
    }
    expect(hit).toEqual(endpoints);
  });

  it("custom and user-defined groups get /chat/completions (with or without the explicit client type)", () => {
    expect(protocolPathForModel("custom", "openai-chat")).toBe("/chat/completions");
    // The deprecated bare "openai" alias (configs saved before AgentHub 0.4.2) means the same client.
    expect(protocolPathForModel("custom", "openai")).toBe("/chat/completions");
    // Legacy TOML entries in a user-defined group may lack client_type; the group still means the OpenAI protocol.
    expect(protocolPathForModel("myproxy", "")).toBe("/chat/completions");
  });

  it("openai-chat-vllm-adapter is chat completions, whatever the model id looks like", () => {
    // The vLLM client subclasses openai-chat and POSTs the same path. The DeepSeek id is the
    // one that would go wrong if the id decided: unpinned, it begins with "deepseek-" and would
    // route to DeepSeek's official client, which uses /responses.
    expect(protocolPathForModel("vllm", "openai-chat-vllm-adapter")).toBe("/chat/completions");
    expect(protocolPathForModel("custom", "openai-chat-vllm-adapter")).toBe("/chat/completions");
    expect(
      protocolPathForModel("vllm", "openai-chat-vllm-adapter", "deepseek-ai/DeepSeek-V4-Flash"),
    ).toBe("/chat/completions");
  });

  it("an explicit openai-chat client type wins over vendor-group membership and the id", () => {
    expect(protocolPathForModel("anthropic", "openai-chat")).toBe("/chat/completions");
    expect(protocolPathForModel("google", "openai-chat", "gemini-3.8-flash")).toBe(
      "/chat/completions",
    );
    // The gateway rows reselling DeepSeek pin openai-chat, so they stay on chat completions
    // even though the vendor's own client uses /responses.
    expect(protocolPathForModel("siliconflow", "openai-chat", "deepseek-ai/DeepSeek-V4-Pro")).toBe(
      "/chat/completions",
    );
  });

  it("the compatible protocol clients map to their own endpoint shapes", () => {
    expect(protocolPathForModel("custom", "openai-responses")).toBe("/responses");
    expect(protocolPathForModel("custom", "ant-messages")).toBe("/v1/messages");
    expect(protocolPathForModel("custom", "google-genai")).toBe("/v1beta/models");
    expect(protocolPathForModel("custom", "gemini-generate-content")).toBe("/v1beta/models");
    expect(protocolPathForModel("deepseek", "openai-responses")).toBe("/responses");
    expect(protocolPathForModel("myproxy", " Ant-Messages ")).toBe("/v1/messages");
    // Every built-in OpenRouter preset pins openai-responses, so the gateway's base URL is
    // hinted with /responses rather than the /chat/completions the other gateways get.
    expect(protocolPathForModel("openrouter", "openai-responses")).toBe("/responses");
  });

  it("a pinned client type MMSP does not know falls back to the group's path, never to the id's family", () => {
    // Pre-0.5.0 vendor names are no client type MMSP has: it refuses them rather than routing
    // the id, so the hint follows the group.
    expect(protocolPathForModel("myproxy", "claude-5")).toBe("/chat/completions");
    expect(protocolPathForModel("myproxy", "gpt-5.5", "gpt-5.5")).toBe("/chat/completions");
    expect(protocolPathForModel("deepseek", "deepseek-v4", "deepseek-flash")).toBe("/responses");
  });

  it("client type and model id matching is trim- and case-insensitive", () => {
    expect(protocolPathForModel("custom", " OpenAI ")).toBe("/chat/completions");
    expect(protocolPathForModel("custom", " OPENAI-RESPONSES ")).toBe("/responses");
    expect(protocolPathForModel("openai", "", " TEXT-EMBEDDING-3-LARGE ")).toBe("/embeddings");
    expect(protocolPathForModel("google", "", " Gemini-3.8-Flash ")).toBe("/v1beta/interactions");
  });
});
