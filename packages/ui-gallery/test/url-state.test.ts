import { describe, expect, it } from "vitest";
import {
  comparesModule,
  comparesVariant,
  DEFAULT_STATE,
  formatGalleryQuery,
  parseGalleryState,
  resolveMode,
  withVariant,
  withVariantCompare,
} from "../src/lib/url-state";

describe("gallery URL state", () => {
  it("reads every field and round-trips through the canonical query", () => {
    const search =
      "?theme=geek&mode=dark&tier=lg&lang=zh&accent=blue&compare=conversation&view=phone&motion=reduced&v.actions-button=danger.sm";
    const state = parseGalleryState(search);
    expect(state).toEqual({
      theme: "geek",
      mode: "dark",
      tier: "lg",
      lang: "zh",
      accent: "blue",
      compare: "conversation",
      view: "phone",
      motion: "reduced",
      variants: { "actions-button": "danger.sm" },
    });
    expect(parseGalleryState(formatGalleryQuery(state))).toEqual(state);
  });

  it("reads compare as every page, one module's page, one variant's section, or off", () => {
    expect(parseGalleryState("?compare=1").compare).toBe(true);
    expect(parseGalleryState("?compare=status").compare).toBe("status");
    expect(parseGalleryState("?compare=status.notices").compare).toEqual({
      module: "status",
      variant: "notices",
    });
    expect(parseGalleryState("?compare=create-with-ai.review").compare).toEqual({
      module: "create-with-ai",
      variant: "review",
    });
    expect(parseGalleryState("?compare=0").compare).toBe(false);
    expect(parseGalleryState("?compare=nope").compare).toBe(false);
    expect(parseGalleryState("?compare=nope.live").compare).toBe(false);
    expect(parseGalleryState("?compare=status.").compare).toBe(false);
    expect(parseGalleryState("?compare=status.Live").compare).toBe(false);
    expect(parseGalleryState("").compare).toBe(false);
  });

  it("round-trips a variant compare, whose key never holds the separator", () => {
    const state = { ...DEFAULT_STATE, compare: { module: "status" as const, variant: "live" } };
    expect(formatGalleryQuery(state)).toBe(
      "?theme=github&mode=light&tier=md&lang=en&accent=neutral&compare=status.live",
    );
    expect(parseGalleryState(formatGalleryQuery(state))).toEqual(state);
  });

  it("always writes the five preferences and only the flags that are set", () => {
    expect(formatGalleryQuery(DEFAULT_STATE)).toBe(
      "?theme=github&mode=light&tier=md&lang=en&accent=neutral",
    );
    expect(
      formatGalleryQuery({ ...DEFAULT_STATE, compare: true, view: "phone", motion: "reduced" }),
    ).toBe(
      "?theme=github&mode=light&tier=md&lang=en&accent=neutral&compare=1&view=phone&motion=reduced",
    );
    expect(formatGalleryQuery({ ...DEFAULT_STATE, compare: "tables" })).toBe(
      "?theme=github&mode=light&tier=md&lang=en&accent=neutral&compare=tables",
    );
  });

  it("keeps route params right after the preferences, in the order given", () => {
    expect(
      formatGalleryQuery(
        { ...DEFAULT_STATE, theme: "modern" },
        { module: "status", variant: "notices" },
      ),
    ).toBe("?theme=modern&mode=light&tier=md&lang=en&accent=neutral&module=status&variant=notices");
  });

  it("sorts picks so one view has one URL", () => {
    const a = formatGalleryQuery({
      ...DEFAULT_STATE,
      variants: { "forms-input": "x", "actions-button": "y" },
    });
    const b = formatGalleryQuery({
      ...DEFAULT_STATE,
      variants: { "actions-button": "y", "forms-input": "x" },
    });
    expect(a).toBe(b);
    expect(a.endsWith("&v.actions-button=y&v.forms-input=x")).toBe(true);
  });

  it("falls back to the remembered value, then the default, for anything unknown", () => {
    expect(
      parseGalleryState("?theme=nope&mode=sepia&tier=xl&lang=fr&accent=plaid&view=tv"),
    ).toEqual(DEFAULT_STATE);
    expect(
      parseGalleryState("?theme=nope", { theme: "modern", lang: "zh", accent: "blue" }),
    ).toMatchObject({
      theme: "modern",
      lang: "zh",
      accent: "blue",
    });
    // The URL beats the remembered value.
    expect(parseGalleryState("?theme=geek", { theme: "modern" }).theme).toBe("geek");
  });

  it("keeps an accent preset whichever theme is active, so switching themes never loses it", () => {
    // Primer's `blue` rides along under Console; the provider resolves what the root carries.
    expect(parseGalleryState("?theme=geek&accent=blue")).toMatchObject({
      theme: "geek",
      accent: "blue",
    });
  });

  it("ignores empty and nameless picks", () => {
    expect(parseGalleryState("?v.=x&v.status=").variants).toEqual({});
  });

  it("resolves system mode against the OS preference", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });

  it("compares a module's page when every page does or when it is the one pinned", () => {
    expect(comparesModule({ ...DEFAULT_STATE, compare: true }, "status")).toBe(true);
    expect(comparesModule({ ...DEFAULT_STATE, compare: "status" }, "status")).toBe(true);
    expect(comparesModule({ ...DEFAULT_STATE, compare: "status" }, "forms")).toBe(false);
    expect(comparesModule(DEFAULT_STATE, "status")).toBe(false);
    // A pinned variant compares its section, not the page.
    const pinned = { ...DEFAULT_STATE, compare: { module: "status" as const, variant: "live" } };
    expect(comparesModule(pinned, "status")).toBe(false);
  });

  it("compares a variant's section under any compare that covers it", () => {
    const pinned = { ...DEFAULT_STATE, compare: { module: "status" as const, variant: "live" } };
    expect(comparesVariant(pinned, "status", "live")).toBe(true);
    expect(comparesVariant(pinned, "status", "notices")).toBe(false);
    expect(comparesVariant(pinned, "forms", "live")).toBe(false);
    expect(comparesVariant({ ...DEFAULT_STATE, compare: "status" }, "status", "notices")).toBe(
      true,
    );
    expect(comparesVariant({ ...DEFAULT_STATE, compare: true }, "forms", "errors")).toBe(true);
    expect(comparesVariant(DEFAULT_STATE, "status", "live")).toBe(false);
  });

  it("pins one variant's compare, and clears whatever compare covered it", () => {
    const on = withVariantCompare(DEFAULT_STATE, "status", "live", true);
    expect(on.compare).toEqual({ module: "status", variant: "live" });
    expect(withVariantCompare(on, "status", "live", false).compare).toBe(false);
    // Leaving compare from a page-wide or site-wide one turns it off outright.
    expect(
      withVariantCompare({ ...DEFAULT_STATE, compare: true }, "status", "live", false).compare,
    ).toBe(false);
  });

  it("sets and clears one part's pick without touching the others", () => {
    const state = withVariant(
      { ...DEFAULT_STATE, variants: { "feedback-badge": "solid" } },
      "forms-input",
      "errors",
    );
    expect(state.variants).toEqual({ "feedback-badge": "solid", "forms-input": "errors" });
    expect(withVariant(state, "feedback-badge", null).variants).toEqual({
      "forms-input": "errors",
    });
  });
});
