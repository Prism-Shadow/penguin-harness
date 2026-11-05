/**
 * Card and CardHeader: the box is the `ui-frame` host on token colours, and the header takes its
 * shape from the card's padding — a title row inside a padded card, the frame's ruled `head` slot
 * across a flush one.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Card, CardHeader } from "../src/components/layout/card/card";
import { renderStatic } from "../src/testing";

const header = createElement(CardHeader, {
  title: "Spend",
  info: "What the organization spent this month.",
  actions: createElement("button", { type: "button" }, "Export"),
});

describe("Card", () => {
  it("draws its frame on the frame hook", () => {
    const html = renderStatic(createElement(Card, null, "body"));
    expect(html).toMatch(/^<div class="ui-frame /);
  });

  it("renders as the element it is given", () => {
    expect(renderStatic(createElement(Card, { as: "section" }))).toMatch(/^<section /);
  });
});

describe("CardHeader", () => {
  it("titles the card with a heading and its trigger, then the actions", () => {
    const html = renderStatic(createElement(Card, null, header));
    expect(html).toMatch(/<h3 class="[^"]*">Spend<button/);
    expect(html).toContain('aria-label="More info: Spend"');
    expect(html.indexOf("Spend")).toBeLessThan(html.indexOf("Export"));
    expect(
      renderStatic(createElement(Card, null, createElement(CardHeader, { title: "T", level: 2 }))),
    ).toContain("<h2");
  });

  it("is a title row in a card, and the frame's head slot across a flush one", () => {
    const padded = renderStatic(createElement(Card, null, header));
    expect(padded).not.toContain("data-slot");
    // The frame's head slot is the ui-frame hook's: the themes restyle a flush card's header by it.
    const flush = renderStatic(createElement(Card, { padding: "none" }, header));
    expect(flush).toContain('data-slot="head"');
  });
});
