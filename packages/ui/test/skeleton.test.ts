/**
 * The loading placeholders: hidden pulsing blocks on the line fill, a list of row-height blocks,
 * and a card in the real card's border and surface whose padding the caller may replace.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Skeleton, SkeletonCard, SkeletonList } from "../src/components/feedback/skeleton/skeleton";
import { classTokens, renderStatic } from "../src/testing";

describe("Skeleton", () => {
  it("is a hidden pulsing block on the line fill, a text line by default", () => {
    const html = renderStatic(createElement(Skeleton));
    expect(html).toContain('aria-hidden="true"');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["animate-pulse", "bg-line", "rounded-sm", "h-4", "w-full"]),
    );
    expect(html).not.toMatch(/gray-|dark:/);
  });

  it("takes the caller's size in place of the default line", () => {
    const tokens = classTokens(renderStatic(createElement(Skeleton, { className: "h-6 w-28" })));
    expect(tokens).toEqual(expect.arrayContaining(["h-6", "w-28"]));
    expect(tokens).not.toContain("h-4");
  });
});

describe("SkeletonList", () => {
  it("draws the requested number of row-height blocks, three by default", () => {
    const blocks = (html: string) => html.match(/animate-pulse/g)?.length ?? 0;
    expect(blocks(renderStatic(createElement(SkeletonList)))).toBe(3);
    expect(blocks(renderStatic(createElement(SkeletonList, { rows: 5 })))).toBe(5);
    expect(classTokens(renderStatic(createElement(SkeletonList)))).toContain("h-8");
  });
});

describe("SkeletonCard", () => {
  it("stands in the real card's border and surface, with a three-line default body", () => {
    const html = renderStatic(createElement(SkeletonCard));
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["rounded-md", "border", "border-line", "bg-surface", "p-4"]),
    );
    expect(html.match(/animate-pulse/g)).toHaveLength(3);
  });

  it("lets the caller's class replace the padding outright, and its children the body", () => {
    const html = renderStatic(
      createElement(SkeletonCard, { className: "p-6" }, createElement("span", null, "custom")),
    );
    const tokens = classTokens(html);
    expect(tokens).toContain("p-6");
    expect(tokens).not.toContain("p-4");
    expect(html).toContain("<span>custom</span>");
    expect(html).not.toContain("animate-pulse");
  });
});
