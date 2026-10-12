/**
 * Custom-model protocol detection UI logic: the protocols the picker offers (the three
 * detection probes, then Google GenAI and MMSP, each shown checked with its path and name once
 * stored, older spellings as the protocol they name), selector visibility and value mapping,
 * when saving must detect first — only when nothing,
 * not even the group, decides the protocol — what the failure popup explains, the guarantee
 * that no entry is persisted without a protocol while a blank one that follows its group
 * stays blank, and the protocol-path suffix for the new client types. A group decides only
 * through its `[providers.<id>]` table (a new Project writes the catalog's there); the catalog
 * itself is never consulted. The probing itself is server-side (see the server package's
 * protocol-detect tests); these are the pure helpers the dialog composes.
 */
import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG,
  modelEnvPreviewKey,
  presetProviderTable,
  resolveModelEnv,
} from "@prismshadow/penguin-core/model-catalog";
import type { ProviderConnectionShape } from "@prismshadow/penguin-core/model-catalog";
import { zh as ZH } from "../src/lib/strings";
import { en as EN } from "../src/lib/strings-en";
import { clientTypeAfterProviderChange, rowToEntry } from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";
import {
  PROTOCOL_CLIENT_TYPES,
  detectableBaseUrl,
  displayWidthCh,
  envHintClientType,
  envHintKeyFor,
  isCustomLikeGroup,
  isGenericProtocolClientType,
  needsProtocolDetectOnSave,
  protocolForPersist,
  protocolSelectorValue,
} from "../src/features/models/protocol-types";
import { protocolPathForModel } from "../src/features/models/protocol-path";

/** The group table a new Project writes for a built-in group, in the resolver's shape. */
function presetGroup(id: string): ProviderConnectionShape {
  const table = presetProviderTable()[id] ?? {};
  return { baseUrl: table.base_url, clientType: table.client_type };
}

describe("the protocols the picker offers", () => {
  // The three the server's detection probes come first, in its order; Google GenAI and MMSP
  // follow, picked by hand only.
  const OFFERED: Array<[string, string]> = [
    ["openai-responses", "/responses"],
    ["ant-messages", "/v1/messages"],
    ["openai-chat", "/chat/completions"],
    ["google-genai", "/v1beta/models"],
    ["mmsp", "/stream"],
  ];

  it("offers the detectable three first, then Google GenAI and MMSP", () => {
    expect([...PROTOCOL_CLIENT_TYPES]).toEqual(OFFERED.map(([t]) => t));
  });

  it.each(OFFERED)(
    "%s round-trips: stored, it is shown checked with the path its client appends and a name in both languages",
    (clientType, path) => {
      expect(isGenericProtocolClientType(clientType)).toBe(true);
      expect(protocolSelectorValue(clientType)).toBe(clientType);
      expect(protocolPathForModel("custom", clientType)).toBe(path);
      expect(EN.models.protocolNames[clientType]).toBeTruthy();
      expect(ZH.models.protocolNames[clientType]).toBeTruthy();
    },
  );
});

describe("isGenericProtocolClientType", () => {
  it("accepts the picker's protocols, their older spellings, and empty; rejects every other client type", () => {
    expect(isGenericProtocolClientType("openai")).toBe(true);
    expect(isGenericProtocolClientType("gemini-generate-content")).toBe(true);
    expect(isGenericProtocolClientType("")).toBe(true);
    expect(isGenericProtocolClientType(" OpenAI-Responses ")).toBe(true);
    expect(isGenericProtocolClientType(" MMSP ")).toBe(true);
    // Official clients (the Gemini one under either name), compatible clients outside the
    // picker, and a pre-0.5.0 vendor name.
    expect(isGenericProtocolClientType("deepseek-official")).toBe(false);
    expect(isGenericProtocolClientType("anthropic-official")).toBe(false);
    expect(isGenericProtocolClientType("google-official")).toBe(false);
    expect(isGenericProtocolClientType("gemini-official")).toBe(false);
    expect(isGenericProtocolClientType("openai-chat-vllm-adapter")).toBe(false);
    expect(isGenericProtocolClientType("minimax-m3")).toBe(false);
    expect(isGenericProtocolClientType("constructor")).toBe(false);
  });
});

describe("protocolSelectorValue", () => {
  it("shows an older spelling as the protocol it names, and anything else as openai-chat, without rewriting the stored value", () => {
    expect(protocolSelectorValue("openai")).toBe("openai-chat");
    expect(protocolSelectorValue(" Gemini-Generate-Content ")).toBe("google-genai");
    expect(protocolSelectorValue("constructor")).toBe("openai-chat");
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
    expect(clientTypeAfterProviderChange("custom", "google-genai")).toBe("google-genai");
    expect(clientTypeAfterProviderChange("custom", "mmsp")).toBe("mmsp");
  });

  it("still pins vendor-specific or empty types to openai-chat when moving to Custom, and never touches other groups", () => {
    expect(clientTypeAfterProviderChange("custom", "")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("custom", "anthropic-official")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("google", "openai")).toBe("openai");
    expect(clientTypeAfterProviderChange("my-group", "ant-messages")).toBe("ant-messages");
  });

  it("drops the entry's own protocol in a group whose table sets one, so it follows the group", () => {
    // The group's protocol is the group's semantics, not a fallback: an entry dragged into
    // vLLM speaks what the rest of the group speaks, including one that had already picked a
    // protocol — by storing nothing, so it reads the group's rather than a copy of it.
    const vllm = presetGroup("vllm");
    for (const current of ["", "openai-chat", "ant-messages", "deepseek-official"]) {
      expect(clientTypeAfterProviderChange("vllm", current, vllm), current).toBe("");
    }
    // A gateway's table sets one too: OpenRouter speaks the Responses API for every upstream.
    const openrouter = presetGroup("openrouter");
    expect(clientTypeAfterProviderChange("openrouter", "", openrouter)).toBe("");
    expect(clientTypeAfterProviderChange("openrouter", "openai-chat", openrouter)).toBe("");
    // A group whose table sets none decides nothing, whatever the catalog would say.
    expect(clientTypeAfterProviderChange("vllm", "openai-chat")).toBe("openai-chat");
    // And moving back out of it does not carry the pin along.
    expect(clientTypeAfterProviderChange("custom", "openai-chat-vllm-adapter")).toBe("openai-chat");
  });
});

describe("isCustomLikeGroup", () => {
  it("covers custom and every unknown (user-defined) group, but no catalog vendor group", () => {
    expect(isCustomLikeGroup("custom")).toBe(true);
    expect(isCustomLikeGroup("my-group")).toBe(true);
    expect(isCustomLikeGroup("openai")).toBe(false);
    expect(isCustomLikeGroup("anthropic")).toBe(false);
    // A group that pins its protocol picks nothing: the choice is already made for it.
    expect(isCustomLikeGroup("vllm")).toBe(false);
  });
});

describe("needsProtocolDetectOnSave (save detects a still-unset protocol first)", () => {
  it("fires for saving a custom-like entry with no protocol yet and none to follow", () => {
    expect(needsProtocolDetectOnSave("save", "custom", "")).toBe(true);
    expect(needsProtocolDetectOnSave("save", "my-group", "   ")).toBe(true);
    expect(needsProtocolDetectOnSave("save", "my-group", "", {})).toBe(true);
  });

  it("does not fire when the group's settings decide the protocol", () => {
    // An imported group holds its protocol once; a model added to it later follows it.
    expect(needsProtocolDetectOnSave("save", "my-group", "", { clientType: "openai-chat" })).toBe(
      false,
    );
    expect(needsProtocolDetectOnSave("save", "custom", "", { clientType: "ant-messages" })).toBe(
      false,
    );
  });

  it("does not fire once a protocol is chosen", () => {
    expect(needsProtocolDetectOnSave("save", "custom", "ant-messages")).toBe(false);
    expect(needsProtocolDetectOnSave("save", "custom", "openai-chat")).toBe(false);
  });

  it("never probes for vendor groups, nor for actions other than save", () => {
    // A vendor group auto-routes by model id; an empty protocol there is correct.
    expect(needsProtocolDetectOnSave("save", "openai", "")).toBe(false);
    // A pinned group has nothing to probe for — the group already knows the answer.
    expect(needsProtocolDetectOnSave("save", "vllm", "")).toBe(false);
    expect(needsProtocolDetectOnSave("remove", "custom", "")).toBe(false);
    expect(needsProtocolDetectOnSave("setDefault", "custom", "")).toBe(false);
    expect(needsProtocolDetectOnSave("setVisionModel", "custom", "")).toBe(false);
  });
});

describe("envHintClientType (custom groups never infer a client from the model id)", () => {
  const envFor = (
    provider: string,
    modelId: string,
    clientType: string,
    group?: ProviderConnectionShape,
  ) => resolveModelEnv(modelId, envHintClientType(provider, clientType, modelId, group))?.envKey;

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

  it("resolves a group with a protocol against it rather than the model id", () => {
    // deepseek-ai/DeepSeek-V4-Pro would otherwise route by id to DEEPSEEK_API_KEY, which is
    // not what an entry saved on the vLLM client reads.
    const vllm = presetGroup("vllm");
    expect(envHintClientType("vllm", "", "", vllm)).toBe("openai-chat-vllm-adapter");
    expect(envFor("vllm", "deepseek-ai/DeepSeek-V4-Pro", "", vllm)).toBe("OPENAI_API_KEY");
  });

  it("leaves vendor groups routing by model id, which is how they really work", () => {
    expect(envHintClientType("anthropic", "")).toBeUndefined();
    expect(envFor("anthropic", "claude-sonnet-5", "")).toBe("ANTHROPIC_API_KEY");
    expect(envFor("google", "gemini-3.1-pro", "")).toBe("GEMINI_API_KEY");
  });
});

describe("envHintKeyFor (the API-key field promises a variable only where the entry may fall back to it)", () => {
  it("names nothing for a gateway row: its preset endpoint is not the vendor's, so the vendor key is not its key", () => {
    // The #786 finding: once an Anthropic row had proved OPENAI_API_KEY / ANTHROPIC_API_KEY
    // set, a TokenDance or OpenCode Go row read "leave empty to use the ... env var".
    expect(
      envHintKeyFor("tokendance", "glm-5.3", "openai-chat", "https://tokendance.space/gateway/v1"),
    ).toBeUndefined();
    expect(
      envHintKeyFor(
        "openrouter",
        "openai/gpt-5.5",
        "openai-responses",
        "https://openrouter.ai/api/v1",
      ),
    ).toBeUndefined();
    expect(
      envHintKeyFor("custom", "claude-sonnet-5", "ant-messages", "https://gw.example.com"),
    ).toBeUndefined();
    expect(envHintKeyFor("vllm", "Qwen/Qwen3.8-27B", "", "http://gpu-box:8000/v1")).toBeUndefined();
    expect(
      envHintKeyFor("my-group", "some-model", "", "https://gw.example.com/v1"),
    ).toBeUndefined();
  });

  it("names the vendor's variable for a first-party row, and the relay's own for Penguin Go", () => {
    expect(envHintKeyFor("anthropic", "claude-sonnet-4-6", "", "")).toBe("ANTHROPIC_API_KEY");
    expect(envHintKeyFor("google", "gemini-3.1-pro", "", "")).toBe("GEMINI_API_KEY");
    expect(envHintKeyFor("deepseek", "deepseek-flash", "", "")).toBe("DEEPSEEK_API_KEY");
    // A vendor row that carries the vendor's own endpoint keeps the vendor's key.
    expect(envHintKeyFor("deepseek", "deepseek-flash", "", "https://api.deepseek.com")).toBe(
      "DEEPSEEK_API_KEY",
    );
    // A custom row pointed at the vendor's own endpoint gets the vendor's key: it goes to the vendor.
    expect(envHintKeyFor("custom", "gpt-5.6", "openai-chat", "https://api.openai.com/v1")).toBe(
      "OPENAI_API_KEY",
    );
    expect(
      envHintKeyFor(
        "penguin-go",
        "gemini-3.8-flash",
        "google-genai",
        "https://token.penguin.ooo/api",
      ),
    ).toBe("PENGUIN_GO_API_KEY");
  });

  it("follows the base URL as it is edited: re-pointing a vendor row at a proxy drops the hint", () => {
    expect(
      envHintKeyFor("anthropic", "claude-sonnet-4-6", "", "https://proxy.example/anthropic"),
    ).toBeUndefined();
    expect(envHintKeyFor("anthropic", "claude-sonnet-4-6", "", "https://api.anthropic.com/")).toBe(
      "ANTHROPIC_API_KEY",
    );
  });

  it("judges the endpoint the row follows: a group pointed at a proxy lends no vendor key", () => {
    const proxied = { baseUrl: "https://proxy.example/deepseek" };
    expect(envHintKeyFor("deepseek", "deepseek-flash", "", "", proxied)).toBeUndefined();
    expect(
      envHintKeyFor("deepseek", "deepseek-flash", "", "", { baseUrl: "https://api.deepseek.com" }),
    ).toBe("DEEPSEEK_API_KEY");
    // A gateway row stores no endpoint of its own, yet follows its group's table to the gateway.
    expect(
      envHintKeyFor("tokendance", "glm-5.3", "", "", presetGroup("tokendance")),
    ).toBeUndefined();
    expect(
      envHintKeyFor("openrouter", "x-ai/grok-5", "", "", presetGroup("openrouter")),
    ).toBeUndefined();
  });

  it("promises nothing for a keyless vLLM preset or custom row with no base URL, and agrees with the server's preview rule", () => {
    // The vLLM presets ship with no base URL; the server refuses them a masked preview for the
    // same reason the field must not read "leave empty to use OPENAI_API_KEY": a self-hosted
    // id would be run against api.openai.com. Both sides read core's modelEnvPreviewKey.
    const cases: Array<[string, string, string, string]> = [
      ...MODEL_CATALOG.filter((m) => m.provider === "vllm").map(
        (m): [string, string, string, string] => [
          m.provider,
          m.modelId,
          m.clientType ?? "",
          m.baseUrl ?? "",
        ],
      ),
      ["custom", "local-model", "openai-chat", ""],
      ["custom", "gpt-5.6", "openai-chat", "https://api.openai.com/v1"],
      ["anthropic", "claude-sonnet-4-6", "", ""],
      ["anthropic", "claude-sonnet-4-6", "", "https://proxy.example/anthropic"],
      ["tokendance", "glm-5.3", "openai-chat", "https://tokendance.space/gateway/v1"],
      ["penguin-go", "gemini-3.8-flash", "google-genai", "https://token.penguin.ooo/api"],
    ];
    for (const [provider, modelId, clientType, baseUrl] of cases) {
      expect(envHintKeyFor(provider, modelId, clientType, baseUrl), `${provider}/${modelId}`).toBe(
        modelEnvPreviewKey({
          provider,
          modelId,
          clientType: envHintClientType(provider, clientType),
          baseUrl,
        }),
      );
    }
    for (const m of MODEL_CATALOG.filter((v) => v.provider === "vllm")) {
      expect(
        envHintKeyFor("vllm", m.modelId, "", "", presetGroup("vllm")),
        m.modelId,
      ).toBeUndefined();
    }
    expect(envHintKeyFor("custom", "local-model", "openai-chat", "")).toBeUndefined();
  });
});

describe("protocolForPersist (an entry's own protocol, never an unstartable empty one)", () => {
  it("falls back to openai-chat for a custom-like entry that still has none and follows none", () => {
    // AutoLLMClient routes an entry with no client type by the vendor family its id begins
    // with and THROWS for an id of no known family, so persisting "" would save a model that
    // cannot start (or one sent to a vendor's official client instead of the endpoint).
    expect(protocolForPersist("custom", "")).toBe("openai-chat");
    expect(protocolForPersist("my-group", "   ")).toBe("openai-chat");
  });

  it("keeps an explicit protocol exactly as chosen", () => {
    expect(protocolForPersist("custom", "ant-messages")).toBe("ant-messages");
    expect(protocolForPersist("custom", "openai-responses")).toBe("openai-responses");
    expect(protocolForPersist("my-group", " openai-chat ")).toBe("openai-chat");
  });

  it("writes nothing where the group decides, so the entry follows it", () => {
    // vLLM pins its adapter at group level; the entry reads it rather than storing a copy.
    expect(protocolForPersist("vllm", "")).toBe("");
    expect(protocolForPersist("vllm", "   ")).toBe("");
    // A custom-like group whose settings name a protocol: its models follow it too.
    expect(protocolForPersist("my-group", "", { clientType: "openai-responses" })).toBe("");
    // An explicit value still wins — it is the entry's own override.
    expect(protocolForPersist("vllm", "openai-chat")).toBe("openai-chat");
  });

  it("leaves preset / vendor groups empty so MMSP still routes by the model id's vendor family", () => {
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

  it("omits clientType for a vendor group so MMSP keeps routing it by the id", () => {
    expect(rowToEntry(row({ provider: "openai", modelId: "gpt-5.6" })).clientType).toBeUndefined();
  });

  it("sends a model added to a gateway with nothing of the connection: it follows the group", () => {
    // OpenRouter: blank base URL, key and protocol follow the group's table.
    const entry = rowToEntry(row({ provider: "openrouter", modelId: "x-ai/grok-5" }));
    expect(entry).not.toHaveProperty("clientType");
    expect(entry).not.toHaveProperty("baseUrl");
    expect(entry).not.toHaveProperty("apiKey");
  });

  it("leaves the stored promotion to the server: it is never sent", () => {
    expect(rowToEntry(row({ provider: "penguin-go", discount: 0.5 }))).not.toHaveProperty(
      "discount",
    );
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
  it("maps each protocol client to the path its MMSP client appends", () => {
    expect(protocolPathForModel("custom", "openai-responses")).toBe("/responses");
    expect(protocolPathForModel("custom", "ant-messages")).toBe("/v1/messages");
    expect(protocolPathForModel("custom", "openai-chat")).toBe("/chat/completions");
    // The bare alias and user-defined groups behave the same as before.
    expect(protocolPathForModel("my-group", "openai")).toBe("/chat/completions");
  });

  it("falls back to the group's path for no client type, or one MMSP does not know", () => {
    expect(protocolPathForModel("custom", "claude-4-8")).toBe("/chat/completions");
    expect(protocolPathForModel("openai", "")).toBe("/responses");
    expect(protocolPathForModel("anthropic", "")).toBe("/v1/messages");
    expect(protocolPathForModel("custom", "")).toBe("/chat/completions");
  });
});
