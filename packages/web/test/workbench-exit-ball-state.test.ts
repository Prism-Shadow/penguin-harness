/**
 * Where the full-page workbench's exit ball rests, as this browser remembers it
 * (features/workbenches/exit-ball-state.ts).
 *
 * - Given a first visit, nothing stored, the ball rests in the bottom-right corner of the page.
 * - Given a placement the reader chose — another edge, another height, tucked away — the next
 *   visit reads the same placement back.
 * - Given junk under the key (not JSON, an unknown side, a ratio that is not a finite number, a
 *   `tucked` that is not a boolean), the ball reads as the corner.
 * - Given storage that throws on every call, or a `localStorage` whose accessor itself throws,
 *   reading gives the corner and writing breaks nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { floatingBallRest, FLOATING_BALL_METRICS } from "@prismshadow/penguin-ui";
import {
  EXIT_BALL_KEY,
  readExitBall,
  writeExitBall,
} from "../src/features/workbenches/exit-ball-state";
import { blockedStorage, memoryStorage } from "./helpers/storage";

const PAGE = { width: 1280, height: 720 };

describe("the exit ball's remembered placement", () => {
  it("rests in the bottom-right corner on a first visit", () => {
    const placement = readExitBall(memoryStorage());
    expect(placement.tucked).toBe(false);
    const { size, inset } = FLOATING_BALL_METRICS;
    const rest = floatingBallRest(placement, PAGE);
    expect(rest.left + size).toBe(PAGE.width - inset);
    expect(rest.top + size).toBe(PAGE.height - inset);
  });

  it("reads back the edge, the height and the tucked state the reader chose", () => {
    const storage = memoryStorage();
    writeExitBall({ side: "left", ratio: 0.25, tucked: true }, storage);
    expect(readExitBall(storage)).toEqual({ side: "left", ratio: 0.25, tucked: true });
    writeExitBall({ side: "left", ratio: 0.25, tucked: false }, storage);
    expect(readExitBall(storage)).toEqual({ side: "left", ratio: 0.25, tucked: false });
  });

  it.each([
    ["not JSON", "{side:left"],
    ["an unknown side", JSON.stringify({ side: "top", ratio: 0.5, tucked: false })],
    ["a ratio that is not a number", JSON.stringify({ side: "left", ratio: "0.5" })],
    ["a ratio that is not finite", '{"side":"left","ratio":1e999}'],
    ["a tucked that is not a boolean", JSON.stringify({ side: "left", ratio: 0.5, tucked: 1 })],
  ])("reads %s as the corner", (_case, raw) => {
    const placement = readExitBall(memoryStorage({ [EXIT_BALL_KEY]: raw }));
    expect(placement).toEqual(readExitBall(memoryStorage()));
  });

  it("survives storage that throws, and a localStorage accessor that throws", () => {
    const broken = blockedStorage();
    expect(() => writeExitBall({ side: "left", ratio: 0.5, tucked: true }, broken)).not.toThrow();
    expect(readExitBall(broken)).toEqual(readExitBall(memoryStorage()));
    vi.stubGlobal("localStorage", undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(() => writeExitBall({ side: "left", ratio: 0.5, tucked: true })).not.toThrow();
    expect(readExitBall()).toEqual(readExitBall(memoryStorage()));
  });
});
