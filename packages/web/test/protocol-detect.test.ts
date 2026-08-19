/**
 * Custom-model protocol detection UI logic: the generic protocol client-type family
 * (selector visibility / value mapping), when saving must detect first, what the failure
 * popup explains, the guarantee that no entry is persisted without a protocol, and the
 * protocol-path suffix for the new client types. The probing itself is server-side (see
 * the server package's protocol-detect tests); these are the pure helpers the dialog
 * composes.
 */
import { describe, expect, it } from "vitest";
import { clientTypeAfterProviderChange, rowToEntry } from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";
import {
  PROTOCOL_CLIENT_TYPES,
  classifyDetectFailure,
  detectableBaseUrl,
  isCustomLikeGroup,
  isGenericProtocolClientType,
  needsProtocolDetectOnSave,
  protocolForPersist,
  protocolSelectorValue,
} from "../src/features/models/protocol-types";
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

  it("still pins vendor-specific or empty types to openai-chat when moving to Custom, and never touches other groups", () => {
    expect(clientTypeAfterProviderChange("custom", "")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("custom", "claude-5")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("google", "openai")).toBe("openai");
    expect(clientTypeAfterProviderChange("my-group", "ant-messages")).toBe("ant-messages");
  });
});

describe("isCustomLikeGroup", () => {
  it("covers custom and every unknown (user-defined) group, but no catalog vendor group", () => {
    expect(isCustomLikeGroup("custom")).toBe(true);
    expect(isCustomLikeGroup("my-group")).toBe(true);
    expect(isCustomLikeGroup("openai")).toBe(false);
    expect(isCustomLikeGroup("anthropic")).toBe(false);
  });
});

describe("needsProtocolDetectOnSave (save detects a still-unset protocol first)", () => {
  it("fires for saving a custom-like entry with no protocol yet", () => {
    expect(needsProtocolDetectOnSave("save", "custom", "")).toBe(true);
    expect(needsProtocolDetectOnSave("save", "my-group", "   ")).toBe(true);
  });

  it("does not fire once a protocol is chosen", () => {
    expect(needsProtocolDetectOnSave("save", "custom", "ant-messages")).toBe(false);
    expect(needsProtocolDetectOnSave("save", "custom", "openai-chat")).toBe(false);
  });

  it("never probes for vendor groups, nor for actions other than save", () => {
    // A vendor group auto-routes by model id; an empty protocol there is correct.
    expect(needsProtocolDetectOnSave("save", "openai", "")).toBe(false);
    expect(needsProtocolDetectOnSave("remove", "custom", "")).toBe(false);
    expect(needsProtocolDetectOnSave("setDefault", "custom", "")).toBe(false);
    expect(needsProtocolDetectOnSave("setVisionModel", "custom", "")).toBe(false);
  });
});

describe("protocolForPersist (an empty protocol must never reach the config)", () => {
  it("falls back to openai-chat for a custom-like entry that still has none", () => {
    // AutoLLMClient THROWS on an unmatched client type, so persisting "" would save a
    // model that cannot start.
    expect(protocolForPersist("custom", "")).toBe("openai-chat");
    expect(protocolForPersist("my-group", "   ")).toBe("openai-chat");
  });

  it("keeps an explicit protocol exactly as chosen", () => {
    expect(protocolForPersist("custom", "ant-messages")).toBe("ant-messages");
    expect(protocolForPersist("custom", "openai-responses")).toBe("openai-responses");
    expect(protocolForPersist("my-group", " openai-chat ")).toBe("openai-chat");
  });

  it("leaves preset / vendor groups empty so AgentHub still infers from the model id", () => {
    expect(protocolForPersist("openai", "")).toBe("");
    expect(protocolForPersist("anthropic", "")).toBe("");
    expect(protocolForPersist("google", "")).toBe("");
  });
});

describe("rowToEntry (the persistence funnel)", () => {
  const row = (over: Partial<RowState>): RowState => ({
    provider: "custom",
    modelId: "my-model",
    original: null,
    vision: true,
    contextWindow: "",
    maxTokens: "",
    clientType: "",
    cacheRead: "",
    cacheWrite: "",
    output: "",
    baseUrl: "",
    originalBaseUrl: "",
    apiKeyInput: "",
    clearApiKey: false,
    ...over,
  });

  it("never writes a custom entry without a protocol, even when the form left it empty", () => {
    expect(rowToEntry(row({})).clientType).toBe("openai-chat");
    expect(rowToEntry(row({ provider: "my-group" })).clientType).toBe("openai-chat");
  });

  it("writes the chosen protocol verbatim", () => {
    expect(rowToEntry(row({ clientType: "ant-messages" })).clientType).toBe("ant-messages");
  });

  it("omits clientType for a vendor group so AgentHub keeps inferring it", () => {
    expect(rowToEntry(row({ provider: "openai", modelId: "gpt-5.6" })).clientType).toBeUndefined();
  });
});

describe("classifyDetectFailure (which explanation the popup shows)", () => {
  it("calls it unreachable only when every probe failed to connect", () => {
    expect(
      classifyDetectFailure([
        { outcome: "network_error" },
        { outcome: "timeout" },
        { outcome: "network_error" },
      ]),
    ).toBe("unreachable");
  });

  it("says none matched when the endpoint answered at all", () => {
    // A reachable endpoint that simply serves none of the three paths.
    expect(
      classifyDetectFailure([
        { outcome: "route_missing" },
        { outcome: "route_missing" },
        { outcome: "junk" },
      ]),
    ).toBe("none");
    // Mixed: one probe connected, so the address itself is fine.
    expect(classifyDetectFailure([{ outcome: "timeout" }, { outcome: "route_missing" }])).toBe(
      "none",
    );
    expect(classifyDetectFailure([])).toBe("none");
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
