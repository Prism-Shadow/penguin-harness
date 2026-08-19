/**
 * Custom-model protocol detection UI logic: the generic protocol client-type family
 * (selector visibility / value mapping / base-URL probe gating) and the protocol-path
 * suffix for the new client types. The probing itself is server-side (see the server
 * package's protocol-detect tests); these are the pure helpers the dialog composes.
 */
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_CLIENT_TYPES,
  clientTypeAfterProviderChange,
  detectableBaseUrl,
  isGenericProtocolClientType,
  protocolSelectorValue,
} from "../src/features/models/models-page";
import { protocolPathForModel } from "../src/features/models/protocol-path";

describe("PROTOCOL_CLIENT_TYPES", () => {
  it("lists the three generic clients in the required detection order (responses first, chat completions last)", () => {
    expect(PROTOCOL_CLIENT_TYPES).toEqual(["openai-responses", "ant-messages", "openai-chat"]);
  });
});

describe("isGenericProtocolClientType", () => {
  it("accepts the protocol trio, the bare openai alias, and empty; rejects vendor-pinned types", () => {
    expect(isGenericProtocolClientType("openai-responses")).toBe(true);
    expect(isGenericProtocolClientType("ant-messages")).toBe(true);
    expect(isGenericProtocolClientType("openai-chat")).toBe(true);
    expect(isGenericProtocolClientType("openai")).toBe(true);
    expect(isGenericProtocolClientType("")).toBe(true);
    expect(isGenericProtocolClientType(" OpenAI-Responses ")).toBe(true);
    expect(isGenericProtocolClientType("deepseek-v4")).toBe(false);
    expect(isGenericProtocolClientType("claude-4-8")).toBe(false);
    expect(isGenericProtocolClientType("minimax-m3")).toBe(false);
  });
});

describe("protocolSelectorValue", () => {
  it("maps openai / empty / unknown to openai-chat for display without rewriting the stored value", () => {
    expect(protocolSelectorValue("openai-responses")).toBe("openai-responses");
    expect(protocolSelectorValue("ant-messages")).toBe("ant-messages");
    expect(protocolSelectorValue("openai-chat")).toBe("openai-chat");
    expect(protocolSelectorValue("openai")).toBe("openai-chat");
    expect(protocolSelectorValue("")).toBe("openai-chat");
  });
});

describe("detectableBaseUrl", () => {
  it("only absolute http(s) URLs are probeable (mirrors the server-side validation)", () => {
    expect(detectableBaseUrl("https://api.example.com/v1")).toBe(true);
    expect(detectableBaseUrl(" http://127.0.0.1:8000/v1 ")).toBe(true);
    expect(detectableBaseUrl("api.example.com/v1")).toBe(false);
    expect(detectableBaseUrl("ftp://example.com")).toBe(false);
    expect(detectableBaseUrl("")).toBe(false);
    expect(detectableBaseUrl("https://")).toBe(false);
  });
});

describe("clientTypeAfterProviderChange (protocol family kept on move to Custom)", () => {
  it("keeps generic protocol client types when moving to Custom", () => {
    expect(clientTypeAfterProviderChange("custom", "openai-responses")).toBe("openai-responses");
    expect(clientTypeAfterProviderChange("custom", "ant-messages")).toBe("ant-messages");
    expect(clientTypeAfterProviderChange("custom", "openai-chat")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("custom", "openai")).toBe("openai");
  });

  it("still pins vendor-specific or empty types to openai when moving to Custom, and never touches other groups", () => {
    expect(clientTypeAfterProviderChange("custom", "")).toBe("openai");
    expect(clientTypeAfterProviderChange("custom", "claude-5")).toBe("openai");
    expect(clientTypeAfterProviderChange("google", "openai")).toBe("openai");
    expect(clientTypeAfterProviderChange("my-group", "ant-messages")).toBe("ant-messages");
  });
});

describe("protocolPathForModel (generic protocol client types)", () => {
  it("maps each protocol client to the path its AgentHub client appends", () => {
    expect(protocolPathForModel("custom", "openai-responses")).toBe("/responses");
    expect(protocolPathForModel("custom", "ant-messages")).toBe("/v1/messages");
    expect(protocolPathForModel("custom", "openai-chat")).toBe("/chat/completions");
    // The bare alias and user-defined groups behave the same as before.
    expect(protocolPathForModel("my-group", "openai")).toBe("/chat/completions");
  });

  it("keeps the legacy explicit-type and group fallbacks intact", () => {
    expect(protocolPathForModel("custom", "claude-4-8")).toBe("/v1/messages");
    expect(protocolPathForModel("openai", "")).toBe("/responses");
    expect(protocolPathForModel("anthropic", "")).toBe("/v1/messages");
    expect(protocolPathForModel("custom", "")).toBe("/chat/completions");
  });
});
