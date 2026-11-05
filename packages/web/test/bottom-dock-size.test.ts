/**
 * The bottom dock's docked height (features/dock/bottom-dock-size.ts).
 *
 * - At every stored ratio the dock leaves the composer whole, however short the column.
 * - With room to spare, a large ratio stops at the ceiling: the composer plus a strip of messages
 *   tall enough for the launcher ball and its caption; a smaller ratio is drawn as stored.
 * - When the column runs short, the strip gives way first, then the dock's own minimum.
 * - The ratio's own ceiling still caps a very tall column, and a fractional measurement never
 *   rounds the dock onto the composer.
 * - The largest height drawn is the maximum the boundary drag snaps against.
 * - The chat page measures its composer box for the dock to read.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_MIN_HEIGHT_PX,
  DOCK_MIN_HEIGHT_PX,
  DOCK_RATIO_MAX,
  bottomDockHeight,
  bottomDockMaxHeight,
  type BottomDockSpace,
} from "../src/features/dock/bottom-dock-size";
import { launcherBounds } from "../src/features/dock/dock-launcher-state";

/** A column with a toolbar of this height above the area the row and the dock share. */
const TOOLBAR = 45;
const COMPOSER = 142;

function column(host: number, composer = COMPOSER): BottomDockSpace {
  return { host, area: host - TOOLBAR, composer };
}

describe("bottomDockHeight", () => {
  it("leaves the composer whole at every ratio, however short the column", () => {
    for (const host of [160, 240, 320, 480, 640, 800, 1080, 1440, 2160]) {
      for (const composer of [96, COMPOSER, 320]) {
        for (const ratio of [0.15, 0.4, 0.6, DOCK_RATIO_MAX]) {
          const space = column(host, composer);
          const height = bottomDockHeight(ratio, space);
          expect(height).toBeGreaterThanOrEqual(0);
          expect(height).toBeLessThanOrEqual(Math.max(0, space.area - composer));
        }
      }
    }
  });

  it("stops a large ratio where the composer and a strip of messages keep their room", () => {
    const space = column(800);
    expect(bottomDockHeight(DOCK_RATIO_MAX, space)).toBe(
      space.area - COMPOSER - CONVERSATION_MIN_HEIGHT_PX,
    );
  });

  it("draws a ratio under the ceiling as stored", () => {
    expect(bottomDockHeight(0.4, column(800))).toBe(320);
  });

  it("keeps a strip the launcher ball and its caption fit in whole", () => {
    const { min, max } = launcherBounds(CONVERSATION_MIN_HEIGHT_PX);
    expect(max).toBe(min);
  });

  it("gives way with the strip first, then with its own minimum", () => {
    // Room under the composer for the minimum and part of the strip: the minimum holds.
    const tight: BottomDockSpace = {
      host: 600,
      area: COMPOSER + DOCK_MIN_HEIGHT_PX + 40,
      composer: COMPOSER,
    };
    expect(bottomDockHeight(DOCK_RATIO_MAX, tight)).toBe(DOCK_MIN_HEIGHT_PX);
    // Room for less than the minimum: the dock takes what there is.
    const short: BottomDockSpace = { host: 600, area: COMPOSER + 90, composer: COMPOSER };
    expect(bottomDockHeight(0.15, short)).toBe(90);
    // A composer taller than the area: nothing is left for the dock.
    const none: BottomDockSpace = { host: 600, area: COMPOSER - 10, composer: COMPOSER };
    expect(bottomDockHeight(0.4, none)).toBe(0);
  });

  it("still caps a very tall column at the ratio's ceiling", () => {
    expect(bottomDockHeight(DOCK_RATIO_MAX, column(4000))).toBe(Math.floor(DOCK_RATIO_MAX * 4000));
  });

  it("never rounds a fractional measurement onto the composer", () => {
    const space: BottomDockSpace = { host: 800.5, area: 755.6, composer: COMPOSER };
    const height = bottomDockHeight(DOCK_RATIO_MAX, space);
    expect(height).toBeLessThanOrEqual(space.area - COMPOSER - CONVERSATION_MIN_HEIGHT_PX);
  });
});

describe("bottomDockMaxHeight", () => {
  it("is the largest height drawn, the one the boundary drag snaps against", () => {
    for (const host of [320, 800, 1440, 4000]) {
      const space = column(host);
      expect(bottomDockHeight(DOCK_RATIO_MAX, space)).toBe(bottomDockMaxHeight(space));
    }
  });
});

describe("the chat page", () => {
  it("measures its composer box for the bottom dock", () => {
    const page = readFileSync(
      new URL("../src/features/chat/chat-page.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toMatch(/<WallpaperSurface\s+ref=\{measureComposer\}/);
  });
});
