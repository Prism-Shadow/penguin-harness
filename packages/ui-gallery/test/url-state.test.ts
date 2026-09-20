import { describe, expect, it } from "vitest";
import {
  comparesModule,
  DEFAULT_STATE,
  formatGalleryQuery,
  parseGalleryState,
  resolveMode,
  withVariant,
} from "../src/lib/url-state";

describe("gallery URL state", () => {
  it("reads every field and round-trips through the canonical query", () => {
    const search =
      "?theme=geek&mode=dark&tier=lg&lang=zh&compare=conversation&motion=reduced&v.conversation=approval&v.actions-button=danger.sm";
    const state = parseGalleryState(search);
    expect(state).toEqual({
      theme: "geek",
      mode: "dark",
      tier: "lg",
      lang: "zh",
      compare: "conversation",
      motion: "reduced",
      variants: { conversation: "approval", "actions-button": "danger.sm" },
    });
    expect(parseGalleryState(formatGalleryQuery(state))).toEqual(state);
  });

  it("reads compare as every module, one module, or off", () => {
    expect(parseGalleryState("?compare=1").compare).toBe(true);
    expect(parseGalleryState("?compare=status").compare).toBe("status");
    expect(parseGalleryState("?compare=0").compare).toBe(false);
    expect(parseGalleryState("?compare=nope").compare).toBe(false);
    expect(parseGalleryState("").compare).toBe(false);
  });

  it("always writes the four preferences and only the flags that are set", () => {
    expect(formatGalleryQuery(DEFAULT_STATE)).toBe("?theme=github&mode=light&tier=md&lang=en");
    expect(formatGalleryQuery({ ...DEFAULT_STATE, compare: true, motion: "reduced" })).toBe(
      "?theme=github&mode=light&tier=md&lang=en&compare=1&motion=reduced",
    );
    expect(formatGalleryQuery({ ...DEFAULT_STATE, compare: "tables" })).toBe(
      "?theme=github&mode=light&tier=md&lang=en&compare=tables",
    );
  });

  it("keeps route params right after the preferences, in the order given", () => {
    expect(
      formatGalleryQuery(
        { ...DEFAULT_STATE, theme: "modern" },
        { module: "status", variant: "notices" },
      ),
    ).toBe("?theme=modern&mode=light&tier=md&lang=en&module=status&variant=notices");
  });

  it("sorts picks so one view has one URL", () => {
    const a = formatGalleryQuery({ ...DEFAULT_STATE, variants: { status: "x", forms: "y" } });
    const b = formatGalleryQuery({ ...DEFAULT_STATE, variants: { forms: "y", status: "x" } });
    expect(a).toBe(b);
    expect(a.endsWith("&v.forms=y&v.status=x")).toBe(true);
  });

  it("falls back to the remembered value, then the default, for anything unknown", () => {
    expect(parseGalleryState("?theme=nope&mode=sepia&tier=xl&lang=fr")).toEqual(DEFAULT_STATE);
    expect(parseGalleryState("?theme=nope", { theme: "modern", lang: "zh" })).toMatchObject({
      theme: "modern",
      lang: "zh",
    });
    // The URL beats the remembered value.
    expect(parseGalleryState("?theme=geek", { theme: "modern" }).theme).toBe("geek");
  });

  it("ignores empty and nameless picks", () => {
    expect(parseGalleryState("?v.=x&v.status=").variants).toEqual({});
  });

  it("resolves system mode against the OS preference", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });

  it("compares a module when every module does or when it is the one pinned", () => {
    expect(comparesModule({ ...DEFAULT_STATE, compare: true }, "status")).toBe(true);
    expect(comparesModule({ ...DEFAULT_STATE, compare: "status" }, "status")).toBe(true);
    expect(comparesModule({ ...DEFAULT_STATE, compare: "status" }, "forms")).toBe(false);
    expect(comparesModule(DEFAULT_STATE, "status")).toBe(false);
  });

  it("sets and clears one pick without touching the others", () => {
    const state = withVariant(
      { ...DEFAULT_STATE, variants: { status: "live" } },
      "forms",
      "errors",
    );
    expect(state.variants).toEqual({ status: "live", forms: "errors" });
    expect(withVariant(state, "status", null).variants).toEqual({ forms: "errors" });
  });
});
