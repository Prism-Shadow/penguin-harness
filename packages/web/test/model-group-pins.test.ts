/**
 * Which model groups stay in view on the models page (model-group-pins.ts), as the sidebar nav's
 * pinned and collapsible entries do.
 *
 * - Given a first visit, TokenDance, Penguin Go, DeepSeek, OpenRouter, Google, OpenAI and
 *   Anthropic show, in the page's order, and every other group — a user-defined one included —
 *   sits folded under one bar that counts them.
 * - Given the user pins or unpins a group, the choice is stored as a difference from the default
 *   set only, survives a reload, and a choice back to the default leaves nothing stored.
 * - Given stored choices that are malformed, or storage that throws, the defaults apply.
 * - Given a search, every matching group shows, the pinned first, and there is no bar.
 * - Given the bar opened, the folded groups show below it; the fold is remembered, folded by
 *   default, and a storage that throws reads as folded.
 * - Given every group pinned, there is no bar.
 * - Given a group dropped on a header in the other area, it moves into that area; dropped within
 *   its own, nothing changes.
 */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";
import {
  initialModelGroupPins,
  initialModelGroupsFolded,
  modelGroupLayout,
  pinsAfterDrop,
  storeModelGroupPins,
  storeModelGroupsFolded,
  withModelGroupPinned,
} from "../src/features/models/model-group-pins";
import type { ModelGroupPins } from "../src/features/models/model-group-pins";
import { memoryStorage, blockedStorage } from "./helpers/storage";

/** Every built-in group in the catalog's order, then a user-defined one. */
const GROUPS = [...MODEL_PROVIDERS.map((p) => p.id), "my-ollama"];
const id = (g: string) => g;

const layout = (pins: ModelGroupPins, opts: { searching?: boolean; folded?: boolean } = {}) =>
  modelGroupLayout(GROUPS, id, pins, {
    searching: opts.searching ?? false,
    folded: opts.folded ?? true,
  });

/** What is on screen: the groups shown, then the folded ones while the bar is open. */
const visible = (l: ReturnType<typeof layout>) =>
  l.fold !== null && !l.fold.folded ? [...l.shown, ...l.fold.groups] : l.shown;

describe("a first visit", () => {
  it("shows the seven default groups in the page's order and folds the rest under the bar", () => {
    const first = layout(initialModelGroupPins(memoryStorage()), {
      folded: initialModelGroupsFolded(memoryStorage()),
    });
    expect(first.shown).toEqual([
      "tokendance",
      "penguin-go",
      "deepseek",
      "openrouter",
      "google",
      "openai",
      "anthropic",
    ]);
    expect(first.fold?.folded).toBe(true);
    // The bar counts what it holds: every other group, the user-defined one included.
    expect(first.fold?.groups).toHaveLength(GROUPS.length - 7);
    expect(first.fold?.groups).toContain("my-ollama");
    expect(first.fold?.groups).toContain("custom");
    expect(visible(first)).toEqual(first.shown);
  });
});

describe("pinning and unpinning a group", () => {
  it("stores only the differences from the default set, and they survive a reload", () => {
    const storage = memoryStorage();
    let pins = initialModelGroupPins(storage);
    pins = withModelGroupPinned(pins, "vllm", true);
    pins = withModelGroupPinned(pins, "deepseek", false);
    storeModelGroupPins(pins, storage);

    const reloaded = initialModelGroupPins(storage);
    expect(reloaded).toEqual({ vllm: true, deepseek: false });
    const after = layout(reloaded);
    expect(after.shown).toContain("vllm");
    expect(after.shown).not.toContain("deepseek");
    expect(after.fold?.groups).toContain("deepseek");
  });

  it("a choice back to the default leaves nothing stored for that group", () => {
    const pins = withModelGroupPinned({ vllm: true, deepseek: false }, "deepseek", true);
    expect(pins).toEqual({ vllm: true });
    expect(withModelGroupPinned(pins, "vllm", false)).toEqual({});
  });

  it("a pin that changes nothing hands back the same choices, so nothing is written", () => {
    const pins: ModelGroupPins = { vllm: true };
    expect(withModelGroupPinned(pins, "vllm", true)).toBe(pins);
    expect(withModelGroupPinned(pins, "openai", true)).toBe(pins);
  });

  it("malformed choices or a throwing storage read as the defaults", () => {
    for (const raw of ["not json", "[]", "null", '"vllm"']) {
      const storage = memoryStorage({ "penguin.modelsPinnedGroups": raw });
      expect(initialModelGroupPins(storage), raw).toEqual({});
    }
    const mixed = memoryStorage({
      "penguin.modelsPinnedGroups": JSON.stringify({ vllm: true, custom: "yes", "": true }),
    });
    expect(initialModelGroupPins(mixed)).toEqual({ vllm: true });
    expect(initialModelGroupPins(blockedStorage())).toEqual({});
    expect(() => storeModelGroupPins({ vllm: true }, blockedStorage())).not.toThrow();
  });
});

describe("a search", () => {
  it("shows every matching group, the pinned first, and no bar", () => {
    const matches = ["vllm", "openai", "my-ollama", "deepseek"];
    const searched = modelGroupLayout(matches, id, {}, { searching: true, folded: true });
    expect(searched.fold).toBeNull();
    expect(searched.shown).toEqual(["openai", "deepseek", "vllm", "my-ollama"]);
  });
});

describe("the fold", () => {
  it("opened, shows the folded groups below the pinned ones", () => {
    const open = layout({}, { folded: false });
    expect(visible(open)).toEqual([...open.shown, ...open.fold!.groups]);
    expect(visible(open)).toHaveLength(GROUPS.length);
  });

  it("is remembered, folded by default, and folded when storage throws", () => {
    const storage = memoryStorage();
    expect(initialModelGroupsFolded(storage)).toBe(true);
    storeModelGroupsFolded(false, storage);
    expect(initialModelGroupsFolded(storage)).toBe(false);
    storeModelGroupsFolded(true, storage);
    expect(initialModelGroupsFolded(storage)).toBe(true);
    expect(initialModelGroupsFolded(blockedStorage())).toBe(true);
  });

  it("has no bar when every group is pinned", () => {
    const all = Object.fromEntries(GROUPS.map((g) => [g, true]));
    const pinnedAll = layout(all);
    expect(pinnedAll.fold).toBeNull();
    expect(pinnedAll.shown).toEqual(GROUPS);
  });
});

describe("dropping a group on another group's header", () => {
  it("moves it into the target's area", () => {
    // DeepSeek (pinned) onto vLLM (collapsible): it folds away.
    expect(pinsAfterDrop({}, "deepseek", "vllm")).toEqual({ deepseek: false });
    // vLLM (collapsible) onto OpenAI (pinned): it stays in view.
    expect(pinsAfterDrop({}, "vllm", "openai")).toEqual({ vllm: true });
  });

  it("within its own area changes nothing", () => {
    const pins: ModelGroupPins = { vllm: true };
    expect(pinsAfterDrop(pins, "openai", "deepseek")).toBe(pins);
    expect(pinsAfterDrop(pins, "custom", "minimax")).toBe(pins);
  });
});
