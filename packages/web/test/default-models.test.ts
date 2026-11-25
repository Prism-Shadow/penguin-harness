/**
 * The Project's default models (features/models/default-models.tsx, lib/model-onboarding.ts).
 *
 * - The bindings a model can serve (what a tool model's "Use model" takes) are every binding that
 *   accepts it — the multimodal rows first, then web search, page reading and other plugins'
 *   bindings — each marked when the model is chosen for it; image understanding is not one.
 * - Default marks the default chat model alone; In use marks a model chosen for any binding and
 *   names them on hover; a model can carry both.
 * - A new chat starts on the Project's default, and on nothing when there is none.
 * - A Project with no default opens, for its owner, the default-models dialog when some chat model
 *   has a key behind it (an environment key counts), else the guide to connecting a provider; a
 *   Project with a default, a member, or a guide already closed in this browser opens nothing.
 * - Closing the guide is remembered per Project; storage that refuses reads as never closed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MULTIMODAL_TOOLS_PACKAGE, type ToolBinding } from "../src/api/tool-types";
import { usageTargets } from "@prismshadow/penguin-library-model/web/models/default-models";
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

describe("the bindings a model can serve", () => {
  it("lists the multimodal rows first, then the tools, never image understanding", () => {
    expect(usageTargets(chat, bindings, "en")).toEqual([
      { key: "t2t", title: "Text generation", current: false },
      { key: "search", title: "Web search", current: false },
      { key: "t2i", title: "Sketches", current: false },
    ]);
  });

  it("marks what a model is chosen for, a tool model's search included", () => {
    expect(usageTargets(asr, bindings, "en")).toEqual([
      { key: "s2t", title: "Speech recognition", current: true },
    ]);
    const bound = bindings.map((b) => (b.key === "search" ? { ...b, model: search } : b));
    expect(usageTargets(search, bound, "en")).toEqual([
      { key: "search", title: "Web search", current: true },
    ]);
  });
});

describe("the Default and In use tags", () => {
  it("marks the default chat model, and names what a model is used for, both on one model", () => {
    setActiveStrings(en);
    const tags = modelTags({
      isDefault: true,
      vision: true,
      free: false,
      inUse: ["Text generation"],
    });
    expect(tags.map((tag) => tag.label)).toEqual(["Default", "In use", "Vision"]);
    expect(tags[0]?.title).toBeUndefined();
    expect(tags[1]?.title).toBe("Used for: Text generation");
    expect(modelTags({ isDefault: false, vision: false, free: false, inUse: [] })).toEqual([]);
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
