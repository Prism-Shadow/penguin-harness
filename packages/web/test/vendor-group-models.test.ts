/**
 * A vendor group carries the built-in catalog and nothing else.
 *
 * Its entries persist no `client_type`, so MMSP places each one by the vendor family its
 * model id begins with; an id of no known family is a model that never starts. The page
 * therefore offers no add-model entry point on such a group, and marks a row that cannot route
 * with the way out: moving it into a custom group, where a protocol can be picked or detected.
 * A protocol set on the group (its settings) routes its models too, so the card judges the
 * protocol a row is actually used with.
 *
 * vitest runs node-only here, so the card is rendered to static markup and the group header's
 * add entry point is checked through the action set group-header.ts decides (the header lives
 * inside the page component and needs a fetch, a Project and localStorage).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MODEL_PROVIDERS,
  isAddableGroup,
  isVendorGroup,
  unroutableVendorModel,
} from "@prismshadow/penguin-core/model-catalog";
import { groupHeaderActions } from "../src/features/models/group-header";
import { ModelCard, unroutableFix } from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";
import { S, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const noop = () => {};

const row = (patch: Partial<RowState>): RowState => ({
  provider: "deepseek",
  modelId: "deepseek-v4-pro",
  original: null,
  vision: true,
  contextWindow: "128000",
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
  ...patch,
});

/** Owner by default: both ways out are offered, so a test asserting one is absent means it. */
const render = (patch: Partial<RowState>, owner = true) =>
  renderToStaticMarkup(
    createElement(ModelCard, {
      row: row(patch),
      currency: "USD" as const,
      isDefault: false,
      isVisionModel: false,
      hourTick: 0,
      onOpen: noop,
      onMoveToCustom: owner ? noop : undefined,
    }),
  );

/** Not in the catalog: added by hand into a group that routes by id. */
const HAND_ADDED = { modelId: "qwen/qwen3.8-flash-next" };

describe("unroutableFix", () => {
  it("sends a hand-added id to a custom group", () => {
    expect(unroutableFix("deepseek", "qwen/qwen3.8-flash-next", "")).toBe("custom");
  });

  it("judges the protocol the row is used with, a group's included", () => {
    // DeepSeek told to speak Chat Completions in its group settings routes any id.
    expect(unroutableFix("deepseek", "qwen/qwen3.8-flash-next", "openai-chat")).toBeNull();
  });

  it("has nothing to say about a routable row, a blank id, or a group that picks its protocol", () => {
    expect(unroutableFix("deepseek", "deepseek-v4-pro", "")).toBeNull();
    // An id outside the catalog routes all the same when it begins with the vendor's family.
    expect(unroutableFix("deepseek", "deepseek-flash-0731", "")).toBeNull();
    expect(unroutableFix("deepseek", "  ", "")).toBeNull();
    expect(unroutableFix("custom", "qwen/qwen3.8-flash-next", "openai-chat")).toBeNull();
    expect(unroutableFix("openrouter", "qwen/qwen3.8-flash-next", "")).toBeNull();
    expect(unroutableFix("my-own-group", "qwen/qwen3.8-flash-next", "")).toBeNull();
  });
});

describe("a card for a row its vendor group cannot route", () => {
  it("tells a hand-added model's owner to move it, and offers that action", () => {
    const html = render(HAND_ADDED);
    expect(html).toContain(S.models.vendorRowUnroutable);
    expect(html).toContain(S.models.moveToCustomGroup);
  });

  it("still warns a member, who has no config write and so is offered no action", () => {
    const handAdded = render(HAND_ADDED, false);
    expect(handAdded).toContain(S.models.vendorRowUnroutable);
    expect(handAdded).not.toContain(S.models.moveToCustomGroup);
  });

  it("leaves a routable row, and every row outside a vendor group, unmarked", () => {
    // Routable by its own id, and routable by a pin MMSP has.
    const byId = render({ modelId: "deepseek-v4-pro" });
    const byPin = render({ modelId: "deepseek-flash", clientType: "deepseek-official" });
    // The same unplaceable id in a group that decides the protocol itself.
    const inCustom = render({
      provider: "custom",
      modelId: "qwen/qwen3.8-flash-next",
      clientType: "openai-chat",
    });
    for (const html of [byId, byPin, inCustom]) {
      expect(html).not.toContain(S.models.vendorRowUnroutable);
    }
  });
});

describe("the ways the page can open the add-model dialog", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/models/models-page.tsx"),
    "utf8",
  );
  /** Every call that OPENS add mode (setAddingTo(null) closes it and is not one of these). */
  const openers = [...source.matchAll(/setAddingTo\((?!null\))([^)]*)\)/g)].map((m) => m[1]);

  it("are exactly three, none of which can name a vendor group", () => {
    // A fourth would be a new way into the state this change closed, so it has to be read
    // here rather than discovered as a bug report. The three: the "no models at all" empty
    // state, which opens custom; the group header's Add model action, which the header only
    // carries where group-header.ts puts it; and a brand-new group, whose name is rejected
    // when it collides with a built-in id.
    expect([...openers].sort()).toEqual(['"custom"', "group.provider.id", "name"].sort());
    expect(source).toContain('case "addModel":');
    expect(source).toContain("MODEL_PROVIDERS.some((p) => p.id === trimmed)");
    for (const p of MODEL_PROVIDERS.filter((provider) => isVendorGroup(provider.id))) {
      const actions = groupHeaderActions(p, {
        isOwner: true,
        keyStored: true,
        balancePinned: false,
      });
      expect(actions, p.id).not.toContain("addModel");
    }
  });

  it("leave the page's other group actions in place (only adding a model is closed off)", () => {
    // A vendor group still takes a speed test and its settings, where its group key is set —
    // the rule is about what may be written into the group, not about reaching it.
    expect(source).toContain("setSpeedFor(group.provider.id)");
    expect(source).toContain("setSettingsFor(group.provider.id)");
    for (const p of MODEL_PROVIDERS.filter((provider) => isVendorGroup(provider.id))) {
      const actions = groupHeaderActions(p, {
        isOwner: true,
        keyStored: true,
        balancePinned: false,
      });
      expect(actions, p.id).toContain("speedTest");
      expect(actions, p.id).toContain("settings");
    }
  });
});

describe("the predicate the page reads", () => {
  it("names the groups that route by model id alone", () => {
    expect(isVendorGroup("deepseek")).toBe(true);
    expect(isVendorGroup("custom")).toBe(false);
    expect(isVendorGroup("openrouter")).toBe(false);
    expect(unroutableVendorModel("deepseek", "qwen/qwen3.8-flash-next")).toBe(true);
    expect(unroutableVendorModel("custom", "qwen/qwen3.8-flash-next")).toBe(false);
    // Whether a model may be added at all is the wider rule: most gateways take none either,
    // while the three that list a fraction of what they serve do.
    expect(isAddableGroup("deepseek")).toBe(false);
    expect(isAddableGroup("fireworks")).toBe(false);
    expect(isAddableGroup("openrouter")).toBe(true);
    expect(isAddableGroup("custom")).toBe(true);
  });
});

describe("copy", () => {
  it("carries the warning and its way out in both dictionaries", () => {
    for (const dict of [zh, en]) {
      const m = dict.models;
      for (const text of [
        m.vendorRowUnroutable,
        m.moveToCustomGroup,
        m.testNotRoutable,
        // The server's refusal is localized by code, not by relaying its English message.
        dict.errors.byCode.model_not_routable,
      ]) {
        expect(text.length).toBeGreaterThan(0);
      }
    }
    expect(zh.models.moveToCustomGroup).not.toBe(en.models.moveToCustomGroup);
  });
});
