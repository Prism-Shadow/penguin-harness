/**
 * Card and CardHeader: the box is the `ui-frame` host on token colours, and the header takes its
 * shape from the card's padding — a title row inside a padded card, the frame's ruled `head` slot
 * across a flush one.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Card, CardHeader } from "../src/components/layout/card/card";
import { classTokens, renderStatic } from "../src/testing";

const header = createElement(CardHeader, {
  title: "Spend",
  info: "What the organization spent this month.",
  actions: createElement("button", { type: "button" }, "Export"),
});

describe("Card", () => {
  it("is a frame on the surface, padded by default", () => {
    const html = renderStatic(createElement(Card, null, "body"));
    expect(html).toMatch(/^<div class="ui-frame /);
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["border", "border-line", "bg-surface", "rounded-md", "p-3"]),
    );
    expect(html).not.toMatch(/gray-|dark:/);
  });

  it("takes each padding, clipping its rows when flush", () => {
    expect(classTokens(renderStatic(createElement(Card, { padding: "md" })))).toContain("p-4");
    const flush = classTokens(renderStatic(createElement(Card, { padding: "none" })));
    expect(flush).toContain("overflow-hidden");
    expect(flush.filter((t) => /^p-/.test(t))).toEqual([]);
    expect(renderStatic(createElement(Card, { as: "section" }))).toMatch(/^<section /);
  });
});

describe("CardHeader", () => {
  it("titles the card with a heading and its trigger, then the actions", () => {
    const html = renderStatic(createElement(Card, null, header));
    expect(html).toMatch(/<h3 class="[^"]*text-fg-muted[^"]*">Spend<button/);
    expect(html).toContain('aria-label="More info: Spend"');
    expect(html.indexOf("Spend")).toBeLessThan(html.indexOf("Export"));
    expect(
      renderStatic(createElement(Card, null, createElement(CardHeader, { title: "T", level: 2 }))),
    ).toContain("<h2");
  });

  it("is a title row in a padded card, and the frame's head slot across a flush one", () => {
    const padded = renderStatic(createElement(Card, null, header));
    expect(padded).toMatch(/<div class="[^"]*\bmb-2\b/);
    expect(padded).not.toContain("data-slot");
    const flush = renderStatic(createElement(Card, { padding: "none" }, header));
    expect(flush).toMatch(/data-slot="head" class="[^"]*\bborder-b border-line-muted px-3 py-2\b/);
  });
});
