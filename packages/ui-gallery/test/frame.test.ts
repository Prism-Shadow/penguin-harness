/**
 * The frame's contract: the URL the gallery builds is the URL the frame reads back, the seeding
 * script writes the app's own storage keys, and the one key the package does not export is the
 * app's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import {
  APP_FRAME_PATH,
  APP_LANG_KEY,
  appFrameSrc,
  parseFrameParams,
  SEEDED_KEYS,
  storageSeedScript,
} from "../src/app/frame";
import type { FramePrefs } from "../src/app/frame";

const PREFS: FramePrefs = {
  theme: "modern",
  mode: "dark",
  accent: "amber",
  size: "l",
  latin: "mona-sans",
  cjk: "noto-sans-sc",
  lang: "zh",
};

describe("the frame URL", () => {
  it("names the document, the route and every preference, and reads back what it wrote", () => {
    const src = appFrameSrc("/gallery", PREFS, {
      route: "/chat/s-1?tab=x",
      signedOut: true,
      open: "settings",
    });
    expect(src.startsWith(`/gallery${APP_FRAME_PATH}?`)).toBe(true);
    const params = parseFrameParams(src.slice(src.indexOf("?")));
    expect(params).toEqual({
      route: "/chat/s-1?tab=x",
      lang: "zh",
      signedOut: true,
      open: "settings",
    });
    for (const [param, key] of Object.entries(SEEDED_KEYS)) {
      expect(src, key).toContain(`${param}=`);
    }
  });

  it("opens the chat when the route is missing or not a path, signed in by default", () => {
    expect(parseFrameParams("")).toEqual({ route: "/chat", lang: "en" });
    expect(parseFrameParams("?route=http://evil&lang=fr")).toEqual({ route: "/chat", lang: "en" });
  });

  it("seeds the app's own storage keys, every one of them the package's or the app's", () => {
    expect(SEEDED_KEYS).toEqual({
      theme: THEME_STORAGE_KEYS.themeId,
      mode: THEME_STORAGE_KEYS.mode,
      accent: THEME_STORAGE_KEYS.accent,
      size: THEME_STORAGE_KEYS.textSize,
      latin: THEME_STORAGE_KEYS.fontLatin,
      cjk: THEME_STORAGE_KEYS.fontCjk,
      lang: APP_LANG_KEY,
    });
    // The language key is the app's own (state/locale.tsx), spelled here because it has no export.
    const locale = readFileSync(
      fileURLToPath(new URL("../../web/src/state/locale.tsx", import.meta.url)),
      "utf8",
    );
    expect(locale).toContain(`const STORAGE_KEY = "${APP_LANG_KEY}";`);
  });

  it("is a classic script that gives the document a seeded in-memory storage", () => {
    const src = appFrameSrc("", PREFS, { route: "/models" });
    const search = src.slice(src.indexOf("?"));
    const window: Record<string, unknown> = {};
    const context = vm.createContext({
      window,
      location: { search },
      URLSearchParams,
      Object,
    });
    vm.runInContext(storageSeedScript(), context);
    const storage = window.localStorage as Storage;
    expect(storage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("modern");
    expect(storage.getItem(THEME_STORAGE_KEYS.mode)).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEYS.textSize)).toBe("l");
    expect(storage.getItem(THEME_STORAGE_KEYS.fontLatin)).toBe("mona-sans");
    expect(storage.getItem(THEME_STORAGE_KEYS.fontCjk)).toBe("noto-sans-sc");
    expect(storage.getItem(APP_LANG_KEY)).toBe("zh");
    expect(storage.getItem("penguin.nothing")).toBeNull();
    // It is a working Storage: writes stay in this document and enumerate.
    storage.setItem("penguin.sidebarCollapsed", "1");
    expect(storage.length).toBe(8);
    expect(storage.key(7)).toBe("penguin.sidebarCollapsed");
    storage.removeItem("penguin.sidebarCollapsed");
    expect(storage.getItem("penguin.sidebarCollapsed")).toBeNull();
    const session = window.sessionStorage as Storage;
    expect(session.length).toBe(0);
    // Dependency-free and strict-safe: no globals leak.
    expect(Object.keys(context).sort()).toEqual([
      "Object",
      "URLSearchParams",
      "location",
      "window",
    ]);
  });
});
