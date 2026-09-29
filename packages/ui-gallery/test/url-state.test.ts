import { describe, expect, it } from "vitest";
import {
  comparesSurface,
  DEFAULT_STATE,
  formatGalleryQuery,
  parseGalleryState,
  PREF_KEYS,
  resolveMode,
  withSurfaceCompare,
} from "../src/lib/url-state";

const PREFS = "theme=github&mode=light&size=m&latin=theme&cjk=theme&lang=en&accent=neutral";

describe("gallery URL state", () => {
  it("reads every field and round-trips through the canonical query", () => {
    const search =
      "?theme=geek&mode=dark&size=xl&latin=mona-sans&cjk=noto-sans-sc&lang=zh&accent=blue&compare=chat&view=phone";
    const state = parseGalleryState(search);
    expect(state).toEqual({
      theme: "geek",
      mode: "dark",
      size: "xl",
      latin: "mona-sans",
      cjk: "noto-sans-sc",
      lang: "zh",
      accent: "blue",
      compare: "chat",
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

  it("reads compare as every page, one surface's page, or off", () => {
    expect(parseGalleryState("?compare=1").compare).toBe(true);
    expect(parseGalleryState("?compare=models").compare).toBe("models");
    expect(parseGalleryState("?compare=0").compare).toBe(false);
    expect(parseGalleryState("?compare=nope").compare).toBe(false);
    expect(parseGalleryState("").compare).toBe(false);
  });

  it("always writes the seven preferences and only the flags that are set", () => {
    expect(formatGalleryQuery(DEFAULT_STATE)).toBe(`?${PREFS}`);
    expect(formatGalleryQuery({ ...DEFAULT_STATE, compare: true, view: "phone" })).toBe(
      `?${PREFS}&compare=1&view=phone`,
    );
    expect(formatGalleryQuery({ ...DEFAULT_STATE, compare: "usage" })).toBe(
      `?${PREFS}&compare=usage`,
    );
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
      parseGalleryState("?theme=nope", { theme: "modern", lang: "zh", latin: "misans", size: "l" }),
    ).toMatchObject({ theme: "modern", lang: "zh", latin: "misans", size: "l" });
    // The URL beats the remembered value.
    expect(parseGalleryState("?theme=geek", { theme: "modern" }).theme).toBe("geek");
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

  it("compares a surface's page when every page does or when it is the one pinned", () => {
    expect(comparesSurface({ ...DEFAULT_STATE, compare: true }, "chat")).toBe(true);
    expect(comparesSurface({ ...DEFAULT_STATE, compare: "chat" }, "chat")).toBe(true);
    expect(comparesSurface({ ...DEFAULT_STATE, compare: "chat" }, "models")).toBe(false);
    expect(comparesSurface(DEFAULT_STATE, "chat")).toBe(false);
  });

  it("pins one page's compare, and clears whatever compare covered it", () => {
    const on = withSurfaceCompare(DEFAULT_STATE, "chat", true);
    expect(on.compare).toBe("chat");
    expect(withSurfaceCompare(on, "chat", false).compare).toBe(false);
    expect(withSurfaceCompare({ ...DEFAULT_STATE, compare: true }, "chat", false).compare).toBe(
      false,
    );
  });
});
