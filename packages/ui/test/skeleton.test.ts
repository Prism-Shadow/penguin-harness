/**
 * The loading placeholders: hidden pulsing blocks on the line fill, a list of row-height blocks,
 * and a card in the real card's border and surface whose padding the caller may replace.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Skeleton, SkeletonCard, SkeletonList } from "../src/components/feedback/skeleton/skeleton";
import { renderStatic } from "../src/testing";

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    const html = renderStatic(createElement(Skeleton));
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("SkeletonList", () => {
  it("draws the requested number of blocks, three by default", () => {
    const blocks = (html: string) => html.match(/animate-pulse/g)?.length ?? 0;
    expect(blocks(renderStatic(createElement(SkeletonList)))).toBe(3);
    expect(blocks(renderStatic(createElement(SkeletonList, { rows: 5 })))).toBe(5);
  });
});

describe("SkeletonCard", () => {
  it("stands in a card with a three-line default body", () => {
    const html = renderStatic(createElement(SkeletonCard));
    expect(html.match(/animate-pulse/g)).toHaveLength(3);
  });

  it("lets its children replace the body", () => {
    const html = renderStatic(
      createElement(SkeletonCard, { className: "p-6" }, createElement("span", null, "custom")),
    );
    expect(html).toContain("<span>custom</span>");
  });
});
