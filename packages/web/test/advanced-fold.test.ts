/**
 * A settings card's Advanced fold (features/settings/advanced-fold.tsx).
 *
 * - Given a card with advanced fields, the fold starts collapsed: its button says so through
 *   aria-expanded, and the panel it controls is in the DOM but hidden.
 * - Opened, the same panel shows.
 */
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
  it("starts collapsed, with its panel in the DOM and hidden", () => {
    const html = render();
    const button = /<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/.exec(html);
    expect(button).not.toBeNull();
    const panel = new RegExp(`<div id="${button![1]}"[^>]*>`).exec(html);
    expect(panel?.[0]).toContain("hidden");
    expect(html).toContain("masked paths");
  });

  it("shows the panel when open", () => {
    const html = render(true);
    expect(html).toContain('aria-expanded="true"');
    const id = /aria-controls="([^"]+)"/.exec(html)![1];
    expect(new RegExp(`<div id="${id}"[^>]*>`).exec(html)?.[0]).not.toContain("hidden");
  });
});
