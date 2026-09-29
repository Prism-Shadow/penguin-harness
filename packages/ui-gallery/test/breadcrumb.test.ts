/**
 * The breadcrumb spells an address in the chrome's language: the names come in localized, and the
 * language itself needs no qualifier, since the words carry it.
 */
import { describe, expect, it } from "vitest";
import { formatBreadcrumb } from "../src/lib/breadcrumb";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("formatBreadcrumb", () => {
  it("spells a module's address: theme › module › variant, then the mode", () => {
    expect(
      formatBreadcrumb({
        theme: en.rail.themeNames.modern,
        module: "Conversation",
        variant: ["Approval"],
        mode: en.crumb.modes.dark,
        tier: "md",
      }),
    ).toBe("Frost › Conversation › Approval · dark");
  });

  it("reads in Chinese when the chrome does, with the theme's Chinese name", () => {
    expect(
      formatBreadcrumb({
        theme: zh.rail.themeNames.modern,
        module: zh.catalog.modules.conversation?.title ?? "",
        variant: [zh.catalog.modules.conversation?.variants.streaming ?? ""],
        mode: zh.crumb.modes.dark,
        tier: "md",
      }),
    ).toBe("白领 › 对话 › 流式输出 · 深色");
    expect(zh.rail.themeNames).toEqual({ github: "通用", modern: "白领", geek: "极客" });
    expect(en.rail.themeNames).toEqual({ github: "Primer", modern: "Frost", geek: "Console" });
  });

  it("names a paused scene's frame, the variant joining the path", () => {
    expect(
      formatBreadcrumb({
        theme: "Frost",
        module: "Navigation",
        variant: ["Sidebar"],
        frame: "Rail",
        mode: "dark",
        tier: "md",
      }),
    ).toBe("Frost › Navigation › Sidebar › Rail · dark");
  });

  it("keeps the part form feedback quoted before modules existed", () => {
    expect(
      formatBreadcrumb({
        theme: "Console",
        module: "Actions",
        part: "Button",
        variant: ["danger", "sm"],
        mode: "dark",
        tier: "md",
      }),
    ).toBe("Console › Actions › Button › danger · sm · dark");
  });

  it("names a part's matrix pick `all`", () => {
    expect(
      formatBreadcrumb({
        theme: "Frost",
        module: "Buttons & actions",
        part: "Button",
        variant: ["all"],
        mode: "light",
        tier: "md",
      }),
    ).toBe("Frost › Buttons & actions › Button › all · light");
  });

  it("appends the accent, the root size and the phone frame only when they differ from the defaults", () => {
    expect(
      formatBreadcrumb({
        theme: "Primer",
        module: "Foundations",
        variant: ["Shape & depth"],
        mode: "dark",
        accent: "amber",
        tier: "lg",
        view: "phone",
      }),
    ).toBe("Primer › Foundations › Shape & depth · dark · amber · 20px · phone");
    expect(
      formatBreadcrumb({
        theme: "通用",
        module: "基础",
        variant: ["形状与层次"],
        mode: "深色",
        tier: "sm",
        view: "手机",
      }),
    ).toBe("通用 › 基础 › 形状与层次 · 深色 · 16px · 手机");
  });

  it("joins the mode with a dot when there is no pick", () => {
    expect(
      formatBreadcrumb({
        theme: "Primer",
        module: "Screens",
        mode: "light",
        tier: "sm",
      }),
    ).toBe("Primer › Screens · light · 16px");
  });
});
