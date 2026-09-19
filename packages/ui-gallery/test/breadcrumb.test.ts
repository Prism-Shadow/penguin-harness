import { describe, expect, it } from "vitest";
import { formatBreadcrumb } from "../src/lib/breadcrumb";

describe("formatBreadcrumb", () => {
  it("spells a module's address: theme › module › variant, then mode and language", () => {
    expect(
      formatBreadcrumb({
        theme: "modern",
        module: "Conversation",
        variant: ["Approval"],
        mode: "dark",
        lang: "zh",
        tier: "md",
      }),
    ).toBe("Frost › Conversation › Approval · dark · zh");
  });

  it("names a paused live variant's frame, the variant joining the path", () => {
    expect(
      formatBreadcrumb({
        theme: "modern",
        module: "Navigation",
        variant: ["Collapse and expand"],
        frame: "Rail",
        mode: "dark",
        lang: "en",
        tier: "md",
      }),
    ).toBe("Frost › Navigation › Collapse and expand › Rail · dark");
  });

  it("keeps the part form feedback quoted before modules existed", () => {
    expect(
      formatBreadcrumb({
        theme: "geek",
        module: "Actions",
        part: "Button",
        variant: ["danger", "sm"],
        mode: "dark",
        lang: "en",
        tier: "md",
      }),
    ).toBe("Console › Actions › Button › danger · sm · dark");
  });

  it("names a part's matrix pick `all`", () => {
    expect(
      formatBreadcrumb({
        theme: "modern",
        module: "Buttons & actions",
        part: "Button",
        variant: ["all"],
        mode: "light",
        lang: "en",
        tier: "md",
      }),
    ).toBe("Frost › Buttons & actions › Button › all · light");
  });

  it("appends the root size only when it differs from 18px", () => {
    expect(
      formatBreadcrumb({
        theme: "github",
        module: "Foundations",
        variant: ["Shape & depth"],
        mode: "dark",
        lang: "zh",
        tier: "lg",
      }),
    ).toBe("Primer › Foundations › Shape & depth · dark · zh · 20px");
  });

  it("joins the mode with a dot when there is no pick", () => {
    expect(
      formatBreadcrumb({
        theme: "github",
        module: "Screens",
        mode: "light",
        lang: "en",
        tier: "sm",
      }),
    ).toBe("Primer › Screens · light · 16px");
  });
});
