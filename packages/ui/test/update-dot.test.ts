/**
 * The update mark: a decorative dot in the theme's news colour (not a tone), ringed in the
 * sidebar's fill on a chrome anchor, and the labelled pill that shares the badges' capsule.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { UpdateDot, UpdatePill } from "../src/components/icons/update-dot/update-dot";
import { renderStatic } from "../src/testing";

describe("UpdateDot", () => {
  it("is hidden decoration", () => {
    const html = renderStatic(createElement(UpdateDot));
    expect(html).toContain('aria-hidden="true"');
  });

  it("takes the caller's placement", () => {
    expect(
      renderStatic(createElement(UpdateDot, { position: "right-2.5 top-1/2 -translate-y-1/2" })),
    ).toContain("right-2.5 top-1/2 -translate-y-1/2");
  });
});

describe("UpdatePill", () => {
  it("is a real button", () => {
    const html = renderStatic(
      createElement(UpdatePill, { onClick: () => undefined, children: "Update available" }),
    );
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain(">Update available</button>");
  });
});
