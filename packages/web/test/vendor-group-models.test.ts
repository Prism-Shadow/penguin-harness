/**
 * A vendor group carries the built-in catalog and nothing else.
 *
 * Its entries persist no `client_type`, so AgentHub places each one by the spelling of the
 * model id alone; an id it cannot place is a model that never starts. The page therefore
 * offers no add-model entry point on such a group, and marks a row that cannot route — with
 * the fix that row's own shape calls for, since a built-in model whose stored entry lost its
 * protocol pin must not be told to move into a custom group.
 *
 * vitest runs node-only here, so the card is rendered to static markup and the group header —
 * which lives inside the page component and needs a fetch, a Project and localStorage — is
 * checked against the source of its own render condition.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isVendorGroup, unroutableVendorModel } from "@prismshadow/penguin-core/model-catalog";
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
      onSyncPresets: owner ? noop : undefined,
    }),
  );

/** In the catalog, and unroutable without the pin the catalog carries for it. */
const PRESET_MISSING_PIN = { modelId: "deepseek-flash" };
/** Not in the catalog: added by hand into a group that routes by id. */
const HAND_ADDED = { modelId: "qwen/qwen3.8-flash-next" };

describe("unroutableFix", () => {
  it("sends a built-in model to the preset sync, never to a custom group", () => {
    // deepseek-flash is the live case: AgentHub routes DeepSeek on a substring the released
    // id no longer carries, so the catalog pins deepseek-v4 — a Project written before that
    // pin holds the row without it.
    expect(unroutableFix("deepseek", "deepseek-flash", "")).toBe("sync");
    // With the pin the catalog carries today there is nothing wrong with the row at all.
    expect(unroutableFix("deepseek", "deepseek-flash", "deepseek-v4")).toBeNull();
  });

  it("sends a hand-added id to a custom group", () => {
    expect(unroutableFix("deepseek", "qwen/qwen3.8-flash-next", "")).toBe("custom");
  });

  it("judges the id currently in the field, not the one the row was loaded with", () => {
    // Retyping a preset's id makes it a different model; a sync would not touch it, so the
    // advice has to change with the field.
    expect(unroutableFix("deepseek", "deepseek-flash-0731", "")).toBe("custom");
  });

  it("has nothing to say about a routable row, a blank id, or a group that picks its protocol", () => {
    expect(unroutableFix("deepseek", "deepseek-v4-pro", "")).toBeNull();
    expect(unroutableFix("deepseek", "  ", "")).toBeNull();
    expect(unroutableFix("custom", "qwen/qwen3.8-flash-next", "openai-chat")).toBeNull();
    expect(unroutableFix("openrouter", "qwen/qwen3.8-flash-next", "")).toBeNull();
    expect(unroutableFix("my-own-group", "qwen/qwen3.8-flash-next", "")).toBeNull();
  });
});

describe("a card for a row its vendor group cannot route", () => {
  it("tells a built-in model's owner to sync presets, and offers that action", () => {
    const html = render(PRESET_MISSING_PIN);
    expect(html).toContain(S.models.vendorRowStalePin);
    expect(html).toContain(S.models.syncCatalog);
    // The wrong advice for this row: it is a built-in model, and it stays where it is.
    expect(html).not.toContain(S.models.moveToCustomGroup);
    expect(html).not.toContain(S.models.vendorRowUnroutable);
  });

  it("tells a hand-added model's owner to move it, and offers that action", () => {
    const html = render(HAND_ADDED);
    expect(html).toContain(S.models.vendorRowUnroutable);
    expect(html).toContain(S.models.moveToCustomGroup);
    expect(html).not.toContain(S.models.vendorRowStalePin);
    expect(html).not.toContain(S.models.syncCatalog);
  });

  it("still warns a member in both cases, who has no config write and so is offered no action", () => {
    const preset = render(PRESET_MISSING_PIN, false);
    expect(preset).toContain(S.models.vendorRowStalePin);
    expect(preset).not.toContain(S.models.syncCatalog);
    const handAdded = render(HAND_ADDED, false);
    expect(handAdded).toContain(S.models.vendorRowUnroutable);
    expect(handAdded).not.toContain(S.models.moveToCustomGroup);
  });

  it("leaves a routable row, and every row outside a vendor group, unmarked", () => {
    // Routable by its own id, and routable by the protocol its own preset pins.
    const byId = render({ modelId: "deepseek-v4-pro" });
    const byPin = render({ modelId: "deepseek-flash", clientType: "deepseek-v4" });
    // The same unplaceable id in a group that decides the protocol itself.
    const inCustom = render({
      provider: "custom",
      modelId: "qwen/qwen3.8-flash-next",
      clientType: "openai-chat",
    });
    for (const html of [byId, byPin, inCustom]) {
      expect(html).not.toContain(S.models.vendorRowUnroutable);
      expect(html).not.toContain(S.models.vendorRowStalePin);
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
    // state, which opens custom; the group header, guarded by the predicate; and a
    // brand-new group, whose name is rejected when it collides with a built-in id.
    expect(openers).toEqual(['"custom"', "group.provider.id", "name"]);
    expect(source).toContain("{isOwner && !isVendorGroup(group.provider.id) && (");
    expect(source).toContain("MODEL_PROVIDERS.some((p) => p.id === trimmed)");
  });

  it("leave the page's other group actions unguarded (only adding a model is closed off)", () => {
    // A vendor group still takes a bulk API key, a speed test and its console link — the rule
    // is about what may be written into the group, not about reaching it.
    expect(source).toContain("onClick={() => setGroupKeyFor(group.provider.id)}");
    expect(source).toContain("onClick={() => setSpeedFor(group.provider.id)}");
  });
});

describe("the predicate the page reads", () => {
  it("names the groups that route by model id alone", () => {
    expect(isVendorGroup("deepseek")).toBe(true);
    expect(isVendorGroup("custom")).toBe(false);
    expect(isVendorGroup("openrouter")).toBe(false);
    expect(unroutableVendorModel("deepseek", "qwen/qwen3.8-flash-next")).toBe(true);
    expect(unroutableVendorModel("custom", "qwen/qwen3.8-flash-next")).toBe(false);
  });
});

describe("copy", () => {
  it("carries both fixes in both dictionaries, and keeps them apart", () => {
    for (const dict of [zh, en]) {
      const m = dict.models;
      expect(m.vendorRowUnroutable).not.toBe(m.vendorRowStalePin);
      expect(m.testNotRoutable).not.toBe(m.testStalePin);
      // Neither message quotes the sync button's own label. The warning is shown to members
      // too, who have no such button, and the owner who does have one reads it right beside
      // the sentence. Checked per dictionary because a card only ever renders the active one.
      expect(m.vendorRowStalePin).not.toContain(m.syncCatalog);
      expect(m.testStalePin).not.toContain(m.syncCatalog);
      for (const text of [
        m.vendorRowUnroutable,
        m.vendorRowStalePin,
        m.moveToCustomGroup,
        m.testNotRoutable,
        m.testStalePin,
        // The server's refusal is localized by code, not by relaying its English message.
        dict.errors.byCode.model_not_routable,
      ]) {
        expect(text.length).toBeGreaterThan(0);
      }
    }
    expect(zh.models.moveToCustomGroup).not.toBe(en.models.moveToCustomGroup);
  });
});
