/**
 * The breadcrumb spells an address in the chrome's language: the names come in localized, and the
 * language itself needs no qualifier, since the words carry it.
 */
import { describe, expect, it } from "vitest";
import { formatBreadcrumb } from "../src/lib/breadcrumb";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("formatBreadcrumb", () => {
  it("spells a surface's address: theme › surface, then the mode", () => {
    expect(
      formatBreadcrumb({
        theme: en.rail.themeNames.modern,
        page: en.surfaces.chat.title,
        mode: en.crumb.modes.dark,
        size: "m",
      }),
    ).toBe("Frost › Chat · dark");
  });

  it("reads in Chinese when the chrome does, with the theme's Chinese name", () => {
    expect(
      formatBreadcrumb({
        theme: zh.rail.themeNames.modern,
        page: zh.surfaces.chat.title,
        mode: zh.crumb.modes.dark,
        size: "m",
      }),
    ).toBe("白领 › 对话 · 深色");
    expect(zh.rail.themeNames).toEqual({ github: "通用", modern: "白领", geek: "极客" });
    expect(en.rail.themeNames).toEqual({ github: "Primer", modern: "Frost", geek: "Console" });
  });

  it("names a section of a page, the section joining the path", () => {
    expect(
      formatBreadcrumb({
        theme: "Console",
        page: "Foundations",
        section: "Colour",
        mode: "dark",
        size: "m",
      }),
    ).toBe("Console › Foundations › Colour · dark");
  });

  it("appends the accent, the root size and the phone frame only when they differ from the defaults", () => {
    expect(
      formatBreadcrumb({
        theme: "Primer",
        page: "Models",
        mode: "dark",
        accent: "amber",
        size: "xl",
        view: "phone",
      }),
    ).toBe("Primer › Models · dark · amber · 20px · phone");
    expect(
      formatBreadcrumb({ theme: "通用", page: "模型库", mode: "深色", size: "xs", view: "手机" }),
    ).toBe("通用 › 模型库 · 深色 · 14px · 手机");
    expect(formatBreadcrumb({ theme: "Primer", page: "Models", mode: "light", size: "m" })).toBe(
      "Primer › Models · light",
    );
  });
});
