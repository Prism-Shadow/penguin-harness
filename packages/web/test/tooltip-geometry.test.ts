/**
 * Where the styled Tooltip (src/components/ui/tooltip.tsx) hangs its panel, and how wide the
 * panel may grow before it would leave the screen.
 *
 * The panel is pinned by one horizontal edge and grows away from it, so the only width it can
 * safely take is the room between that edge and the viewport margin on the far side. A long
 * text — a background process's command, shown whole — wraps at that room instead of running
 * off a phone's screen; a short label never reaches it.
 */
import { describe, expect, it } from "vitest";
import { belowTrigger, besideTrigger } from "../src/components/ui/tooltip";

const VIEWPORT = { width: 1000, height: 800 };

/** A trigger box from its left/top corner and size. */
const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("belowTrigger", () => {
  it("anchors by the right edge in the right half, with the room reaching back to the left margin", () => {
    // A command line near the right of the window: the panel grows leftward from its right edge.
    expect(belowTrigger(box(700, 100, 200, 20), VIEWPORT)).toEqual({
      top: 128,
      right: 100,
      room: 892,
    });
  });

  it("anchors by the left edge in the left half, with the room reaching to the right margin", () => {
    // A phone-width card: the room, not the panel's own cap, is what keeps the text on screen.
    expect(belowTrigger(box(40, 100, 200, 20), { width: 390, height: 800 })).toEqual({
      top: 128,
      left: 40,
      room: 342,
    });
  });

  it("keeps the anchored edge inside the viewport margin", () => {
    expect(belowTrigger(box(900, 0, 100, 20), VIEWPORT).right).toBe(8);
    expect(belowTrigger(box(-20, 0, 100, 20), VIEWPORT).left).toBe(8);
  });
});

describe("besideTrigger", () => {
  it("hangs to the right of a rail entry, centred on it, with the room to the right margin", () => {
    expect(besideTrigger(box(8, 200, 32, 32), VIEWPORT)).toEqual({ top: 216, left: 48, room: 944 });
  });

  it("clamps the centre into the viewport and never reports negative room", () => {
    const offscreen = besideTrigger(box(990, 900, 32, 32), VIEWPORT);
    expect(offscreen.top).toBe(792);
    expect(offscreen.room).toBe(0);
  });
});
