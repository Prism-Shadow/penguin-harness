import { describe, expect, it } from "vitest";
import { effectiveCollapsed, wantsFocus } from "../src/lib/sidebar-auto-collapse";

describe("sidebar auto-collapse", () => {
  it("focuses an open activity only", () => {
    expect(wantsFocus("/activities/abc")).toBe(true);
    expect(wantsFocus("/activities/abc/")).toBe(true);
    expect(wantsFocus("/activities")).toBe(false);
    expect(wantsFocus("/activities/media")).toBe(false);
    expect(wantsFocus("/agents/abc")).toBe(false);
  });
  it("collapses in focus unless the user expanded it there", () => {
    expect(effectiveCollapsed(false, true, null)).toBe(true);
    expect(effectiveCollapsed(false, true, false)).toBe(false);
    expect(effectiveCollapsed(true, true, null)).toBe(true);
  });
  it("uses the stored preference outside focus, whatever happened inside", () => {
    expect(effectiveCollapsed(false, false, false)).toBe(false);
    expect(effectiveCollapsed(true, false, null)).toBe(true);
  });
});
