/**
 * locale.tsx unit tests: device language resolution (language follows
 * navigator.language when no stored preference exists; language/theme
 * initialization does not depend on login state and also applies on the
 * login page).
 */
import { describe, expect, it } from "vitest";
import { resolveSystemLocale } from "../src/state/locale";

describe("resolveSystemLocale（navigator.language → 界面语言）", () => {
  it("zh 前缀（任意大小写与地区变体）→ zh", () => {
    expect(resolveSystemLocale("zh-CN")).toBe("zh");
    expect(resolveSystemLocale("ZH-TW")).toBe("zh");
  });

  it("非中文或取不到 → 英文兜底", () => {
    expect(resolveSystemLocale("en-US")).toBe("en");
    expect(resolveSystemLocale(undefined)).toBe("en");
  });
});
