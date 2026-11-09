/**
 * Link: the theme's link colour, underlined in a sentence and on hover when it stands alone, and
 * an external link that opens isolated in a new tab behind the external-link glyph.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Link } from "../src/components/actions/link/link";
import { ICONS } from "../src/components/icons/icons";
import { renderStatic } from "../src/testing";

describe("Link", () => {
  it("stays in the tab by default", () => {
    const html = renderStatic(createElement(Link, { href: "/docs" }, "the docs"));
    expect(html).toMatch(/^<a href="\/docs" /);
    expect(html).not.toContain("target=");
    expect(html).not.toContain("<svg");
  });

  it("opens an external link isolated in a new tab, after the text and a decorative glyph", () => {
    for (const variant of ["inline", "standalone"] as const) {
      const html = renderStatic(
        createElement(Link, { href: "https://example.com", external: true, variant }, "Releases"),
      );
      expect(html).toContain('target="_blank" rel="noopener noreferrer"');
      expect(html).toContain(`d="${ICONS.externalLink}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html.indexOf("Releases")).toBeLessThan(html.indexOf("<svg"));
    }
  });

  it("passes the caller's anchor props and layout classes through", () => {
    const html = renderStatic(
      createElement(
        Link,
        { href: "/keys", "aria-label": "Manage keys for Acme", className: "shrink-0 text-xs" },
        "Manage keys",
      ),
    );
    expect(html).toContain('aria-label="Manage keys for Acme"');
  });
});
