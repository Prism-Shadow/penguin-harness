import { describe, expect, it } from "vitest";
import {
  MAP_DEFAULT,
  MAP_MAX,
  MAP_MIN,
  MAP_STEP,
  MAP_VISIBLE_KEY,
  MAP_WIDTH_KEY,
  PLAYER_MIN,
  MAP_GUTTER,
  clampMapWidth,
  liveTargets,
  mapMaxFor,
  readMapVisible,
  readMapWidth,
  sideBySide,
  stepMapWidth,
  writeMapVisible,
  writeMapWidth,
} from "../src/features/activities/map-split";
import type { PlayerInteractable } from "../src/features/activities/player-bridge";

function memory(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    read: (key: string) => store.get(key) ?? null,
  };
}

const broken = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
};

describe("map width", () => {
  it("stays within its bounds", () => {
    expect(clampMapWidth(100)).toBe(MAP_MIN);
    expect(clampMapWidth(5000)).toBe(MAP_MAX);
    expect(clampMapWidth(400.4)).toBe(400);
    expect(clampMapWidth(Number.NaN)).toBe(MAP_DEFAULT);
  });

  it("leaves the player its minimum in a known container", () => {
    const container = 1000;
    const max = container - PLAYER_MIN - MAP_GUTTER;
    expect(mapMaxFor(container)).toBe(max);
    expect(clampMapWidth(880, container)).toBe(max);
    expect(container - clampMapWidth(880, container) - MAP_GUTTER).toBeGreaterThanOrEqual(
      PLAYER_MIN,
    );
    // A very wide container is held by the map's own maximum.
    expect(clampMapWidth(2000, 3000)).toBe(MAP_MAX);
    // Too narrow for the player's minimum still gives the map its own.
    expect(clampMapWidth(300, 400)).toBe(MAP_MIN);
  });

  it("moves by a step per arrow key, the map widening as the divider goes left", () => {
    expect(stepMapWidth(360, "ArrowLeft")).toBe(360 + MAP_STEP);
    expect(stepMapWidth(360, "ArrowRight")).toBe(360 - MAP_STEP);
    expect(stepMapWidth(MAP_MIN, "ArrowRight")).toBe(MAP_MIN);
    expect(stepMapWidth(MAP_MAX, "ArrowLeft")).toBe(MAP_MAX);
    expect(stepMapWidth(500, "Home")).toBe(MAP_MIN);
    expect(stepMapWidth(500, "End")).toBe(MAP_MAX);
    expect(stepMapWidth(500, "End", 1000)).toBe(1000 - PLAYER_MIN - MAP_GUTTER);
    expect(stepMapWidth(640, "ArrowLeft", 1000)).toBe(1000 - PLAYER_MIN - MAP_GUTTER);
    expect(stepMapWidth(500, "Enter")).toBeNull();
  });

  it("is remembered, clamped on the way in and out", () => {
    const storage = memory();
    expect(readMapWidth(storage)).toBe(MAP_DEFAULT);
    writeMapWidth(512, storage);
    expect(storage.read(MAP_WIDTH_KEY)).toBe("512");
    expect(readMapWidth(storage)).toBe(512);
    writeMapWidth(9999, storage);
    expect(readMapWidth(storage)).toBe(MAP_MAX);
    expect(readMapWidth(memory({ [MAP_WIDTH_KEY]: "wide" }))).toBe(MAP_DEFAULT);
    expect(readMapWidth(memory({ [MAP_WIDTH_KEY]: "10" }))).toBe(MAP_MIN);
  });

  it("falls back to the default when storage fails", () => {
    expect(readMapWidth(broken)).toBe(MAP_DEFAULT);
    expect(() => writeMapWidth(400, broken)).not.toThrow();
  });
});

describe("map visibility", () => {
  it("is shown unless explicitly hidden", () => {
    const storage = memory();
    expect(readMapVisible(storage)).toBe(true);
    writeMapVisible(false, storage);
    expect(storage.read(MAP_VISIBLE_KEY)).toBe("hidden");
    expect(readMapVisible(storage)).toBe(false);
    writeMapVisible(true, storage);
    expect(readMapVisible(storage)).toBe(true);
    expect(readMapVisible(memory({ [MAP_VISIBLE_KEY]: "garbage" }))).toBe(true);
  });

  it("shows the map when storage fails", () => {
    expect(readMapVisible(broken)).toBe(true);
    expect(() => writeMapVisible(false, broken)).not.toThrow();
  });
});

describe("side by side", () => {
  it("needs a panel of at least 960 pixels", () => {
    expect(sideBySide(959)).toBe(false);
    expect(sideBySide(960)).toBe(true);
    expect(sideBySide(0)).toBe(false);
    expect(sideBySide(Number.NaN)).toBe(false);
  });
});

describe("live targets", () => {
  const targets: PlayerInteractable[] = ["a", "b", "c", "d", "e"].map((id) => ({
    id,
    inputType: "CLICK",
  }));

  it("lists the first three and counts the rest", () => {
    const { shown, more } = liveTargets(targets);
    expect(shown.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(more).toBe(2);
  });

  it("counts nothing more when all fit", () => {
    expect(liveTargets(targets.slice(0, 2))).toEqual({ shown: targets.slice(0, 2), more: 0 });
    expect(liveTargets([])).toEqual({ shown: [], more: 0 });
    expect(liveTargets(targets, 5).more).toBe(0);
  });
});
