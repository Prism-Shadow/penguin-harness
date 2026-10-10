/**
 * The update mark: a decorative dot in the theme's news colour (not a tone), ringed in the
 * sidebar's fill on a chrome anchor, and the labelled pill that shares the badges' capsule.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  UPDATE_DOT_INLINE,
  UpdateDot,
  UpdatePill,
} from "../src/components/icons/update-dot/update-dot";
import { classTokens, renderStatic } from "../src/testing";

describe("UpdateDot", () => {
  it("is hidden decoration in the news colour, out of its anchor's layout and hit area", () => {
    const html = renderStatic(createElement(UpdateDot));
    expect(html).toContain('aria-hidden="true"');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["absolute", "pointer-events-none", "rounded-full", "bg-mark-new"]),
    );
    expect(html).not.toMatch(/tone-/);
  });

  it("rings a chrome anchor's dot in the sidebar's fill, and leaves an inline dot bare", () => {
    const chrome = classTokens(renderStatic(createElement(UpdateDot)));
    expect(chrome).toEqual(expect.arrayContaining(["border-2", "border-surface-muted"]));
    const inline = classTokens(renderStatic(createElement(UpdateDot, { size: "inline" })));
    expect(inline).not.toContain("border-2");
    expect(inline).toEqual(expect.arrayContaining(["h-1.5", "w-1.5"]));
  });

  it("takes the caller's placement, the corner overhang by default", () => {
    expect(renderStatic(createElement(UpdateDot))).toContain("-right-0.5 -top-0.5");
    expect(
      renderStatic(createElement(UpdateDot, { position: "right-2.5 top-1/2 -translate-y-1/2" })),
    ).toContain("right-2.5 top-1/2 -translate-y-1/2");
  });

  it("exports the in-flow fill with the same colour", () => {
    expect(UPDATE_DOT_INLINE.split(" ")).toEqual(
      expect.arrayContaining(["rounded-full", "bg-mark-new", "h-1.5", "w-1.5"]),
    );
  });
});

describe("UpdatePill", () => {
  it("is a real button in the danger tint and ink, on the badge's type and the pill radius", () => {
    const html = renderStatic(
      createElement(UpdatePill, { onClick: () => undefined, children: "Update available" }),
    );
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain(">Update available</button>");
    expect(classTokens(html)).toEqual(
      expect.arrayContaining([
        "bg-tone-danger-bg",
        "text-tone-danger-fg",
        "text-[length:var(--ui-badge-size)]",
        "leading-[var(--ui-badge-lh)]",
        "rounded-[var(--ui-radius-pill)]",
      ]),
    );
    expect(html).not.toContain("text-[11px]");
  });
});
