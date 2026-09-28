/**
 * The root font size is real, and only the previews follow it. The gallery's vitest is node-only,
 * so the proof is the source contract, each link of it: the size step writes `<html
 * style="font-size">` through the package's own `applyThemeAttributes` (which the app's boot
 * script and theme provider also use), the three tiers are 16 / 18 / 20 px and the top bar
 * labels them so, the framed embeds and `/embed` take the same `tier=` on their own roots, and
 * the chrome's stylesheet has no rem or em in it — a px-sized chrome cannot move when the root
 * does, while every rem in a composition does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyThemeAttributes, FONT_SCALE_PX } from "@prismshadow/penguin-ui/boot";
import { TIER_PX } from "../src/lib/themes";
import { DEFAULT_STATE, formatGalleryQuery, TIERS } from "../src/lib/url-state";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** A root as `applyThemeAttributes` sees it: a class list, a dataset and an inline style. */
function fakeRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle: (name: string, force?: boolean) => {
        if (force ?? !classes.has(name)) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
    },
    dataset: {} as Record<string, string | undefined>,
    style: {} as Record<string, string>,
  } as unknown as HTMLElement;
}

describe("the root font size", () => {
  it("has three real steps, 16 / 18 / 20 px, labelled by their pixel size", () => {
    expect(TIERS).toEqual(["sm", "md", "lg"]);
    expect(TIERS.map((tier) => TIER_PX[tier])).toEqual([16, 18, 20]);
    for (const tier of TIERS) expect(FONT_SCALE_PX[tier]).toBe(`${TIER_PX[tier]}px`);
    // The top bar prints the size, not the tier id.
    expect(read("../src/chrome/topbar.tsx")).toMatch(/label: `\$\{TIER_PX\[tier\]\}px`/);
  });

  it("is written onto <html> by the package's own contract, per step", () => {
    const root = fakeRoot();
    for (const tier of TIERS) {
      applyThemeAttributes(root, { fontScale: tier });
      expect(root.style.fontSize).toBe(`${TIER_PX[tier]}px`);
    }
    // The provider applies the state's tier through that same function.
    const state = read("../src/state.tsx");
    expect(state).toMatch(/applyThemeAttributes\(root, \{[^}]*fontScale: state\.tier/s);
  });

  it("reaches every framed embed and /embed through `tier=` in their own URLs", () => {
    for (const tier of TIERS) {
      const query = formatGalleryQuery({ ...DEFAULT_STATE, tier }, { module: "conversation" });
      expect(query).toContain(`tier=${tier}`);
    }
    // The frames' src is the canonical query, never a hand-built one.
    expect(read("../src/chrome/compare.tsx")).toMatch(/\/embed\$\{formatGalleryQuery\(/);
  });

  it("never moves the chrome: chrome.css sets no rem or em length", () => {
    const css = read("../src/chrome.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const relative = [...css.matchAll(/-?\d*\.?\d+r?em\b/g)].map((m) => m[0]);
    expect(relative).toEqual([]);
    // The previews are the one place the root size may show, and they read the theme's own rem-based
    // body size rather than a chrome value.
    expect(css).toMatch(/\.g-preview \{[^}]*font-size: var\(--ui-text-body-size/s);
  });
});
