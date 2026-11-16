/**
 * The breadcrumb spells an address in the chrome's language: the names come in localized, and the
 * language itself needs no qualifier, since the words carry it.
 */
import { describe, expect, it } from "vitest";
import { formatBreadcrumb } from "../src/lib/breadcrumb";

describe("formatBreadcrumb", () => {
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
      formatBreadcrumb({ theme: "朴素", page: "模型库", mode: "深色", size: "xs", view: "手机" }),
    ).toBe("朴素 › 模型库 · 深色 · 14px · 手机");
    expect(formatBreadcrumb({ theme: "Primer", page: "Models", mode: "light", size: "m" })).toBe(
      "Primer › Models · light",
    );
  });
});
