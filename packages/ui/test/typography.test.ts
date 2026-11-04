/**
 * Heading, Text and InlineCode: each reads its rung from the theme's tokens, the two hooks ride on
 * the roles that own them (the display title on a level-1 heading, the eyebrow on the eyebrow
 * role), the outline level survives a non-heading element, and the colours are tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Heading, InlineCode, Text } from "../src/components/content/typography/typography";
import type { HeadingLevel, TextVariant } from "../src/components/content/typography/typography";
import { classTokens, renderStatic } from "../src/testing";

const LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];

describe("Heading", () => {
  it("renders its level's element on its level's rung", () => {
    for (const level of LEVELS) {
      const html = renderStatic(createElement(Heading, { level }, "Title"));
      expect(html).toMatch(new RegExp(`^<h${level} class="`));
      const tokens = classTokens(html);
      for (const part of ["font", "size", "lh", "weight", "tracking", "transform"]) {
        expect(
          tokens.some((token) => token.includes(`--ui-h${level}-${part}`)),
          part,
        ).toBe(true);
      }
      const others = tokens.filter(
        (token) => /--ui-h[1-6]-/.test(token) && !token.includes(`--ui-h${level}-`),
      );
      expect(others).toEqual([]);
    }
  });

  it("carries the display hook on a level-1 display title only", () => {
    const display = renderStatic(createElement(Heading, { level: 1, display: true }, "Agents"));
    expect(classTokens(display)).toContain("ui-display");
    const plain = renderStatic(createElement(Heading, { level: 1 }, "Agents"));
    expect(classTokens(plain)).not.toContain("ui-display");
    const lower = renderStatic(createElement(Heading, { level: 2, display: true }, "Agents"));
    expect(classTokens(lower)).not.toContain("ui-display");
  });

  it("keeps the outline level on an element that is not a heading", () => {
    const html = renderStatic(createElement(Heading, { level: 3, as: "div" }, "Section"));
    expect(html).toMatch(/^<div role="heading" aria-level="3" class="/);
    const h = renderStatic(createElement(Heading, { level: 4, as: "h2" }, "Section"));
    expect(h).toMatch(/^<h2 /);
    expect(h).not.toContain("aria-level");
  });

  it("adds the caller's classes and attributes", () => {
    const html = renderStatic(
      createElement(Heading, { level: 2, id: "models", className: "truncate" }, "Models"),
    );
    expect(html).toContain('id="models"');
  });
});

describe("Text", () => {
  const render = (variant: TextVariant) => renderStatic(createElement(Text, { variant }, "words"));

  it("takes each role's element", () => {
    expect(render("body")).toMatch(/^<p /);
    expect(render("small")).toMatch(/^<p /);
    expect(render("mono")).toMatch(/^<span /);
    expect(render("label")).toMatch(/^<span /);
    expect(renderStatic(createElement(Text, { as: "dd" }, "x"))).toMatch(/^<dd /);
  });

  it("is a group label through the eyebrow hook, in the subtle ink", () => {
    expect(classTokens(render("eyebrow"))).toContain("ui-eyebrow");
  });
});

describe("InlineCode", () => {
  it("is a code span on the neutral chip, breaking long identifiers anywhere", () => {
    const html = renderStatic(createElement(InlineCode, null, "packages/ui/src/index.ts"));
    expect(html).toMatch(/^<code /);
  });
});
