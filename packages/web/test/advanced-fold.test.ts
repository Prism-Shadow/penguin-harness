// The settings card's Advanced fold: collapsed by default, its panel in the DOM but hidden.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdvancedFold } from "../src/features/settings/advanced-fold";

const render = (defaultOpen?: boolean) =>
  renderToStaticMarkup(
    createElement(AdvancedFold, {
      ...(defaultOpen === undefined ? {} : { defaultOpen }),
      children: createElement("p", null, "masked paths"),
    }),
  );

describe("the Advanced fold", () => {
  it.each([
    [undefined, "false", true],
    [true, "true", false],
  ] as const)("defaultOpen %s: aria-expanded=%s, panel hidden: %s", (open, expanded, hidden) => {
    const html = render(open);
    const id = new RegExp(`aria-expanded="${expanded}"[^>]*aria-controls="([^"]+)"`).exec(html)![1];
    const panel = new RegExp(`<div id="${id}"[^>]*>`).exec(html)![0];
    expect(panel.includes("hidden")).toBe(hidden);
    expect(html).toContain("masked paths");
  });
});
