/**
 * The empty state: the caller's words in the muted inks, an optional action, and the dashed slot
 * form that SettingsEmpty is.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EmptyState, SettingsEmpty } from "../src/components/feedback/empty-state/empty-state";
import { renderStatic } from "../src/testing";

describe("EmptyState", () => {
  it("shows the caller's title and description", () => {
    const html = renderStatic(
      createElement(EmptyState, { title: "No sessions yet", description: "Send a message." }),
    );
    expect(html).toContain(">No sessions yet</p>");
    expect(html).toContain(">Send a message.</p>");
  });

  it("renders the action only when given one", () => {
    const html = renderStatic(
      createElement(EmptyState, {
        title: "Empty",
        action: createElement("button", { type: "button" }, "Create"),
      }),
    );
    expect(html).toContain('<button type="button">Create</button>');
  });
});

describe("SettingsEmpty", () => {
  it("is the dashed slot form holding its one sentence", () => {
    expect(renderStatic(createElement(SettingsEmpty, { children: "No servers yet." }))).toBe(
      renderStatic(createElement(EmptyState, { title: "No servers yet.", dashed: true })),
    );
  });
});
