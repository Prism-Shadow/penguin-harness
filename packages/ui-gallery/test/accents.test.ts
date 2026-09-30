/**
 * The accent choice: the rail offers the active theme's own list after 随主题, a choice survives a
 * theme that does not list it, and the URL accepts every theme's ids and nothing else.
 */
import { THEME_ACCENT_PRESETS, THEME_IDS } from "@prismshadow/penguin-ui";
import { describe, expect, it } from "vitest";
import {
  ACCENT_IDS,
  accentPresetsOf,
  accentSwatch,
  asAccentChoice,
  resolveAccent,
  THEME_ACCENT,
} from "../src/lib/accents";
import { parseGalleryState } from "../src/lib/url-state";

describe("accent presets", () => {
  it("are each theme's own list, in its order, after the theme's own accent", () => {
    for (const theme of THEME_IDS) {
      expect(accentPresetsOf(theme)).toEqual(THEME_ACCENT_PRESETS[theme]);
      expect(accentPresetsOf(theme).length, theme).toBeGreaterThan(0);
      for (const id of accentPresetsOf(theme)) {
        expect(id, theme).toMatch(/^[a-z]+$/);
        expect(accentSwatch(theme, id), `${theme} ${id}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    // Primer keeps the five the Web App has always had, so nothing there moves.
    expect(accentPresetsOf("github")).toEqual(["blue", "green", "violet", "rose", "amber"]);
    expect(ACCENT_IDS[0]).toBe(THEME_ACCENT);
    expect(new Set(ACCENT_IDS).size).toBe(ACCENT_IDS.length);
  });

  it("resolve to the preset when the active theme lists it, else to the theme's own accent", () => {
    for (const theme of THEME_IDS) {
      for (const id of accentPresetsOf(theme)) expect(resolveAccent(theme, id)).toBe(id);
      expect(resolveAccent(theme, THEME_ACCENT)).toBe(THEME_ACCENT);
      expect(resolveAccent(theme, "plaid")).toBe(THEME_ACCENT);
    }
    // A choice made under one theme comes back when the reader returns to it.
    const [first] = accentPresetsOf("github");
    const other = THEME_IDS.find((theme) => !accentPresetsOf(theme).includes(first ?? ""));
    if (other !== undefined) expect(resolveAccent(other, first ?? "")).toBe(THEME_ACCENT);
    expect(resolveAccent("github", first ?? "")).toBe(first);
  });

  it("are the values the URL accepts, whichever theme the link opens on", () => {
    for (const id of ACCENT_IDS) {
      expect(asAccentChoice(id)).toBe(id);
      for (const theme of THEME_IDS) {
        expect(parseGalleryState(`?theme=${theme}&accent=${id}`).accent).toBe(id);
      }
    }
    expect(asAccentChoice("plaid")).toBe(THEME_ACCENT);
    expect(parseGalleryState("?accent=plaid").accent).toBe(THEME_ACCENT);
  });
});
