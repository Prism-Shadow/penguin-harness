/**
 * The Project operations a Model library entry offers (features/models/model-operations.tsx).
 *
 * - A model lists the tool bindings the enabled plugins declare and it can serve, in the server's
 *   order and language, marking the one the Project uses it for.
 * - The card's mark names the operations the model is in use for, and is absent otherwise.
 * - In the dialog an owner gets a short action on every other operation; a member sees only what
 *   is already assigned, with no action.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolBinding } from "../src/api/tool-types";
import {
  ModelInUseMark,
  ModelOperationsBlock,
  modelOperations,
} from "../src/features/models/model-operations";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const river = { provider: "river", modelId: "voice" };
const lake = { provider: "lake", modelId: "voice" };

const bindings: ToolBinding[] = [
  {
    key: "s2t",
    package: "@example/voice",
    title: { en: "Meeting notes", zh: "会议记录" },
    model: river,
    candidates: [river, lake],
  },
  {
    key: "t2s",
    package: "@example/voice",
    title: { en: "Narration", zh: "旁白" },
    candidates: [river],
  },
];

afterEach(() => setActiveStrings(zh));

describe("the operations a model offers", () => {
  it("lists the contributed operations it can serve, marking the one it is in use for", () => {
    expect(modelOperations(bindings, river, "en")).toEqual([
      { key: "s2t", title: "Meeting notes", current: true },
      { key: "t2s", title: "Narration", current: false },
    ]);
    expect(modelOperations(bindings, lake, "zh")).toEqual([
      { key: "s2t", title: "会议记录", current: false },
    ]);
    expect(modelOperations(bindings, { provider: "sea", modelId: "voice" }, "en")).toEqual([]);
    expect(modelOperations(null, river, "en")).toEqual([]);
  });

  it("marks a card only for the operations the model is in use for", () => {
    setActiveStrings(en);
    const mark = (model: typeof river) =>
      renderToStaticMarkup(
        createElement(ModelInUseMark, { operations: modelOperations(bindings, model, "en") }),
      );
    expect(mark(river)).toContain('aria-label="In use: Meeting notes"');
    expect(mark(lake)).toBe("");
  });

  it("gives an owner an action on each other operation and a member only what is assigned", () => {
    setActiveStrings(en);
    const block = (canEdit: boolean) =>
      renderToStaticMarkup(
        createElement(ModelOperationsBlock, {
          operations: modelOperations(bindings, river, "en"),
          canEdit,
          isDisabled: () => false,
          onUse: () => {},
        }),
      );
    const owner = block(true);
    expect(owner).toContain("Meeting notes");
    expect(owner).toContain("In use");
    expect(owner).toContain("Narration");
    expect(owner.match(/<button/g)).toHaveLength(1);
    const member = block(false);
    expect(member).toContain("Meeting notes");
    expect(member).not.toContain("Narration");
    expect(member).not.toContain("<button");
  });
});
