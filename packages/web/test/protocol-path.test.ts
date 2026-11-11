/**
 * The path hint inside a model's base URL field (features/models/protocol-path.ts): the path the
 * MMSP client that will serve the entry appends to a custom base URL, so the user knows which
 * endpoint shape the URL must serve.
 *
 * - Given a client type pinned on the entry, it decides, over the group and the model id.
 * - Given none pinned, the model id's vendor family decides, wherever the entry sits.
 * - Given a blank id, or one of no known family, the group's own vendor client decides.
 * - Given a pinned client type MMSP does not know, the group decides, never the id's family.
 * - Given a group with no client of its own and nothing pinned, the hint is Chat Completions.
 * - Given a client type stored under an older spelling, the hint is the client it names.
 * - Client types and ids match whatever their case and the spaces around them.
 */
import { describe, expect, it } from "vitest";
import { protocolPathForModel } from "../src/features/models/protocol-path";

describe("protocolPathForModel", () => {
  it("lets a pinned client type decide over the group and the id", () => {
    expect(protocolPathForModel("anthropic", "")).toBe("/v1/messages");
    expect(protocolPathForModel("anthropic", "openai-chat")).toBe("/chat/completions");
    expect(protocolPathForModel("google", "openai-chat", "gemini-3.8-flash")).toBe(
      "/chat/completions",
    );
    // Unpinned, this id begins with "deepseek-" and would route to DeepSeek's own client.
    expect(
      protocolPathForModel("vllm", "openai-chat-vllm-adapter", "deepseek-ai/DeepSeek-V4-Flash"),
    ).toBe("/chat/completions");
    expect(protocolPathForModel("my-group", "mmsp", "gpt-5.6")).toBe("/stream");
  });

  it("routes an unpinned id by the vendor family it begins with, as MMSP routes it", () => {
    expect(protocolPathForModel("anthropic", "", "gpt-5.6")).toBe("/responses");
    expect(protocolPathForModel("openai", "", "gpt-5.6")).toBe("/responses");
    expect(protocolPathForModel("openai", "", "text-embedding-3-small")).toBe("/embeddings");
  });

  it("falls back to the group's own client for a blank id or one of no known family", () => {
    expect(protocolPathForModel("google", "")).toBe("/v1beta/interactions");
    expect(protocolPathForModel("deepseek", "", "qwen/qwen3.8-flash-next")).toBe("/responses");
  });

  it("follows the group, never the id's family, for a pinned client type MMSP does not know", () => {
    // Pre-0.5.0 vendor names are no client type MMSP has: it refuses them rather than routing
    // the id, so the hint follows the group.
    expect(protocolPathForModel("myproxy", "gpt-5.5", "gpt-5.5")).toBe("/chat/completions");
    expect(protocolPathForModel("anthropic", "claude-5", "gpt-5.6")).toBe("/v1/messages");
  });

  it("hints Chat Completions for a group with no client of its own", () => {
    // Legacy TOML entries in a user-defined group may lack client_type.
    expect(protocolPathForModel("myproxy", "")).toBe("/chat/completions");
  });

  it("reads a client type's older spelling as the client it names", () => {
    // The bare "openai" (configs saved before AgentHub 0.4.2) and the Google names before
    // MMSP 0.5.2, which a stored row may still carry.
    expect(protocolPathForModel("custom", "openai")).toBe(
      protocolPathForModel("custom", "openai-chat"),
    );
    expect(protocolPathForModel("myproxy", "gemini-official")).toBe(
      protocolPathForModel("myproxy", "google-official"),
    );
    expect(protocolPathForModel("custom", "gemini-generate-content")).toBe(
      protocolPathForModel("custom", "google-genai"),
    );
  });

  it("matches client types and ids whatever their case and the spaces around them", () => {
    expect(protocolPathForModel("myproxy", " Ant-Messages ")).toBe("/v1/messages");
    expect(protocolPathForModel("custom", " OPENAI-RESPONSES ")).toBe("/responses");
    expect(protocolPathForModel("openai", "", " TEXT-EMBEDDING-3-LARGE ")).toBe("/embeddings");
  });
});
