/**
 * Badge and Count: every tone in three weights from the tone tokens, one geometry for all three,
 * the theme's pill radius; the rest of a tag's look — its type size and line-height among it —
 * from the badge tokens; a count in tabular figures that caps at `max`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Badge, Count } from "../src/components/feedback/badge/badge";
import type { BadgeProps } from "../src/components/feedback/badge/badge";
import { THEME_IDS, THEME_MODES, TONES } from "../src/tokens";
import {
  analyzeThemeFile,
  classTokens,
  markupStructure,
  modeDeclarations,
  renderStatic,
} from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const render = (props: Omit<BadgeProps, "children">, text = "failed") =>
  renderStatic(createElement(Badge, { ...props, children: text }));

describe("Badge", () => {
  it("is a neutral soft capsule by default", () => {
    const tokens = classTokens(render({}));
    expect(tokens).toEqual(
      expect.arrayContaining([
        "bg-tone-neutral-bg",
        "text-tone-neutral-fg",
        "text-[length:var(--ui-badge-size)]",
        "leading-[var(--ui-badge-lh)]",
        "font-[number:var(--ui-badge-weight)]",
        "rounded-[var(--ui-radius-pill)]",
        "whitespace-nowrap",
      ]),
    );
    expect(tokens).not.toContain("text-[11px]");
  });

  it("draws a soft tag's tone line at the theme's width, and no theme pairs that rule with a tint", () => {
    for (const tone of TONES) {
      expect(classTokens(render({ tone }))).toEqual(
        expect.arrayContaining([
          "ring-[length:var(--ui-badge-soft-ring)]",
          "ring-inset",
          `ring-tone-${tone}-line`,
        ]),
      );
    }
    expect(classTokens(renderStatic(createElement(Count, { n: 3 })))).toEqual(
      expect.arrayContaining([
        "ring-[length:var(--ui-badge-soft-ring)]",
        "ring-tone-neutral-line",
        "px-1.5",
        "py-px",
      ]),
    );
    // Where the ring has a width, the tone's tint must be absent: a tint and its own line on one
    // tag is the doubled edge the outline weight exists to avoid.
    for (const id of THEME_IDS) {
      const css = readFileSync(join(SRC_DIR, "themes", `${id}.css`), "utf8");
      const theme = analyzeThemeFile(css, id);
      for (const mode of THEME_MODES) {
        const values = modeDeclarations(theme, mode);
        if (values.get("--ui-badge-soft-ring") === "0px") continue;
        for (const tone of TONES) {
          expect(values.get(`--ui-tone-${tone}-bg`), `${id} ${mode} ${tone}`).toBe("transparent");
        }
      }
    }
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
        /^(?:p[xy]?-|border$|text-\[length:|leading-|rounded)/.test(t),
      );
    expect(geometry("outline")).toEqual(geometry("soft"));
    expect(geometry("solid")).toEqual(geometry("soft"));
    expect(markupStructure(render({ variant: "solid" }))).toBe(markupStructure(render({})));
  });

  it("takes the theme's md padding, and a tighter one at sm", () => {
    expect(classTokens(render({}))).toContain("p-[var(--ui-badge-pad-md)]");
    expect(classTokens(render({ size: "sm" }))).toEqual(
      expect.arrayContaining(["px-1.5", "py-px"]),
    );
  });

  it("is set under the theme's small text, on a fixed line, in every theme", () => {
    // A tag reads as a mark beside its row's text, not as more of it: every theme sets it below
    // its small rung, and on a line-height of its own so its height does not follow the row's.
    const rem = (value: string | undefined) => /^(\d*\.?\d+)rem$/.exec(value ?? "")?.[1];
    for (const id of THEME_IDS) {
      const theme = analyzeThemeFile(
        readFileSync(join(SRC_DIR, "themes", `${id}.css`), "utf8"),
        id,
      );
      const values = modeDeclarations(theme, "light");
      const size = rem(values.get("--ui-badge-size"));
      const small = rem(values.get("--ui-text-small-size"));
      expect(size, `${id} --ui-badge-size is a rem length`).toBeDefined();
      expect(small, `${id} --ui-text-small-size is a rem length`).toBeDefined();
      expect(Number(size), id).toBeLessThan(Number(small));
      expect(rem(values.get("--ui-badge-lh")), `${id} --ui-badge-lh is a rem length`).toBeDefined();
    }
  });

  it("carries the caller's words as its content, and its tooltip when given one", () => {
    expect(render({ tone: "success" }, "running")).toContain(">running</span>");
    expect(render({})).not.toContain("data-tooltip");
    expect(render({ tooltip: "Ships with the build" })).toContain(
      'data-tooltip="Ships with the build"',
    );
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
