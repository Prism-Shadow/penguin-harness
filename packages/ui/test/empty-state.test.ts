/**
 * The empty state: the caller's words in the muted inks, an optional action, and the dashed slot
 * form that SettingsEmpty is.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EmptyState, SettingsEmpty } from "../src/components/feedback/empty-state/empty-state";
import { classTokens, renderStatic } from "../src/testing";

describe("EmptyState", () => {
  it("shows the caller's title and description in the muted ink, and no frame", () => {
    const html = renderStatic(
      createElement(EmptyState, { title: "No sessions yet", description: "Send a message." }),
    );
    expect(html).toContain(">No sessions yet</p>");
    expect(html).toContain(">Send a message.</p>");
    const tokens = classTokens(html);
    expect(tokens).toContain("text-fg-muted");
    expect(tokens).not.toContain("border-dashed");
    expect(html).not.toMatch(/gray-|dark:/);
  });

  it("renders the action only when given one", () => {
    expect(renderStatic(createElement(EmptyState, { title: "Empty" }))).not.toContain("mt-2");
    const html = renderStatic(
      createElement(EmptyState, {
        title: "Empty",
        action: createElement("button", { type: "button" }, "Create"),
      }),
    );
    expect(html).toContain('<button type="button">Create</button>');
  });

  it("draws the slot form in a dashed frame, its message on the small subtle rung", () => {
    const html = renderStatic(createElement(EmptyState, { title: "Nothing here", dashed: true }));
    expect(classTokens(html)).toEqual(
      expect.arrayContaining([
        "border",
        "border-dashed",
        "border-line",
        "min-h-24",
        "text-xs",
        "text-fg-subtle",
      ]),
    );
  });
});

describe("SettingsEmpty", () => {
  it("is the dashed slot form holding its one sentence", () => {
    expect(renderStatic(createElement(SettingsEmpty, { children: "No servers yet." }))).toBe(
      renderStatic(createElement(EmptyState, { title: "No servers yet.", dashed: true })),
    );
  });
});
