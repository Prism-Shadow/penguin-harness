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
 */
import { describe, expect, it } from "vitest";
import {
  clientTypeAfterProviderChange,
  decimalOnly,
  digitsOnly,
  fastModeState,
  nextPointers,
  rowRef,
  toRow,
} from "../src/features/models/models-page";

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

describe("clientTypeAfterProviderChange", () => {
  it("uses openai when moving to Custom and otherwise preserves the current client", () => {
    expect(clientTypeAfterProviderChange("custom", "")).toBe("openai");
    expect(clientTypeAfterProviderChange("custom", "claude-5")).toBe("openai");
    expect(clientTypeAfterProviderChange("google", "openai")).toBe("openai");
  });
});

describe("toRow (DTO → row edit state)", () => {
  it("provider and modelId are both plain entry fields (zero parsing); the loaded identity is a paired reference", () => {
    const row = toRow({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      isDefault: false,
    });
    expect(row.provider).toBe("anthropic");
    expect(row.modelId).toBe("claude-sonnet-4-6");
    expect(row.original).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(rowRef(row)).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
  });

  it("providers outside the catalog list are kept as-is (only the display layer buckets them under custom)", () => {
    const row = toRow({ provider: "myproxy", modelId: "claude-sonnet-4-6", isDefault: false });
    expect(row.provider).toBe("myproxy");
    expect(row.modelId).toBe("claude-sonnet-4-6");
    expect(row.original).toEqual({ provider: "myproxy", modelId: "claude-sonnet-4-6" });
  });

  it("an upstream id may itself contain `/` (gateway models): still the full model_id, not mistaken for a group", () => {
    const row = toRow({ provider: "openrouter", modelId: "xiaomi/mimo-v2.5", isDefault: false });
    expect(row.provider).toBe("openrouter");
    expect(row.modelId).toBe("xiaomi/mimo-v2.5");
  });

  it("carries the per-model max output tokens through; absent = '' (inherit the Agent setting)", () => {
    const capped = toRow({
      provider: "custom",
      modelId: "local-qwen",
      maxTokens: 8000,
      isDefault: false,
    });
    expect(capped.maxTokens).toBe("8000");
    const plain = toRow({ provider: "custom", modelId: "local-qwen", isDefault: false });
    expect(plain.maxTokens).toBe("");
  });

  it("carries the per-model fast mode through; absent = off (the toggle's default)", () => {
    const fast = toRow({
      provider: "custom",
      modelId: "local-qwen",
      fastMode: true,
      isDefault: false,
    });
    expect(fast.fastMode).toBe(true);
    const plain = toRow({ provider: "custom", modelId: "local-qwen", isDefault: false });
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
  const draft = (partial: {
    modelId: string;
    clientType?: string;
    baseUrl?: string;
    fastMode?: boolean;
  }) => ({
    modelId: partial.modelId,
    clientType: partial.clientType ?? "",
    baseUrl: partial.baseUrl ?? "",
    fastMode: partial.fastMode ?? false,
  });

  it("offers it where AgentHub's routed client carries the parameter, with the protocol", () => {
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
  });

  it("withholds it where the client would reject the parameter", () => {
    // The whole point of the gate: these ids would fail the next turn with fast mode on.
    for (const modelId of ["gemini-3.5-flash", "glm-5.2", "kimi-k3", "deepseek-v4-pro"]) {
      expect(fastModeState(draft({ modelId })), modelId).toEqual({
        protocol: undefined,
        show: false,
      });
    }
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
    // Same upstream id, different client: routed to Kimi it is rejected, pinned to the
    // OpenAI protocol (a gateway reselling it) it is served.
    expect(fastModeState(draft({ modelId: "moonshotai/kimi-k3" })).show).toBe(false);
    expect(fastModeState(draft({ modelId: "moonshotai/kimi-k3", clientType: "openai" }))).toEqual({
      protocol: "openai",
      show: true,
    });
    // Whitespace-only fields are treated as absent, matching what the form submits.
    expect(fastModeState(draft({ modelId: "claude-fable-5", clientType: "  " })).protocol).toBe(
      "anthropic",
    );
  });
});
