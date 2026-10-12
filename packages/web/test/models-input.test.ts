/**
 * Pure logic for the model config dialog:
 * - Numeric input filtering: the context window field accepts digits only;
 *   the price field accepts digits and at most one decimal point (any other
 *   characters from paste/IME input are stripped and never reach the form);
 * - DTO -> row edit state (toRow): provider and modelId are both plain entry
 *   fields with no prefix parsing; the loaded identity (original) is a paired
 *   reference;
 * - Ownership of the default/vision-agent model pointers after save
 *   (nextPointers): always compared as pairs; renaming (either provider or
 *   model_id changes) moves the pointer along.
 * - Which env fallback variables a key hint may promise (detectedEnvKeys):
 *   only those the server reported a value for.
 * - Whether a row has a key (hasKey) and what the card prints for it
 *   (keyStatusText / keyStatusNote): the key the row is used with — its own,
 *   its group's or a masked env fallback — plus the dialog's unsaved-edit
 *   notions; a key inherited from the group reads like the model's own, with
 *   its source on hover.
 * - Where a moved model's protocol lands (clientTypeAfterProviderChange): a
 *   group that decides one is followed rather than copied; a group that sets
 *   none decides nothing, whatever the catalog pins.
 * - What a blank API key or base URL field says (connectionPlaceholders):
 *   where the group's setting covers it, exactly "leave blank to use the
 *   group's setting" — never the group's URL or masked key; where the group's
 *   key does not reach the model's own endpoint, that it does not apply; where
 *   the group sets nothing, the field's own hint (the environment's variable,
 *   the client's default endpoint, the shape of a required URL).
 * - The Details fold (model-dialog-details.tsx): closed when a dialog opens;
 *   the add dialog shows only the model id, display name and group, folding
 *   the connection, the test and the rest; the settings dialog keeps the API
 *   key, base URL and actions in view and folds the limits, prices and
 *   capability switches; a wrong field inside the closed fold is what opens it
 *   (Save waits on every field, so the reason it waits must be in view).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@prismshadow/penguin-server/api";
import {
  capabilityRow,
  clientTypeAfterProviderChange,
  connectionPlaceholders,
  decimalOnly,
  detectedEnvKeys,
  digitsOnly,
  fastModeState,
  modelLabelOf,
  priceToSubmit,
  hasKey,
  keyStatusNote,
  keyStatusText,
  nextPointers,
  rowRef,
  toRow,
} from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";
import {
  DetailsFold,
  foldedErrors,
  foldedSlots,
} from "../src/features/models/model-dialog-details";
import { S } from "../src/lib/strings";

/** A saved model as GET /models sends it; the effective connection is irrelevant to these rules. */
const dto = (m: Omit<ModelInfo, "effective" | "isDefault">): ModelInfo => ({
  isDefault: false,
  effective: { baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" },
  ...m,
});

describe("priceToSubmit", () => {
  // The catalog bills this row at CNY 0.05 per million, i.e. $0.00714285714... The form can
  // only show four decimals, so the loaded field reads 0.0071.
  const STORED = "0.007142857";

  it("returns the stored number untouched when the field still holds what was loaded", () => {
    expect(priceToSubmit("0.0071", STORED, "USD")).toBe(STORED);
    // Same in CNY, where the round trip also passes through the x7 conversion.
    expect(priceToSubmit("0.05", STORED, "CNY")).toBe(STORED);
  });

  it("takes the typed value once the field has actually been edited", () => {
    expect(priceToSubmit("0.9", STORED, "USD")).toBe("0.9");
    expect(priceToSubmit("7", STORED, "CNY")).toBe("1");
  });

  it("encodes normally when there is nothing stored to preserve", () => {
    expect(priceToSubmit("0.0071", undefined, "USD")).toBe("0.0071");
    expect(priceToSubmit("0.0071", "", "USD")).toBe("0.0071");
  });

  it("passes an emptied field through as empty, which clears the price", () => {
    expect(priceToSubmit("", STORED, "USD")).toBe("");
  });
});

describe("modelLabelOf", () => {
  it("prefers the display name", () => {
    expect(modelLabelOf("My GPT", "gpt-5.5")).toBe("My GPT");
  });

  it("falls back to the id when the name was cleared, not just when it was never set", () => {
    // The dialog clears the field to "", so `?? modelId` would hand back an empty label — which
    // is how a save confirmation came to quote an empty name.
    expect(modelLabelOf(undefined, "gpt-5.5")).toBe("gpt-5.5");
    expect(modelLabelOf("", "gpt-5.5")).toBe("gpt-5.5");
    expect(modelLabelOf("   ", "gpt-5.5")).toBe("gpt-5.5");
  });

  it("keeps a name that merely has padding around it", () => {
    expect(modelLabelOf("  My GPT  ", "gpt-5.5")).toBe("My GPT");
  });
});

describe("digitsOnly (context window)", () => {
  it("keeps digits only", () => {
    expect(digitsOnly("200000")).toBe("200000");
    expect(digitsOnly("20e5")).toBe("205");
    expect(digitsOnly("200,000 tokens")).toBe("200000");
    expect(digitsOnly("-3.5")).toBe("35");
    expect(digitsOnly("abc")).toBe("");
  });
});

describe("decimalOnly (price)", () => {
  it("keeps digits and at most one decimal point", () => {
    expect(decimalOnly("3.75")).toBe("3.75");
    expect(decimalOnly("$3.75")).toBe("3.75");
    expect(decimalOnly("3.7.5")).toBe("3.75");
    expect(decimalOnly("1..2.3")).toBe("1.23");
    expect(decimalOnly(".5")).toBe(".5");
    expect(decimalOnly("-1e3")).toBe("13");
    expect(decimalOnly("abc")).toBe("");
  });
});

describe("detectedEnvKeys (variables a key hint may promise)", () => {
  it("collects the variables the server reported a value for, and only those", () => {
    const rows = [
      toRow(
        dto({
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          envKey: "ANTHROPIC_API_KEY",
          envKeyMasked: "sk-a…3456",
        }),
      ),
      // Variable name known, no value reported: nothing here proves it is set, so a hint
      // must not tell the user that leaving the key empty is covered.
      toRow(
        dto({
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          envKey: "DEEPSEEK_API_KEY",
        }),
      ),
      toRow(dto({ provider: "custom", modelId: "my-model" })),
    ];
    expect(detectedEnvKeys(rows)).toEqual(new Set(["ANTHROPIC_API_KEY"]));
    expect(detectedEnvKeys([])).toEqual(new Set());
  });
});

describe("hasKey / keyStatusText / keyStatusNote (the model card's key judgement)", () => {
  const stored = toRow(
    dto({
      provider: "moonshot",
      modelId: "kimi-k2.6",
      credential: { apiKeyMasked: "sk-o\u20261111" },
    }),
  );
  const envBacked = toRow(
    dto({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      envKey: "ANTHROPIC_API_KEY",
      envKeyMasked: "sk-a\u20263456",
    }),
  );
  const bare = toRow(dto({ provider: "custom", modelId: "my-model" }));

  it("a stored key or a masked env fallback both count; a bare row does not", () => {
    expect(hasKey(stored)).toBe(true);
    expect(hasKey(envBacked)).toBe(true);
    expect(hasKey(bare)).toBe(false);
    // Variable name only: nothing proves it is set, so it is still key-less.
    const nameOnly = toRow(
      dto({
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        envKey: "DEEPSEEK_API_KEY",
      }),
    );
    expect(hasKey(nameOnly)).toBe(false);
  });

  it("a key typed in the dialog counts before it is saved", () => {
    expect(hasKey({ ...bare, apiKeyInput: "  sk-new  " })).toBe(true);
    expect(hasKey({ ...bare, apiKeyInput: "   " })).toBe(false);
  });

  it("clearApiKey drops the stored key only: an env-backed row keeps its key", () => {
    expect(hasKey({ ...stored, clearApiKey: true })).toBe(false);
    // The environment cannot be cleared from the dialog, so clearing leaves it behind.
    expect(
      hasKey({ ...envBacked, credential: { apiKeyMasked: "sk-a\u20269999" }, clearApiKey: true }),
    ).toBe(true);
  });

  it("the status line shows the most specific source it has", () => {
    expect(keyStatusText(stored)).toBe("sk-o\u20261111");
    expect(keyStatusText(envBacked)).toBe("sk-a\u20263456");
    expect(keyStatusText(bare)).toBe(S.models.noKey);
    // A key typed but not yet saved has no mask of its own.
    expect(keyStatusText({ ...bare, apiKeyInput: "sk-new" })).toBe(S.models.keyConfigured);
    // Clearing a stored key falls back to the environment's mask rather than "no key".
    expect(
      keyStatusText({
        ...envBacked,
        credential: { apiKeyMasked: "sk-a\u20269999" },
        clearApiKey: true,
      }),
    ).toBe("sk-a\u20263456");
  });

  /** A group whose table holds a key: Enter key, Connect or the group settings wrote it. */
  const keyedGroup = { apiKeyMasked: "sk-g\u20262222" };

  it("a model with no key of its own uses its group's, which reads like its own, sourced on hover", () => {
    expect(hasKey(bare, keyedGroup)).toBe(true);
    expect(keyStatusText(bare, keyedGroup)).toBe("sk-g\u20262222");
    expect(keyStatusNote(bare, keyedGroup)).toBe(S.models.keyFromGroup);
    // The environment's key gets the same treatment; a key of the model's own needs no note.
    expect(keyStatusNote(envBacked)).toBe(S.models.readFromEnv);
    expect(keyStatusNote(stored, keyedGroup)).toBeUndefined();
    expect(keyStatusNote(bare)).toBeUndefined();
  });

  it("a key of the model's own wins over the group's, and clearing it falls back to the group's", () => {
    expect(keyStatusText(stored, keyedGroup)).toBe("sk-o\u20261111");
    expect(keyStatusText({ ...stored, clearApiKey: true }, keyedGroup)).toBe("sk-g\u20262222");
    expect(hasKey({ ...stored, clearApiKey: true }, keyedGroup)).toBe(true);
  });

  it("a group table without a key lends none", () => {
    expect(hasKey(bare, { baseUrl: "https://proxy.example/v1" })).toBe(false);
    expect(keyStatusText(bare, { baseUrl: "https://proxy.example/v1" })).toBe(S.models.noKey);
  });
});

describe("clientTypeAfterProviderChange", () => {
  it("uses openai-chat when moving to Custom and otherwise preserves the current client", () => {
    expect(clientTypeAfterProviderChange("custom", "")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("custom", "anthropic-official")).toBe("openai-chat");
    expect(clientTypeAfterProviderChange("google", "openai-chat")).toBe("openai-chat");
  });

  it("follows a group that decides the protocol, rather than copying it onto the model", () => {
    // TokenDance's table holds Chat Completions: a model moved in stores nothing.
    expect(
      clientTypeAfterProviderChange("tokendance", "ant-messages", { clientType: "openai-chat" }),
    ).toBe("");
    // The same group with its protocol cleared decides nothing: the model keeps its own.
    expect(clientTypeAfterProviderChange("tokendance", "ant-messages")).toBe("ant-messages");
    // Custom with a protocol set in its group settings: a model moved in from a vendor group
    // follows it, while a generic protocol the model already chose stays its own.
    const groupProtocol = { clientType: "openai-responses" };
    expect(clientTypeAfterProviderChange("custom", "", groupProtocol)).toBe("");
    expect(clientTypeAfterProviderChange("custom", "anthropic-official", groupProtocol)).toBe("");
    expect(clientTypeAfterProviderChange("custom", "ant-messages", groupProtocol)).toBe(
      "ant-messages",
    );
  });
});

describe("toRow (DTO → row edit state)", () => {
  it("provider and modelId are both plain entry fields (zero parsing); the loaded identity is a paired reference", () => {
    const row = toRow(
      dto({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
      }),
    );
    expect(row.provider).toBe("anthropic");
    expect(row.modelId).toBe("claude-sonnet-4-6");
    expect(row.original).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(rowRef(row)).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
  });

  it("carries the env-fallback name and its masked preview through to the row", () => {
    const row = toRow(
      dto({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        envKey: "ANTHROPIC_API_KEY",
        envKeyMasked: "sk-a…3456",
      }),
    );
    expect(row.envKey).toBe("ANTHROPIC_API_KEY");
    expect(row.envKeyMasked).toBe("sk-a…3456");
    expect(toRow(dto({ provider: "custom", modelId: "m" })).envKeyMasked).toBe(undefined);
  });

  it("providers outside the catalog list are kept as-is (only the display layer buckets them under custom)", () => {
    const row = toRow(dto({ provider: "myproxy", modelId: "claude-sonnet-4-6" }));
    expect(row.provider).toBe("myproxy");
    expect(row.modelId).toBe("claude-sonnet-4-6");
    expect(row.original).toEqual({ provider: "myproxy", modelId: "claude-sonnet-4-6" });
  });

  it("an upstream id may itself contain `/` (gateway models): still the full model_id, not mistaken for a group", () => {
    const row = toRow(dto({ provider: "openrouter", modelId: "xiaomi/mimo-v2.5" }));
    expect(row.provider).toBe("openrouter");
    expect(row.modelId).toBe("xiaomi/mimo-v2.5");
  });

  it("carries the per-model max output tokens through; absent = '' (inherit the Agent setting)", () => {
    const capped = toRow(
      dto({
        provider: "custom",
        modelId: "local-qwen",
        maxTokens: 8000,
      }),
    );
    expect(capped.maxTokens).toBe("8000");
    const plain = toRow(dto({ provider: "custom", modelId: "local-qwen" }));
    expect(plain.maxTokens).toBe("");
  });

  it("carries the per-model fast mode through; absent = off (the toggle's default)", () => {
    const fast = toRow(
      dto({
        provider: "custom",
        modelId: "local-qwen",
        fastMode: true,
      }),
    );
    expect(fast.fastMode).toBe(true);
    const plain = toRow(dto({ provider: "custom", modelId: "local-qwen" }));
    expect(plain.fastMode).toBe(false);
  });
});

describe("nextPointers (where the default/vision-agent model pointers land after save; always paired)", () => {
  const mA = { provider: "custom", modelId: "m-a" };
  const mANew = { provider: "custom", modelId: "m-a-new" };
  const mB = { provider: "custom", modelId: "m-b" };
  const base = { action: "save" as const, defaultModel: mA, visionModel: mB };

  it("renames carry the pointer along (otherwise the submitted stale reference is no longer in models and the server 400s)", () => {
    // Renaming the current default model.
    expect(nextPointers({ ...base, editing: mA, ref: mANew })).toEqual({
      defaultModel: mANew,
      visionModel: mB,
    });
    // Renaming the current vision-agent model.
    const mBNew = { provider: "custom", modelId: "m-b-new" };
    expect(nextPointers({ ...base, editing: mB, ref: mBNew })).toEqual({
      defaultModel: mA,
      visionModel: mBNew,
    });
    // Same model is both default and vision agent: both pointers move together.
    expect(nextPointers({ ...base, editing: mA, ref: mANew, visionModel: mA })).toEqual({
      defaultModel: mANew,
      visionModel: mANew,
    });
  });

  it("changing only the group (model_id unchanged) is also a rename: the pointer follows the new provider", () => {
    const moved = { provider: "openai", modelId: "m-a" };
    expect(nextPointers({ ...base, editing: mA, ref: moved })).toEqual({
      defaultModel: moved,
      visionModel: mB,
    });
  });

  it("no rename, or editing another model: pointers stay put", () => {
    expect(nextPointers({ ...base, editing: mA, ref: mA })).toEqual({
      defaultModel: mA,
      visionModel: mB,
    });
    const mC = { provider: "custom", modelId: "m-c" };
    const mCNew = { provider: "custom", modelId: "m-c-new" };
    expect(nextPointers({ ...base, editing: mC, ref: mCNew })).toEqual({
      defaultModel: mA,
      visionModel: mB,
    });
  });

  it("the same model_id under two providers: only a pointer equal as a pair follows", () => {
    // Default pointer points to openai/m-a, but the edit renames custom/m-a:
    // same modelId, different provider — the pointer must not be changed.
    const openaiA = { provider: "openai", modelId: "m-a" };
    expect(
      nextPointers({
        action: "save",
        editing: mA,
        ref: mANew,
        defaultModel: openaiA,
        visionModel: undefined,
      }),
    ).toEqual({ defaultModel: openaiA, visionModel: undefined });
  });

  it("set as default / set as vision agent: the pointer points at this model", () => {
    const mC = { provider: "custom", modelId: "m-c" };
    expect(nextPointers({ ...base, editing: mC, ref: mC, action: "setDefault" })).toEqual({
      defaultModel: mC,
      visionModel: mB,
    });
    expect(nextPointers({ ...base, editing: mC, ref: mC, action: "setVisionModel" })).toEqual({
      defaultModel: mA,
      visionModel: mC,
    });
  });

  it("the first model added (no default before) automatically becomes the default model", () => {
    const first = { provider: "custom", modelId: "m-first" };
    expect(
      nextPointers({
        editing: null,
        ref: first,
        action: "save",
        defaultModel: undefined,
        visionModel: undefined,
      }),
    ).toEqual({ defaultModel: first, visionModel: undefined });
    // When a default already exists, a newly added model does not take it over.
    const mNew = { provider: "custom", modelId: "m-new" };
    expect(nextPointers({ ...base, editing: null, ref: mNew })).toEqual({
      defaultModel: mA,
      visionModel: mB,
    });
  });
});

describe("fastModeState (whether the dialog offers the fast-mode switch, and on which protocol)", () => {
  // The provider defaults to a real vendor group, whose entries are routed by the vendor
  // family their model id begins with — the custom-like groups, which resolve to a protocol
  // instead, are exercised explicitly below.
  const draft = (partial: {
    modelId: string;
    provider?: string;
    clientType?: string;
    baseUrl?: string;
    fastMode?: boolean;
  }) => ({
    provider: partial.provider ?? "anthropic",
    modelId: partial.modelId,
    clientType: partial.clientType ?? "",
    baseUrl: partial.baseUrl ?? "",
    fastMode: partial.fastMode ?? false,
  });

  it("offers it where MMSP's routed client carries the parameter, with the protocol", () => {
    // Gateway / custom rows pin the OpenAI protocol; first-party Claude ids take the
    // Anthropic one, which is what selects the research-preview paragraph in the warning.
    expect(fastModeState(draft({ modelId: "z-ai/glm-5.2", clientType: "openai" }))).toEqual({
      protocol: "openai",
      show: true,
    });
    expect(fastModeState(draft({ modelId: "claude-fable-5" }))).toEqual({
      protocol: "anthropic",
      show: true,
    });
    expect(fastModeState(draft({ modelId: "gpt-5.5" })).protocol).toBe("openai");
    // Google's Interactions API takes the priority service tier the way OpenAI's API does.
    expect(fastModeState(draft({ modelId: "gemini-3.5-flash" })).protocol).toBe("openai");
  });

  it("withholds it where the client would reject the parameter", () => {
    // The whole point of the gate: these ids would fail the next turn with fast mode on.
    for (const modelId of ["glm-5.2", "kimi-k3", "deepseek-v4-pro"]) {
      expect(fastModeState(draft({ modelId })), modelId).toEqual({
        protocol: undefined,
        show: false,
      });
    }
    // A Gemini id pinned to the generateContent client (what the Penguin Go rows pin) loses
    // the tier its unpinned id would have.
    expect(
      fastModeState(draft({ modelId: "gemini-3.5-flash", clientType: "google-genai" })),
    ).toEqual({ protocol: undefined, show: false });
    // Claude 4.6 is refused by name even though the client serves the family, and Bedrock
    // has no fast tier at all — the base URL is read from the draft, not the saved row.
    expect(fastModeState(draft({ modelId: "claude-sonnet-4-6" })).show).toBe(false);
    expect(
      fastModeState(draft({ modelId: "claude-fable-5", baseUrl: "bedrock://us-east-1" })).show,
    ).toBe(false);
  });

  it("keeps the switch on a row that already stores fast mode, so it can always be turned off", () => {
    // A value that arrived by hand-edited TOML or `--fast-mode` must stay switchable off:
    // the runtime rejection tells the user to turn it off in the model settings.
    const stranded = fastModeState(draft({ modelId: "kimi-k3", fastMode: true }));
    expect(stranded.show).toBe(true);
    // ...but the protocol stays undefined, which is what raises the "not supported" warning
    // line instead of pretending the model can serve it.
    expect(stranded.protocol).toBeUndefined();
  });

  it("follows the draft as it is typed: an unsaved protocol change flips the answer", () => {
    // Same upstream id, different client: routed to Kimi's own client it is rejected, pinned
    // to the OpenAI protocol (as a gateway reselling it would be) it is served.
    expect(fastModeState(draft({ modelId: "kimi-k3" })).show).toBe(false);
    expect(fastModeState(draft({ modelId: "kimi-k3", clientType: "openai" }))).toEqual({
      protocol: "openai",
      show: true,
    });
    // An owner-prefixed gateway id routes nowhere unpinned (no vendor family begins with
    // "moonshotai/"), so it has no fast tier until a protocol is pinned.
    expect(fastModeState(draft({ modelId: "moonshotai/kimi-k3" })).show).toBe(false);
    // Whitespace-only fields are treated as absent, matching what the form submits.
    expect(fastModeState(draft({ modelId: "claude-fable-5", clientType: "  " })).protocol).toBe(
      "anthropic",
    );
  });

  it("resolves a custom-like group through the protocol it will be saved with, not its model id", () => {
    // A custom / user-defined group starts with no protocol and is persisted on the
    // compatible client (protocolForPersist -> DEFAULT_CUSTOM_CLIENT_TYPE), which carries
    // fast mode. Routing those ids by name instead would withhold the switch from an entry
    // that can serve it — nothing about such a group routes by model id.
    for (const provider of ["custom", "my-group"]) {
      expect(fastModeState(draft({ provider, modelId: "my-model" })), provider).toEqual({
        protocol: "openai",
        show: true,
      });
      // Ids that WOULD route to a client with no fast tier if they were read by name: the
      // group still saves them on the compatible client, so the switch stays offered.
      for (const modelId of ["kimi-k3", "glm-5.2", "deepseek-v4-pro"]) {
        expect(fastModeState(draft({ provider, modelId })), `${provider}/${modelId}`).toEqual({
          protocol: "openai",
          show: true,
        });
      }
    }
    // An explicitly picked protocol still wins over the fallback, on either family.
    expect(
      fastModeState(draft({ provider: "custom", modelId: "my-model", clientType: "ant-messages" }))
        .protocol,
    ).toBe("anthropic");
    expect(
      fastModeState(
        draft({ provider: "custom", modelId: "my-model", clientType: "openai-responses" }),
      ).protocol,
    ).toBe("openai");
    // The Bedrock carve-out belongs to the anthropic-official client, so it applies where routing
    // actually reaches that client: a vendor group withholds the switch, while the same id
    // and base URL under a custom group is pinned to the compatible client and keeps it.
    // The gate mirrors AutoLLMClient's routing; it does not promise the endpoint honours
    // the parameter, which no dialog-side rule can know.
    expect(
      fastModeState(
        draft({ provider: "anthropic", modelId: "claude-fable-5", baseUrl: "bedrock://us-east-1" }),
      ).show,
    ).toBe(false);
    expect(
      fastModeState(
        draft({ provider: "custom", modelId: "claude-fable-5", baseUrl: "bedrock://us-east-1" }),
      ).protocol,
    ).toBe("openai");
  });

  it("leaves preset and vendor groups on id-based routing when no protocol is set", () => {
    // The fallback is scoped to custom-like groups: a vendor group with an empty protocol
    // must keep deferring to MMSP's id routing, so a no-fast-tier id stays withheld.
    expect(fastModeState(draft({ provider: "moonshot", modelId: "kimi-k3" }))).toEqual({
      protocol: undefined,
      show: false,
    });
    expect(
      fastModeState(draft({ provider: "anthropic", modelId: "claude-fable-5" })).protocol,
    ).toBe("anthropic");
  });
});

describe("capabilityRow (vision support + fast mode sharing one row)", () => {
  it("splits the row into two half-width cells when both switches are there", () => {
    expect(capabilityRow({ vision: true, fastMode: true })).toEqual({
      show: true,
      cellClass: undefined,
    });
  });

  it("gives a lone switch the full width, in either direction", () => {
    // The pair is a coincidence, not an invariant. Fast mode is withheld for every model
    // whose routed client rejects the parameter (the common case), and the vision switch has
    // to keep rendering on its own — full width, not squeezed into half a row beside a hole.
    expect(capabilityRow({ vision: true, fastMode: false })).toEqual({
      show: true,
      cellClass: "col-span-2",
    });
    // The mirror image: a preset model annotated by the catalog shows no vision switch, so
    // fast mode is alone.
    expect(capabilityRow({ vision: false, fastMode: true })).toEqual({
      show: true,
      cellClass: "col-span-2",
    });
  });

  it("drops the row entirely when neither switch is there", () => {
    // A preset model whose client rejects fast mode has no capability switches at all: the
    // grid must not render, or the dialog's space-y would draw a gap around an empty box.
    expect(capabilityRow({ vision: false, fastMode: false }).show).toBe(false);
  });
});

describe("connectionPlaceholders (what a blank API key or base URL field says)", () => {
  const draft = (
    patch: Partial<Pick<RowState, "provider" | "modelId" | "baseUrl" | "credential">> = {},
  ) => ({
    provider: "openrouter",
    modelId: "x-ai/grok-5",
    baseUrl: "",
    ...patch,
  });
  const GROUP = {
    baseUrl: "https://openrouter.ai/api/v1",
    clientType: "openai-responses",
    apiKeyMasked: "sk-or…4444",
  };
  const plain = { baseUrlRequired: false };

  it("says the group's setting covers a blank field, and repeats neither its URL nor its key", () => {
    const hints = connectionPlaceholders(draft(), GROUP, plain);
    expect(hints).toEqual({
      apiKey: S.models.inheritFromGroup,
      baseUrl: S.models.inheritFromGroup,
    });
    for (const hint of Object.values(hints)) {
      expect(hint).not.toContain("openrouter.ai");
      expect(hint).not.toContain("4444");
    }
  });

  it("keeps a model's own key, and says the group's key does not reach a model on another origin", () => {
    expect(
      connectionPlaceholders(draft({ credential: { apiKeyMasked: "sk-m…1111" } }), GROUP, plain)
        .apiKey,
    ).toBe(S.models.apiKeyKeepHint);
    const proxied = connectionPlaceholders(
      draft({ baseUrl: "https://proxy.example/v1" }),
      GROUP,
      plain,
    );
    expect(proxied.apiKey).toBe(S.models.keyNotReachedNote);
    // The base URL field is the model's own here; blank, it would still follow the group.
    expect(proxied.baseUrl).toBe(S.models.inheritFromGroup);
  });

  it("falls back to the field's own hint where the group sets nothing", () => {
    expect(
      connectionPlaceholders(
        draft({ provider: "deepseek", modelId: "deepseek-flash" }),
        undefined,
        {
          envKey: "DEEPSEEK_API_KEY",
          baseUrlRequired: false,
        },
      ),
    ).toEqual({
      apiKey: S.models.apiKeyEnvHint("DEEPSEEK_API_KEY"),
      baseUrl: S.models.baseUrlNone,
    });
    expect(
      connectionPlaceholders(draft({ provider: "my-group" }), undefined, {
        baseUrlRequired: true,
      }),
    ).toEqual({ apiKey: undefined, baseUrl: "https://…" });
    // A table with a key but no URL lends the key to models without one of their own.
    expect(connectionPlaceholders(draft(), { apiKeyMasked: "sk-g…2222" }, plain)).toEqual({
      apiKey: S.models.inheritFromGroup,
      baseUrl: S.models.baseUrlNone,
    });
  });
});

describe("the model dialogs' Details fold", () => {
  const fold = (open: boolean) =>
    renderToStaticMarkup(
      createElement(DetailsFold, {
        open,
        onToggle: () => {},
        children: createElement("input", { id: "x" }),
      }),
    );

  it("is closed until opened, its fields kept in the page but hidden", () => {
    const closed = fold(false);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toMatch(/ hidden=""/);
    expect(closed).toContain('id="x"');
    expect(closed).toContain(S.models.details);
    const open = fold(true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toMatch(/ hidden=""/);
  });

  it("leaves only the model's id, name and group in view when adding", () => {
    // Every block below the identity fields is folded: a new model follows its group.
    expect([...foldedSlots(true)].sort()).toEqual(
      ["actions", "apiKey", "baseUrl", "capabilities", "limits", "pricing"].sort(),
    );
  });

  it("keeps the actions, the API key and the base URL in view on a saved model", () => {
    const folded = foldedSlots(false);
    for (const slot of ["actions", "apiKey", "baseUrl"] as const)
      expect(folded.has(slot)).toBe(false);
    for (const slot of ["limits", "pricing", "capabilities"] as const) {
      expect(folded.has(slot)).toBe(true);
    }
  });

  it("names the wrong fields inside the fold, in the dialog's order, and none in view", () => {
    // Adding a custom model with no base URL anywhere: the field is folded.
    expect(foldedErrors({ baseUrl: "required" }, true)).toEqual(["baseUrl"]);
    // The same error on a saved model is in view: nothing to open.
    expect(foldedErrors({ baseUrl: "required" }, false)).toEqual([]);
    // A partial price on a saved model: both missing buckets, in the dialog's order.
    expect(foldedErrors({ output: "x", cacheWrite: "x" }, false)).toEqual(["cacheWrite", "output"]);
    // The id is an identity field, never folded; the limit behind it is.
    expect(foldedErrors({ modelId: "x", contextWindow: "x" }, true)).toEqual(["contextWindow"]);
    expect(foldedErrors({}, true)).toEqual([]);
  });
});
