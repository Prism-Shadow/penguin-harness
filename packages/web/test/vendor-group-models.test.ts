/**
 * A vendor group carries the built-in catalog and nothing else.
 *
 * Its entries persist no `client_type`, so MMSP places each one by the vendor family its
 * model id begins with; an id of no known family is a model that never starts. The page
 * therefore marks a row that cannot route with the way out: moving it into a custom group,
 * where a protocol can be picked or detected. A protocol set on the group (its settings) routes
 * its models too, so the card judges the protocol a row is actually used with. (Which groups
 * offer an add-model entry point at all is the group header's, in model-group-header.test.ts.)
 *
 * - Given a hand-added id in a vendor group, the way out is a custom group; given a group
 *   protocol, a routable id, a blank id or a group that picks its protocol, there is none.
 * - Given such a row, its card warns, and offers the move to its owner only.
 * - Given a routable row, or a row outside a vendor group, its card is unmarked.
 *
 * vitest runs node-only here, so the card is rendered to static markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelCard, unroutableFix, type RowState } from "../src/features/models/models-page";
import { S } from "../src/lib/strings";

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
