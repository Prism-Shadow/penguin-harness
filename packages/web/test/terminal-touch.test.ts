/**
 * Touch travel converted to wheel lines (terminal-touch.ts): the slop that separates a tap
 * from a scroll, the direction, and the remainder carried between moves.
 */
import { describe, expect, it } from "vitest";
import { TOUCH_SLOP_PX, TouchScroll } from "../src/features/terminal/terminal-touch";

const CELL = 20;

describe("TouchScroll", () => {
  it("follows nothing until a gesture starts", () => {
    const scroll = new TouchScroll();
    expect(scroll.started).toBe(false);
    expect(scroll.move(100, CELL)).toBe(0);
  });

  it("a press that barely moves stays a tap", () => {
    const scroll = new TouchScroll();
    scroll.start(200);
    expect(scroll.move(200 - (TOUCH_SLOP_PX - 1), CELL)).toBe(0);
    expect(scroll.engaged).toBe(false);
  });

  it("jitter back and forth never adds up to a scroll", () => {
    const scroll = new TouchScroll();
    scroll.start(200);
    for (let i = 0; i < 20; i++) {
      scroll.move(i % 2 === 0 ? 196 : 204, CELL);
    }
    expect(scroll.engaged).toBe(false);
  });

  it("a finger moving up scrolls to later content, one line per cell of travel", () => {
    const scroll = new TouchScroll();
    scroll.start(300);
    expect(scroll.move(300 - 3 * CELL, CELL)).toBe(3);
    expect(scroll.engaged).toBe(true);
  });

  it("a finger moving down scrolls back to earlier content", () => {
    const scroll = new TouchScroll();
    scroll.start(300);
    expect(scroll.move(300 + 2 * CELL, CELL)).toBe(-2);
  });

  it("carries the remainder, so a slow drag scrolls exactly once per cell", () => {
    const scroll = new TouchScroll();
    scroll.start(300);
    let y = 300;
    let lines = 0;
    // Half a cell at a time: every second move is worth one line, never two.
    for (let i = 0; i < 8; i++) {
      y -= CELL / 2;
      const step = scroll.move(y, CELL);
      expect(Math.abs(step)).toBeLessThanOrEqual(1);
      lines += step;
    }
    expect(lines).toBe(4);
  });

  it("keeps travel it cannot convert yet (a terminal with no measurable cell)", () => {
    const scroll = new TouchScroll();
    scroll.start(300);
    expect(scroll.move(300 - 3 * CELL, 0)).toBe(0);
    expect(scroll.move(300 - 3 * CELL, CELL)).toBe(3);
  });

  it("a new gesture starts from rest, carrying nothing from the last one", () => {
    const scroll = new TouchScroll();
    scroll.start(300);
    scroll.move(300 - CELL - CELL / 2, CELL);
    scroll.end();
    expect(scroll.started).toBe(false);
    scroll.start(300);
    expect(scroll.move(300 - (TOUCH_SLOP_PX - 1), CELL)).toBe(0);
    expect(scroll.engaged).toBe(false);
  });
});
