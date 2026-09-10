/**
 * The floating dock launcher's decisions (features/dock/dock-launcher-state.ts): when it
 * shows, how its resting position clamps to the chat body and round-trips through the
 * stored ratio, whether the user put it away, how a drag is bounded, and where on the arc
 * its entries land.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCHER_RATIO,
  FAN_ENTRY_SIZE,
  FAN_RADIUS,
  LAUNCHER_CAPTION_HEIGHT,
  LAUNCHER_EDGE_MARGIN,
  LAUNCHER_HIDDEN_KEY,
  LAUNCHER_SIZE,
  LAUNCHER_Y_KEY,
  clampLauncherTop,
  dragPosition,
  fanLayout,
  launcherHiddenVersion,
  launcherRatioFromTop,
  launcherTopFromRatio,
  parseLauncherRatio,
  readLauncherHidden,
  readLauncherRatio,
  shouldShowLauncher,
  subscribeLauncherHidden,
  writeLauncherHidden,
  writeLauncherRatio,
} from "../src/features/dock/dock-launcher-state";
import type {
  FanSlot,
  LauncherStorage,
  LauncherVisibility,
} from "../src/features/dock/dock-launcher-state";

const BODY = 600;
const MAX_TOP = BODY - LAUNCHER_SIZE - LAUNCHER_CAPTION_HEIGHT - LAUNCHER_EDGE_MARGIN;

function fakeStorage(initial: Record<string, string> = {}): LauncherStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("visibility", () => {
  const at = (v: Partial<LauncherVisibility>): boolean =>
    shouldShowLauncher({
      rightDockVisible: false,
      bottomDockVisible: false,
      narrow: false,
      hidden: false,
      ...v,
    });

  it("shows on a wide layout while the right dock — the one it opens into — is hidden", () => {
    expect(at({})).toBe(true);
    expect(at({ bottomDockVisible: true })).toBe(true);
  });

  it("hides while the right dock is on screen", () => {
    expect(at({ rightDockVisible: true })).toBe(false);
  });

  it("shows on a narrow layout while neither dock is up", () => {
    expect(at({ narrow: true })).toBe(true);
  });

  it("hides behind the narrow merged surface, whichever dock put it there", () => {
    expect(at({ narrow: true, rightDockVisible: true })).toBe(false);
    expect(at({ narrow: true, bottomDockVisible: true })).toBe(false);
  });

  it("stays away once the user put it away, whatever the layout", () => {
    expect(at({ hidden: true })).toBe(false);
    expect(at({ hidden: true, narrow: true })).toBe(false);
  });
});

describe("put away", () => {
  it('hides only on the stored "1"; anything else — absent, stale, garbage — shows it', () => {
    expect(readLauncherHidden(fakeStorage({ [LAUNCHER_HIDDEN_KEY]: "1" }))).toBe(true);
    expect(readLauncherHidden(fakeStorage())).toBe(false);
    expect(readLauncherHidden(fakeStorage({ [LAUNCHER_HIDDEN_KEY]: "0" }))).toBe(false);
    expect(readLauncherHidden(fakeStorage({ [LAUNCHER_HIDDEN_KEY]: "yes" }))).toBe(false);
  });

  it("writes both states and notifies subscribers, so both renderers of it follow", () => {
    const storage = fakeStorage();
    let seen = 0;
    const stop = subscribeLauncherHidden(() => {
      seen += 1;
    });
    const before = launcherHiddenVersion();
    writeLauncherHidden(true, storage);
    expect(readLauncherHidden(storage)).toBe(true);
    writeLauncherHidden(false, storage);
    expect(readLauncherHidden(storage)).toBe(false);
    expect(seen).toBe(2);
    expect(launcherHiddenVersion()).toBe(before + 2);
    stop();
    writeLauncherHidden(true, storage);
    expect(seen).toBe(2);
  });

  it("survives a storage that throws, and still tells this session", () => {
    const broken: LauncherStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLauncherHidden(broken)).toBe(false);
    const before = launcherHiddenVersion();
    expect(() => writeLauncherHidden(true, broken)).not.toThrow();
    expect(launcherHiddenVersion()).toBe(before + 1);
  });
});

describe("clamping", () => {
  it("keeps a top offset inside the body with the edge margin and the caption", () => {
    expect(clampLauncherTop(200, BODY)).toBe(200);
    expect(clampLauncherTop(-50, BODY)).toBe(LAUNCHER_EDGE_MARGIN);
    expect(clampLauncherTop(5000, BODY)).toBe(MAX_TOP);
  });

  it("pins the ball at the top margin when the body is too short for it", () => {
    expect(clampLauncherTop(30, 40)).toBe(LAUNCHER_EDGE_MARGIN);
  });

  it("leaves room below the ball for its caption, on top of the margin", () => {
    const ballBottom = clampLauncherTop(5000, BODY) + LAUNCHER_SIZE;
    expect(BODY - ballBottom).toBe(LAUNCHER_CAPTION_HEIGHT + LAUNCHER_EDGE_MARGIN);
  });

  it("treats a non-finite offset as the top margin", () => {
    expect(clampLauncherTop(Number.NaN, BODY)).toBe(LAUNCHER_EDGE_MARGIN);
  });
});

describe("ratio round trip", () => {
  it("centres the ball for the default ratio", () => {
    const top = launcherTopFromRatio(DEFAULT_LAUNCHER_RATIO, BODY);
    expect(top + LAUNCHER_SIZE / 2).toBe(BODY / 2);
  });

  it("clamps the extremes to the margins", () => {
    expect(launcherTopFromRatio(0, BODY)).toBe(LAUNCHER_EDGE_MARGIN);
    expect(launcherTopFromRatio(1, BODY)).toBe(MAX_TOP);
  });

  it("recovers the ratio a top offset was derived from", () => {
    for (const ratio of [0.2, 0.5, 0.8]) {
      expect(launcherRatioFromTop(launcherTopFromRatio(ratio, BODY), BODY)).toBeCloseTo(ratio, 6);
    }
  });

  it("falls back to the default ratio for a body with no height", () => {
    expect(launcherRatioFromTop(100, 0)).toBe(DEFAULT_LAUNCHER_RATIO);
  });
});

describe("stored ratio", () => {
  it("parses a decimal and clamps it into [0, 1]", () => {
    expect(parseLauncherRatio("0.25")).toBe(0.25);
    expect(parseLauncherRatio("1.7")).toBe(1);
    expect(parseLauncherRatio("-2")).toBe(0);
  });

  it("rejects anything that is not a number", () => {
    expect(parseLauncherRatio(null)).toBeNull();
    expect(parseLauncherRatio(undefined)).toBeNull();
    expect(parseLauncherRatio("")).toBeNull();
    expect(parseLauncherRatio("middle")).toBeNull();
    expect(parseLauncherRatio("Infinity")).toBeNull();
  });

  it("reads back what it wrote, under the one global key", () => {
    const storage = fakeStorage();
    writeLauncherRatio(0.3, storage);
    expect(storage.map.get(LAUNCHER_Y_KEY)).toBe("0.3");
    expect(readLauncherRatio(storage)).toBe(0.3);
  });

  it("falls back to the default when the entry is missing or malformed", () => {
    expect(readLauncherRatio(fakeStorage())).toBe(DEFAULT_LAUNCHER_RATIO);
    expect(readLauncherRatio(fakeStorage({ [LAUNCHER_Y_KEY]: "{}" }))).toBe(DEFAULT_LAUNCHER_RATIO);
  });

  it("survives a storage that throws", () => {
    const broken: LauncherStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLauncherRatio(broken)).toBe(DEFAULT_LAUNCHER_RATIO);
    expect(() => writeLauncherRatio(0.4, broken)).not.toThrow();
  });
});

describe("drag", () => {
  it("tracks the pointer along the edge while inside the bounds", () => {
    expect(dragPosition(200, 0, 40, BODY)).toEqual({ x: 0, top: 240 });
  });

  it("rubberbands past the body's ends instead of stopping or escaping", () => {
    const past = dragPosition(MAX_TOP, 0, 300, BODY);
    expect(past.top).toBeGreaterThan(MAX_TOP);
    expect(past.top).toBeLessThan(MAX_TOP + 60);
    const further = dragPosition(MAX_TOP, 0, 600, BODY);
    expect(further.top).toBeGreaterThan(past.top);
    const above = dragPosition(LAUNCHER_EDGE_MARGIN, 0, -300, BODY);
    expect(above.top).toBeLessThan(LAUNCHER_EDGE_MARGIN);
    expect(above.top).toBeGreaterThan(LAUNCHER_EDGE_MARGIN - 60);
  });

  it("lets the ball be pulled off the edge only a damped distance", () => {
    const pulled = dragPosition(200, -120, 0, BODY);
    expect(pulled.x).toBeLessThan(0);
    expect(pulled.x).toBeGreaterThan(-40);
    expect(Math.abs(pulled.x)).toBeLessThan(120);
    expect(dragPosition(200, 120, 0, BODY).x).toBeGreaterThan(0);
  });

  it("settles a released drag back inside the body", () => {
    const { top } = dragPosition(MAX_TOP, 0, 300, BODY);
    expect(clampLauncherTop(top, BODY)).toBe(MAX_TOP);
  });
});

describe("fan layout", () => {
  /** Five panel kinds, the terminal, and the hide entry. */
  const COUNT = 7;
  const TALL = 900;
  /** The ball centred in a body tall enough for the whole semicircle. */
  const MIDDLE = TALL / 2 - LAUNCHER_SIZE / 2;
  const ENTRY_RADIUS = FAN_ENTRY_SIZE / 2;

  /** The slot's angle on the arc: 0 straight up, pi/2 straight left, pi straight down. */
  const angleOf = (slot: FanSlot): number => Math.atan2(-slot.x, -slot.y);

  function expectInside(slots: FanSlot[], top: number, bodyHeight: number): void {
    const centerY = top + LAUNCHER_SIZE / 2;
    for (const slot of slots) {
      expect(centerY + slot.y - ENTRY_RADIUS).toBeGreaterThanOrEqual(0);
      expect(centerY + slot.y + ENTRY_RADIUS).toBeLessThanOrEqual(bodyHeight);
    }
  }

  it("spreads the entries evenly over the whole semicircle in the middle of a tall body", () => {
    const angles = fanLayout(MIDDLE, TALL, COUNT).map(angleOf);
    expect(angles[0]).toBeCloseTo(0, 6);
    expect(angles.at(-1)).toBeCloseTo(Math.PI, 6);
    const step = Math.PI / (COUNT - 1);
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]! - angles[i - 1]!).toBeCloseTo(step, 6);
    }
  });

  it("puts every entry on the circle, left of the ball, in top-to-bottom order", () => {
    const slots = fanLayout(MIDDLE, TALL, COUNT);
    let previousY = -Infinity;
    for (const slot of slots) {
      expect(Math.hypot(slot.x, slot.y)).toBeCloseTo(FAN_RADIUS, 6);
      expect(slot.x).toBeLessThanOrEqual(0);
      expect(slot.y).toBeGreaterThan(previousY);
      previousY = slot.y;
    }
  });

  it("stands the arc's end labels above and below it, and the rest beside", () => {
    const sides = fanLayout(MIDDLE, TALL, COUNT).map((slot) => slot.labelSide);
    expect(sides[0]).toBe("above");
    expect(sides.at(-1)).toBe("below");
    expect(sides.slice(1, -1)).toEqual(Array<string>(COUNT - 2).fill("left"));
  });

  it("trims the arc's top near the body's top, keeping every entry inside", () => {
    const slots = fanLayout(LAUNCHER_EDGE_MARGIN, TALL, COUNT);
    expectInside(slots, LAUNCHER_EDGE_MARGIN, TALL);
    // What is left runs from around straight left down to straight below the ball.
    expect(angleOf(slots[0]!)).toBeGreaterThan(Math.PI / 3);
    expect(angleOf(slots.at(-1)!)).toBeCloseTo(Math.PI, 6);
  });

  it("trims the arc's bottom near the body's bottom, keeping every entry inside", () => {
    const top = clampLauncherTop(TALL, TALL);
    const slots = fanLayout(top, TALL, COUNT);
    expectInside(slots, top, TALL);
    expect(angleOf(slots[0]!)).toBeCloseTo(0, 6);
    expect(angleOf(slots.at(-1)!)).toBeLessThan(Math.PI - 0.1);
  });

  it("centres a lone entry on the span and puts a pair at its ends", () => {
    const [only] = fanLayout(MIDDLE, TALL, 1);
    expect(angleOf(only!)).toBeCloseTo(Math.PI / 2, 6);
    expect(only!.labelSide).toBe("left");
    const pair = fanLayout(MIDDLE, TALL, 2);
    expect(pair.map(angleOf)).toEqual([expect.closeTo(0, 6), expect.closeTo(Math.PI, 6)]);
    expect(fanLayout(MIDDLE, TALL, 0)).toEqual([]);
  });
});
