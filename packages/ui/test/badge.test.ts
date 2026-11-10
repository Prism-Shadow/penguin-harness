/**
 * Badge and Count: every tone in three weights from the tone tokens, one geometry for all three,
 * the theme's pill radius; the rest of a tag's look — its type size and line-height among it —
 * from the badge tokens; a count in tabular figures that caps at `max`.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Badge, Count } from "../src/components/feedback/badge/badge";
import type { BadgeProps } from "../src/components/feedback/badge/badge";
import { INITIAL_THEME_ID, THEME_IDS, THEME_MODES, TONES } from "../src/tokens";
import type { ThemeId, ThemeModeName } from "../src/tokens";
import {
  analyzePack,
  classTokens,
  markupStructure,
  renderStatic,
  resolveThemeValue,
} from "../src/testing";

/** A token as a theme resolves it in a mode: its own value, or the base's it leaves the name to. */
const BASE = analyzePack(INITIAL_THEME_ID);
const valueIn = (id: ThemeId, mode: ThemeModeName, name: string) =>
  resolveThemeValue(name, mode, analyzePack(id), BASE) ?? undefined;

const render = (props: Omit<BadgeProps, "children">, text = "failed") =>
  renderStatic(createElement(Badge, { ...props, children: text }));

describe("Badge", () => {
  it("no theme pairs a soft tag's tone line with a tint", () => {
    // Where the ring has a width, the tone's tint must be absent: a tint and its own line on one
    // tag is the doubled edge the outline weight exists to avoid.
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        if (valueIn(id, mode, "--ui-badge-soft-ring") === "0px") continue;
        for (const tone of TONES) {
          expect(valueIn(id, mode, `--ui-tone-${tone}-bg`), `${id} ${mode} ${tone}`).toBe(
            "transparent",
          );
        }
      }
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

  it("is set under the theme's small text, on a fixed line, in every theme", () => {
    // A tag reads as a mark beside its row's text, not as more of it: every theme sets it below
    // its small rung, and on a line-height of its own so its height does not follow the row's.
    const rem = (value: string | undefined) => /^(\d*\.?\d+)rem$/.exec(value ?? "")?.[1];
    for (const id of THEME_IDS) {
      const size = rem(valueIn(id, "light", "--ui-badge-size"));
      const small = rem(valueIn(id, "light", "--ui-text-small-size"));
      expect(size, `${id} --ui-badge-size is a rem length`).toBeDefined();
      expect(small, `${id} --ui-text-small-size is a rem length`).toBeDefined();
      expect(Number(size), id).toBeLessThan(Number(small));
      expect(
        rem(valueIn(id, "light", "--ui-badge-lh")),
        `${id} --ui-badge-lh is a rem length`,
      ).toBeDefined();
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
  it("shows its number", () => {
    const html = renderStatic(createElement(Count, { n: 12 }));
    expect(html).toContain(">12</span>");
  });

  it("caps at max with a plus, and shows the number itself up to it", () => {
    expect(renderStatic(createElement(Count, { n: 120, max: 99 }))).toContain(">99+</span>");
    expect(renderStatic(createElement(Count, { n: 99, max: 99 }))).toContain(">99</span>");
  });
});
