/**
 * The gallery's view state: what a URL pins, and what a visit restores where the URL is silent.
 *
 * - Given any view, its canonical query parses back to the same view, the seven preferences always
 *   written out and the phone view only when set; unknown values fall back to the remembered
 *   value, then to the default.
 * - Given the site's light/dark and language are stored (by any of the three sites), a visit
 *   restores those, over what the gallery stored itself before the sites shared them.
 * - Given only the gallery's own older `mode` and `lang` are stored, a returning visit keeps them.
 * - Given nothing stored, a visit follows the system, as the landing page and the docs do: the
 *   system mode, and the device's language (Chinese for any zh locale, English otherwise).
 * - The gallery's other preferences (theme, size, fonts, accent) stay its own.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  formatGalleryQuery,
  parseGalleryState,
  PREF_KEYS,
  rememberedPrefs,
  resolveMode,
} from "../src/lib/url-state";

const PREFS = "theme=modern&mode=light&size=m&latin=theme&cjk=theme&lang=en&accent=neutral";

describe("gallery URL state", () => {
  it("reads every field and round-trips through the canonical query", () => {
    const search =
      "?theme=geek&mode=dark&size=xl&latin=mona-sans&cjk=noto-sans-sc&lang=zh&accent=blue&view=phone";
    const state = parseGalleryState(search);
    expect(state).toEqual({
      theme: "geek",
      mode: "dark",
      size: "xl",
      latin: "mona-sans",
      cjk: "noto-sans-sc",
      lang: "zh",
      accent: "blue",
      view: "phone",
    });
    expect(parseGalleryState(formatGalleryQuery(state))).toEqual(state);
  });

  it("opens on the 16px size, the theme's own faces and the theme's own accent", () => {
    expect(DEFAULT_STATE.size).toBe("m");
    expect(DEFAULT_STATE.latin).toBe("theme");
    expect(DEFAULT_STATE.cjk).toBe("theme");
    expect(PREF_KEYS).toEqual(["theme", "mode", "size", "latin", "cjk", "lang", "accent"]);
  });

  it("always writes the seven preferences and the view only when set", () => {
    expect(formatGalleryQuery(DEFAULT_STATE)).toBe(`?${PREFS}`);
    expect(formatGalleryQuery({ ...DEFAULT_STATE, view: "phone" })).toBe(`?${PREFS}&view=phone`);
  });

  it("ignores the retired compare param: a link quoted with it opens on one frame", () => {
    expect(parseGalleryState("?compare=1")).toEqual(DEFAULT_STATE);
    expect(parseGalleryState("?compare=chat")).toEqual(DEFAULT_STATE);
    expect(formatGalleryQuery(parseGalleryState("?compare=1"))).not.toContain("compare");
  });

  it("keeps route params right after the preferences, in the order given", () => {
    expect(formatGalleryQuery({ ...DEFAULT_STATE, theme: "modern" }, { a: "1", b: "2" })).toBe(
      "?theme=modern&mode=light&size=m&latin=theme&cjk=theme&lang=en&accent=neutral&a=1&b=2",
    );
  });

  it("still opens a link quoted with the retired three-step size, by its pixels", () => {
    expect(parseGalleryState("?size=sm").size).toBe("m");
    expect(parseGalleryState("?size=md").size).toBe("l");
    expect(parseGalleryState("?size=lg").size).toBe("xl");
    expect(parseGalleryState("?tier=lg").size).toBe("xl");
    expect(parseGalleryState("?tier=md&size=xs").size).toBe("xs");
    expect(formatGalleryQuery(parseGalleryState("?size=md"))).toContain("size=l");
  });

  it("falls back to the remembered value, then the default, for anything unknown", () => {
    expect(
      parseGalleryState(
        "?theme=nope&mode=sepia&size=xxl&latin=comic&cjk=nope&lang=fr&accent=plaid&view=tv",
      ),
    ).toEqual(DEFAULT_STATE);
    expect(
      parseGalleryState("?theme=nope", { theme: "github", lang: "zh", latin: "misans", size: "l" }),
    ).toMatchObject({ theme: "github", lang: "zh", latin: "misans", size: "l" });
    // The URL beats the remembered value.
    expect(parseGalleryState("?theme=geek", { theme: "github" }).theme).toBe("geek");
  });

  it("keeps an accent preset whichever theme is active, so switching themes never loses it", () => {
    expect(parseGalleryState("?theme=geek&accent=blue")).toMatchObject({
      theme: "geek",
      accent: "blue",
    });
  });

  it("resolves system mode against the OS preference", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });
});

describe("what a visit restores where the URL is silent", () => {
  const nothing = { gallery: {}, siteTheme: null, siteLang: null };

  it("opens in the site's light/dark and language, over the gallery's older own", () => {
    const stored = {
      gallery: { mode: "light", lang: "en" },
      siteTheme: "dark" as const,
      siteLang: "zh" as const,
    };
    expect(rememberedPrefs(stored, "en-US")).toMatchObject({ mode: "dark", lang: "zh" });
    // The URL still beats it: a quoted link opens as quoted.
    const state = parseGalleryState("?mode=light&lang=en", rememberedPrefs(stored, "en-US"));
    expect(state).toMatchObject({ mode: "light", lang: "en" });
  });

  it("keeps a returning reader's own choice while the site has none", () => {
    const stored = { ...nothing, gallery: { mode: "dark", lang: "zh" } };
    expect(rememberedPrefs(stored, "en-US")).toMatchObject({ mode: "dark", lang: "zh" });
  });

  it("follows the system when nothing is stored, as the other two sites do", () => {
    expect(rememberedPrefs(nothing, "zh-CN")).toMatchObject({ mode: "system", lang: "zh" });
    expect(rememberedPrefs(nothing, "fr-FR")).toMatchObject({ mode: "system", lang: "en" });
    expect(rememberedPrefs(nothing, undefined)).toMatchObject({ mode: "system", lang: "en" });
    // The site's language set to follow the system resolves the same way.
    expect(rememberedPrefs({ ...nothing, siteLang: "system" as const }, "zh-TW").lang).toBe("zh");
  });

  it("ignores an unreadable older value and keeps the gallery's other preferences its own", () => {
    const stored = {
      ...nothing,
      gallery: { mode: "dusk", lang: "fr", theme: "geek", size: "l", accent: "blue" },
    };
    expect(rememberedPrefs(stored, "en-US")).toEqual({
      theme: "geek",
      size: "l",
      accent: "blue",
      mode: "system",
      lang: "en",
    });
  });
});
