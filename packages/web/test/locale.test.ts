/**
 * locale.tsx unit tests: device language resolution (language follows
 * navigator.language when no stored preference exists; language/theme
 * initialization does not depend on login state and also applies on the
 * login page).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSystemLocale } from "../src/state/locale";

describe("resolveSystemLocale (navigator.language → UI language)", () => {
  it("unsupported device languages fall back to English", () => {
    expect(resolveSystemLocale("zh-CN")).toBe("en");
    expect(resolveSystemLocale("ZH-TW")).toBe("en");
  });

  it("non-Chinese or unavailable → English fallback", () => {
    expect(resolveSystemLocale("en-US")).toBe("en");
    expect(resolveSystemLocale(undefined)).toBe("en");
  });
});

describe("active dictionary", () => {
  it("defaults to English and supports switching dictionaries", async () => {
    const strings = await import("../src/lib/strings");
    const { en } = await import("../src/lib/strings-en");
    expect(strings.S).toBe(en);
    try {
      strings.setActiveStrings({ ...en, appName: "Translated app" });
      expect(strings.S.appName).toBe("Translated app");
    } finally {
      strings.setActiveStrings(en);
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

it("uses English when a removed language preference was saved", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "zh" });
  vi.stubGlobal("navigator", { language: "zh-CN" });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { LocaleProvider, useLocale } = await import("../src/state/locale");
  function Probe() {
    const { lang, locale } = useLocale();
    return createElement("span", null, lang + ":" + locale);
  }
  expect(renderToStaticMarkup(createElement(LocaleProvider, null, createElement(Probe)))).toBe(
    "<span>system:en</span>",
  );
});
