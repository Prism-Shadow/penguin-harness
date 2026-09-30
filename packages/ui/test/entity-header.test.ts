/**
 * EntityHeader: the name is a heading on its level's rung (never the data face), with the mark
 * before it, the facts on its line, the description under it and the actions at the end.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EntityHeader } from "../src/components/layout/entity-header/entity-header";
import { classTokens, renderStatic } from "../src/testing";

describe("EntityHeader", () => {
  const html = renderStatic(
    createElement(
      EntityHeader,
      {
        media: createElement("img", { alt: "", src: "/logo.svg" }),
        name: "@penguinharness/goal",
        meta: "v0.2.9",
        description: "Keeps the agent on its goal.",
        actions: createElement("button", { type: "button" }, "Install"),
      },
      createElement("span", null, "stop"),
    ),
  );

  it("names the thing with a level-1 heading on its rung, not in mono", () => {
    expect(html).toMatch(/<h1 class="[^"]*--ui-h1-size[^"]*">@penguinharness\/goal<\/h1>/);
    expect(html).not.toContain("ui-display");
    expect(/<h1 class="([^"]*)"/.exec(html)![1]).not.toContain("font-mono");
  });

  it("lays out mark, name and meta, description, extra rows, then actions", () => {
    const order = ["<img", "<h1", "v0.2.9", "Keeps the agent", "stop", "Install"].map((part) =>
      html.indexOf(part),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(classTokens(html)).toEqual(expect.arrayContaining(["text-fg-muted", "text-fg-subtle"]));
  });

  it("takes a lower level inside a dialog", () => {
    expect(renderStatic(createElement(EntityHeader, { name: "Reviewer", level: 2 }))).toMatch(
      /<h2 class="[^"]*--ui-h2-size/,
    );
  });
});
