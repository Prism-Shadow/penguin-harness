/**
 * The Project's default models (features/models/default-models.tsx, lib/model-onboarding.ts).
 *
 * - The multimodal defaults a model can take (what a tool model's "Set as default model" sets)
 *   are the operations it can serve — image understanding when it can read images for another
 *   model, and each multimodal binding of the multimodal tools plugin that accepts it — marking
 *   the ones it already holds; web search, page reading and other plugins' bindings are tools,
 *   never part of it.
 * - A model that is the default for anything, chat or a multimodal job, carries one Default tag
 *   naming every job in its tooltip, chat first; one that is the default for nothing has none.
 * - A new chat starts on the Project's default, and on nothing when there is none.
 * - A Project with no default opens, for its owner, the default-models dialog when some chat model
 *   has a key behind it (an environment key counts), else the guide to connecting a provider; a
 *   Project with a default, a member, or a guide already closed in this browser opens nothing.
 * - Closing the guide is remembered per Project; storage that refuses reads as never closed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MULTIMODAL_TOOLS_PACKAGE, type ToolBinding } from "../src/api/tool-types";
import { multimodalTargets, VISION_ROW } from "../src/features/models/default-models";
import { defaultChatModel } from "../src/lib/model-grouping";
import { modelTags } from "../src/lib/model-tags";
import {
  dismissOnboarding,
  onboardingDismissed,
  onboardingStep,
  type OnboardingStorage,
} from "../src/lib/model-onboarding";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

const chat = { provider: "deepseek", modelId: "deepseek-flash" };
const asr = { provider: "deepseek", modelId: "deepseek-asr" };
const search = { provider: "deepseek", modelId: "deepseek-search" };

const binding = (
  key: string,
  title: string,
  candidates: ToolBinding["candidates"],
  extra: Partial<ToolBinding> = {},
): ToolBinding => ({
  key,
  title: { en: title, zh: title },
  package: MULTIMODAL_TOOLS_PACKAGE,
  candidates,
  ...extra,
});

const bindings: ToolBinding[] = [
  binding("t2t", "Text generation", [chat]),
  binding("search", "Web search", [search, chat]),
  binding("s2t", "Speech recognition", [asr], { model: asr }),
  // Another plugin's binding that accepts the chat model: a tool, whatever its key.
  { ...binding("t2i", "Sketches", [chat]), package: "@example/sketch" },
];

describe("the multimodal defaults a model can take", () => {
  it("a chat model that reads images takes text generation and image understanding, never web search", () => {
    setActiveStrings(en);
    expect(multimodalTargets({ ...chat, vision: true }, bindings, undefined, "en")).toEqual([
      { key: "t2t", title: "Text generation", current: false },
      { key: VISION_ROW, title: "Image understanding", current: false },
    ]);
  });

  it("marks what a model already holds, and leaves image understanding to models that read images", () => {
    expect(multimodalTargets({ ...chat, vision: false }, bindings, chat, "en")).toEqual([
      { key: "t2t", title: "Text generation", current: false },
    ]);
    expect(multimodalTargets({ ...asr, chatEligible: false }, bindings, undefined, "en")).toEqual([
      { key: "s2t", title: "Speech recognition", current: true },
    ]);
  });

  it("a model only a tool accepts takes nothing, so its dialog offers no multimodal action", () => {
    expect(
      multimodalTargets({ ...search, chatEligible: false }, bindings, undefined, "en"),
    ).toEqual([]);
  });
});

describe("the Default tag", () => {
  it("is one tag for every job a model is the default for, naming them, and none for no job", () => {
    setActiveStrings(en);
    const tags = modelTags({
      isDefault: true,
      vision: true,
      free: false,
      defaultFor: ["Text generation", "Image understanding"],
    });
    expect(tags.map((tag) => tag.label)).toEqual(["Default", "Vision"]);
    expect(tags[0]?.title).toBe("Default for: Chat, Text generation, Image understanding");
    expect(
      modelTags({
        isDefault: false,
        vision: false,
        free: false,
        defaultFor: ["Speech recognition"],
      }),
    ).toEqual([
      expect.objectContaining({ label: "Default", title: "Default for: Speech recognition" }),
    ]);
    expect(modelTags({ isDefault: false, vision: true, free: false, defaultFor: [] })).toEqual([
      expect.objectContaining({ key: "vision" }),
    ]);
  });
});

describe("the model a new chat starts on", () => {
  const models = [
    { ...chat },
    { ...asr, chatEligible: false },
    { provider: "openai", modelId: "gpt" },
  ];
  it("is the Project's default chat model", () => {
    expect(defaultChatModel(models, chat)).toEqual(chat);
  });
  it("is none when the Project has no default, or its default is a tool model", () => {
    expect(defaultChatModel(models, undefined)).toBeUndefined();
    expect(defaultChatModel(models, asr)).toBeUndefined();
  });
});

describe("which step a Project opens on", () => {
  const keyed = { ...chat, credential: { apiKeyMasked: "sk-…abcd" } };
  const fromEnv = { ...chat, envKeyMasked: "sk-…wxyz" };
  const keyless = { ...chat };
  const keyedTool = { ...asr, chatEligible: false, credential: { apiKeyMasked: "sk-…abcd" } };
  const step = (models: object[], extra: Partial<Parameters<typeof onboardingStep>[0]> = {}) =>
    onboardingStep({
      defaultModel: undefined,
      models: models as never,
      owner: true,
      dismissed: false,
      ...extra,
    });

  it("opens the dialog when a chat model has a key, an environment key included", () => {
    expect(step([keyless, keyed])).toBe("dialog");
    expect(step([fromEnv])).toBe("dialog");
  });

  it("opens the guide when no chat model has a key, whatever tool models have", () => {
    expect(step([keyless, keyedTool])).toBe("guide");
  });

  it("opens nothing with a default, for a member, or once closed here", () => {
    expect(step([keyed], { defaultModel: chat })).toBe("none");
    expect(step([keyed], { owner: false })).toBe("none");
    expect(step([keyless], { dismissed: true })).toBe("none");
  });
});

describe("closing the guide", () => {
  const memory = (): OnboardingStorage => {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  };

  it("is remembered for that Project only", () => {
    const storage = memory();
    dismissOnboarding("alpha", storage);
    expect(onboardingDismissed("alpha", storage)).toBe(true);
    expect(onboardingDismissed("beta", storage)).toBe(false);
  });

  it("reads as never closed when storage refuses, so the guide asks again", () => {
    const refusing: OnboardingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => dismissOnboarding("alpha", refusing)).not.toThrow();
    expect(onboardingDismissed("alpha", refusing)).toBe(false);
  });
});
