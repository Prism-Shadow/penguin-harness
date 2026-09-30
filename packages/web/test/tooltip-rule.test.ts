/**
 * The tooltip rule (components/ui/tooltip.tsx): a hint shows for an element with no visible
 * text of its own, or one whose visible text is cut off — never for a label the reader can
 * already read in full.
 */
import { describe, expect, it } from "vitest";
import { hintAllowed, isCutOff } from "../src/components/ui/tooltip";

const box = (scrollWidth: number, clientWidth: number, scrollHeight = 16, clientHeight = 16) => ({
  scrollWidth,
  clientWidth,
  scrollHeight,
  clientHeight,
});

describe("isCutOff", () => {
  it("reads overflow on either axis as cut off", () => {
    expect(isCutOff(box(240, 120))).toBe(true);
    expect(isCutOff(box(100, 100, 40, 20))).toBe(true);
  });

  it("forgives the pixel of overflow layout reports for text that fits", () => {
    expect(isCutOff(box(101, 100, 17, 16))).toBe(false);
    expect(isCutOff(box(100, 100))).toBe(false);
  });
});

describe("hintAllowed", () => {
  it("shows the hint of an element with no text of its own (an icon, a chart mark)", () => {
    expect(hintAllowed("", [box(24, 24)])).toBe(true);
    expect(hintAllowed("   ", [])).toBe(true);
  });

  it("shows the hint when the visible text is cut off anywhere inside", () => {
    expect(hintAllowed("A very long Session title", [box(200, 200), box(320, 180)])).toBe(true);
  });

  it("shows no hint for text that is fully visible, whatever the hint would add", () => {
    expect(hintAllowed("3 min ago", [box(60, 60), box(58, 60)])).toBe(false);
    expect(hintAllowed("Copy prompt", [])).toBe(false);
  });
});
