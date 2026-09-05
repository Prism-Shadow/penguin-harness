/**
 * The floating dock launcher's decisions (features/dock/dock-launcher-state.ts): when it
 * shows, how its resting position clamps to the chat body and round-trips through the
 * stored ratio, how a drag is bounded, and which way the fan opens.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCHER_RATIO,
  FAN_ENTRY_GAP,
  FAN_ENTRY_SIZE,
  FAN_GAP,
  LAUNCHER_EDGE_MARGIN,
  LAUNCHER_SIZE,
  LAUNCHER_Y_KEY,
  clampLauncherTop,
  dragPosition,
  fanDirection,
  fanHeight,
  launcherRatioFromTop,
  launcherTopFromRatio,
  parseLauncherRatio,
  readLauncherRatio,
  shouldShowLauncher,
  writeLauncherRatio,
} from "../src/features/dock/dock-launcher-state";
import type { LauncherStorage } from "../src/features/dock/dock-launcher-state";

const BODY = 600;
const MAX_TOP = BODY - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN;

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
  it("shows only while the right dock is hidden on a wide layout", () => {
    expect(shouldShowLauncher({ rightDockVisible: false, narrow: false })).toBe(true);
  });

  it("hides while the right dock is on screen", () => {
    expect(shouldShowLauncher({ rightDockVisible: true, narrow: false })).toBe(false);
  });

  it("hides on a narrow layout, where the docks merge into the bottom surface", () => {
    expect(shouldShowLauncher({ rightDockVisible: false, narrow: true })).toBe(false);
    expect(shouldShowLauncher({ rightDockVisible: true, narrow: true })).toBe(false);
  });
});

describe("clamping", () => {
  it("keeps a top offset inside the body with the edge margin", () => {
    expect(clampLauncherTop(200, BODY)).toBe(200);
    expect(clampLauncherTop(-50, BODY)).toBe(LAUNCHER_EDGE_MARGIN);
    expect(clampLauncherTop(5000, BODY)).toBe(MAX_TOP);
  });

  it("pins the ball at the top margin when the body is too short for it", () => {
    expect(clampLauncherTop(30, 40)).toBe(LAUNCHER_EDGE_MARGIN);
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

describe("fan direction", () => {
  const COUNT = 6;

  it("measures the stack from the entries, their gaps and the gap to the ball", () => {
    expect(fanHeight(COUNT)).toBe(FAN_GAP + COUNT * FAN_ENTRY_SIZE + (COUNT - 1) * FAN_ENTRY_GAP);
    expect(fanHeight(0)).toBe(0);
  });

  it("rises above a ball that has room above it", () => {
    expect(fanDirection(MAX_TOP, BODY, COUNT)).toBe("up");
    expect(fanDirection(BODY / 2, BODY, COUNT)).toBe("up");
  });

  it("drops below a ball near the top", () => {
    expect(fanDirection(LAUNCHER_EDGE_MARGIN, BODY, COUNT)).toBe("down");
  });

  it("picks the roomier side when the stack fits on neither", () => {
    const short = fanHeight(COUNT); // a body only as tall as the fan itself
    expect(fanDirection(LAUNCHER_EDGE_MARGIN, short, COUNT)).toBe("down");
    expect(fanDirection(short - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN, short, COUNT)).toBe("up");
  });
});
