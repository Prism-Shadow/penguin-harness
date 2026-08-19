/**
 * Custom-model protocol detection UI logic: the generic protocol client-type family
 * (selector visibility / value mapping), when saving must detect first, what the failure
 * popup explains, the guarantee that no entry is persisted without a protocol, and the
 * protocol-path suffix for the new client types. The probing itself is server-side (see
 * the server package's protocol-detect tests); these are the pure helpers the dialog
 * composes.
 */
import { describe, expect, it } from "vitest";
import { resolveModelEnv } from "@prismshadow/penguin-core/model-catalog";
import { zh as ZH } from "../src/lib/strings";
import { en as EN } from "../src/lib/strings-en";
import { clientTypeAfterProviderChange, rowToEntry } from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";
import {
  PROTOCOL_CLIENT_TYPES,
  detectableBaseUrl,
  displayWidthCh,
  envHintClientType,
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
  it("maps openai / unknown to openai-chat for display without rewriting the stored value", () => {
    expect(protocolSelectorValue("openai-responses")).toBe("openai-responses");
    expect(protocolSelectorValue("ant-messages")).toBe("ant-messages");
    expect(protocolSelectorValue("openai-chat")).toBe("openai-chat");
    expect(protocolSelectorValue("openai")).toBe("openai-chat");
  });

  it("reports NOTHING selected for an unset protocol, so the control cannot imply a default", () => {
    // A fresh custom model: no checked row in the menu, no path in the field. Returning
    // "openai-chat" here (as it once did) rendered a choice the user never made.
    expect(protocolSelectorValue("")).toBeNull();
    expect(protocolSelectorValue("   ")).toBeNull();
  });
});

describe("displayWidthCh (padding reserved for the in-field suffix)", () => {
  it("counts ASCII as one column, so the protocol paths reserve exactly their length", () => {
    expect(displayWidthCh("/chat/completions")).toBe(17);
    expect(displayWidthCh("/responses")).toBe(10);
    expect(displayWidthCh("Select protocol")).toBe(15);
  });

  it("counts CJK as two, so a localized placeholder is not under-reserved by half", () => {
    expect(displayWidthCh("选择协议")).toBe(8);
    expect(displayWidthCh("")).toBe(0);
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

describe("envHintClientType (custom groups never infer a client from the model id)", () => {
  const envFor = (provider: string, modelId: string, clientType: string) =>
    resolveModelEnv(modelId, envHintClientType(provider, clientType))?.envKey;

  it("keeps a vendor-looking model id in a custom group on the compatible client's env var", () => {
    // The bug this pins: `claude-sonnet-5` typed into a custom group used to resolve to
    // ANTHROPIC_API_KEY, implying an Anthropic client that group never routes to.
    expect(envFor("custom", "claude-sonnet-5", "")).toBe("OPENAI_API_KEY");
    expect(envFor("custom", "gpt-5.6", "")).toBe("OPENAI_API_KEY");
    expect(envFor("my-group", "claude-sonnet-5", "")).toBe("OPENAI_API_KEY");
  });

  it("still honours a protocol the user actually chose", () => {
    expect(envFor("custom", "whatever", "ant-messages")).toBe("ANTHROPIC_API_KEY");
    expect(envFor("custom", "whatever", "openai-responses")).toBe("OPENAI_API_KEY");
  });

  it("leaves vendor groups routing by model id, which is how they really work", () => {
    expect(envHintClientType("anthropic", "")).toBeUndefined();
    expect(envFor("anthropic", "claude-sonnet-5", "")).toBe("ANTHROPIC_API_KEY");
    expect(envFor("google", "gemini-3.1-pro", "")).toBe("GEMINI_API_KEY");
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
    fastMode: false,
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

describe("detection copy", () => {
  it("has exactly one user-facing failure message, in both locales", () => {
    // Every failure mode collapses to this: the maintainer's point is that a user cannot
    // act on "the endpoint responded but serves no protocol", only on the key and the URL.
    for (const catalog of [EN.models, ZH.models] as const) {
      expect(catalog.detectFailedBody).toBeTruthy();
      // No protocol names to parse, and no "pick one manually" instruction.
      expect(catalog.detectFailedBody).not.toContain("OpenAI Responses");
      expect(catalog.detectFailedBody).not.toContain("Anthropic Messages");
    }
    // The distinguishing strings are gone, not merely unused.
    expect("detectNone" in EN.models).toBe(false);
    expect("detectUnreachable" in EN.models).toBe(false);
    expect("detectNone" in ZH.models).toBe(false);
    expect("detectUnreachable" in ZH.models).toBe(false);
  });

  it("names the unset protocol as a placeholder rather than a protocol", () => {
    for (const catalog of [EN.models, ZH.models] as const) {
      expect(catalog.protocolUnset).toBeTruthy();
      expect(Object.values(catalog.protocolNames)).not.toContain(catalog.protocolUnset);
    }
  });

  it("carries no dialog-era copy: both outcomes are toasts, so no popup titles remain", () => {
    // The verdict used to be a blocking AlertModal (which needed an accessible name) and,
    // before that, a line rendered under the base URL field. Both are gone: a detection
    // result is transient and must occupy no space in the form.
    for (const catalog of [EN.models, ZH.models] as const) {
      expect("detectOkTitle" in catalog).toBe(false);
      expect("detectFailedTitle" in catalog).toBe(false);
    }
  });

  it("keeps both toast messages to a single short line", () => {
    for (const catalog of [EN.models, ZH.models] as const) {
      const success = catalog.detectedProtocol("OpenAI Responses");
      for (const text of [success, catalog.detectFailedBody]) {
        expect(text.length).toBeLessThanOrEqual(80);
        expect(text).not.toContain("\n");
      }
    }
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
