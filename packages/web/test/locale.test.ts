/**
 * locale.tsx unit tests: device language resolution (language follows
 * navigator.language when no stored preference exists; language/theme
 * initialization does not depend on login state and also applies on the
 * login page).
 */
import { describe, expect, it } from "vitest";
import { resolveSystemLocale } from "../src/state/locale";

describe("resolveSystemLocale (navigator.language → UI language)", () => {
  it("zh prefix (any case or region variant) → zh", () => {
    expect(resolveSystemLocale("zh-CN")).toBe("zh");
    expect(resolveSystemLocale("ZH-TW")).toBe("zh");
  });

  it("non-Chinese or unavailable → English fallback", () => {
    expect(resolveSystemLocale("en-US")).toBe("en");
    expect(resolveSystemLocale(undefined)).toBe("en");
  });
});
