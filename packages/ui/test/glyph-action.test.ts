/**
 * GlyphAction (src/components/actions/glyph-action/glyph-action.tsx): a glyph that acts, alone,
 * named by its label.
 *
 * - Given an address, it is a link that opens in a new tab keeping no handle on this one, named
 *   by its label, which is also its tooltip.
 * - Given a press handler, it is a button, named by its label, which is also its tooltip.
 * - Either way the glyph says nothing to assistive technology: the name does.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { GlyphAction } from "../src/components/actions/glyph-action/glyph-action";
import { ICONS } from "../src/components/icons/icons";
import { renderStatic } from "../src/testing";

/** The tag and attributes of the markup's first element. */
function first(html: string): { tag: string; attrs: Map<string, string> } {
  const [, tag, open] = /^<(\w+)([^>]*)>/.exec(html)!;
  return {
    tag: tag!,
    attrs: new Map([...open!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k!, v!])),
  };
}

describe("GlyphAction", () => {
  it("is a link opening in a new tab with no opener, when it has an address", () => {
    const html = renderStatic(
      createElement(GlyphAction, {
        glyph: ICONS.globe,
        label: "Homepage",
        href: "https://example.com/plugin",
      }),
    );
    const { tag, attrs } = first(html);
    expect(tag).toBe("a");
    expect(attrs.get("href")).toBe("https://example.com/plugin");
    expect(attrs.get("target")).toBe("_blank");
    expect(attrs.get("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
    expect(attrs.get("aria-label")).toBe("Homepage");
    expect(attrs.get("data-tooltip")).toBe("Homepage");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("is a button named by its label, when it acts in place", () => {
    const html = renderStatic(
      createElement(GlyphAction, {
        glyph: ICONS.puzzle,
        label: "Installed by the Charts plugin",
        onClick: () => undefined,
      }),
    );
    const { tag, attrs } = first(html);
    expect(tag).toBe("button");
    expect(attrs.get("type")).toBe("button");
    expect(attrs.get("aria-label")).toBe("Installed by the Charts plugin");
    expect(attrs.get("data-tooltip")).toBe("Installed by the Charts plugin");
    expect(attrs.has("href")).toBe(false);
  });
});
