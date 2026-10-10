import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  formatGalleryQuery,
  parseGalleryState,
  PREF_KEYS,
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
