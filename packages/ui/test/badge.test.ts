/**
 * Badge and Count: every tone in three weights from the tone tokens, one geometry for all three,
 * the small rung and the theme's pill radius; a count in tabular figures that caps at `max`.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Badge, Count } from "../src/components/feedback/badge/badge";
import type { BadgeProps } from "../src/components/feedback/badge/badge";
import { TONES } from "../src/tokens";
import { classTokens, markupStructure, renderStatic } from "../src/testing";

const render = (props: Omit<BadgeProps, "children">, text = "failed") =>
  renderStatic(createElement(Badge, { ...props, children: text }));

describe("Badge", () => {
  it("is a neutral soft capsule by default", () => {
    const tokens = classTokens(render({}));
    expect(tokens).toEqual(
      expect.arrayContaining([
        "bg-tone-neutral-bg",
        "text-tone-neutral-fg",
        "text-xs",
        "font-semibold",
        "rounded-[var(--ui-radius-pill)]",
      ]),
    );
    expect(tokens).not.toContain("text-[11px]");
  });

  it("paints every tone's soft, outline and solid weights from its tokens", () => {
    for (const tone of TONES) {
      expect(classTokens(render({ tone }))).toEqual(
        expect.arrayContaining([`bg-tone-${tone}-bg`, `text-tone-${tone}-fg`]),
      );
      expect(classTokens(render({ tone, variant: "outline" }))).toEqual(
        expect.arrayContaining([`ring-tone-${tone}-line`, `text-tone-${tone}-fg`]),
      );
      expect(classTokens(render({ tone, variant: "solid" }))).toEqual(
        expect.arrayContaining([`bg-tone-${tone}-emphasis`, `text-tone-${tone}-emphasis-fg`]),
      );
    }
  });

  it("never pairs a tone's tint with its own line on one box", () => {
    for (const tone of TONES) {
      for (const variant of ["soft", "outline", "solid"] as const) {
        const tokens = classTokens(render({ tone, variant }));
        const tinted = tokens.includes(`bg-tone-${tone}-bg`);
        const lined = tokens.some((t) => t.startsWith(`border-tone-${tone}-`));
        expect(tinted && lined, `${tone} ${variant}`).toBe(false);
      }
    }
  });

  it("keeps one geometry across the three weights, so a mixed row stays aligned", () => {
    const geometry = (variant: "soft" | "outline" | "solid") =>
      classTokens(render({ tone: "danger", variant })).filter((t) =>
        /^(?:p[xy]?-|border$|text-xs$|rounded)/.test(t),
      );
    expect(geometry("outline")).toEqual(geometry("soft"));
    expect(geometry("solid")).toEqual(geometry("soft"));
    expect(markupStructure(render({ variant: "solid" }))).toBe(markupStructure(render({})));
  });

  it("takes a tighter padding at sm", () => {
    expect(classTokens(render({}))).toEqual(expect.arrayContaining(["px-2", "py-0.5"]));
    expect(classTokens(render({ size: "sm" }))).toEqual(
      expect.arrayContaining(["px-1.5", "py-px"]),
    );
  });

  it("carries the caller's words as its content", () => {
    expect(render({ tone: "success" }, "running")).toContain(">running</span>");
  });
});

describe("Count", () => {
  it("sets its number in tabular figures", () => {
    const html = renderStatic(createElement(Count, { n: 12 }));
    expect(html).toContain(">12</span>");
    expect(classTokens(html)).toContain("tabular-nums");
  });

  it("caps at max with a plus, and shows the number itself up to it", () => {
    expect(renderStatic(createElement(Count, { n: 120, max: 99 }))).toContain(">99+</span>");
    expect(renderStatic(createElement(Count, { n: 99, max: 99 }))).toContain(">99</span>");
  });
});
