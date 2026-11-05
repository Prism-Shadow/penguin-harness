/**
 * ticket-press.ts unit tests: a press released inside the slop is a click and lets its click
 * through; a mouse or pen press that moves past the slop lifts the card at once, with no timer; a
 * touch lifts it only after the long press and gives the press up when it moves first; a release
 * drops a lifted card and swallows the click that follows, for a short window only; a cancel
 * (Escape) puts a lifted card back; only the main button of the primary pointer presses. Plus the
 * edge-scroll step a lifted card drives. Timings run on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLICK_GUARD_MS,
  LONG_PRESS_MS,
  PRESS_SLOP_PX,
  createTicketPress,
  edgeScrollStep,
} from "../src/features/company/ticket-press";
import type { PressStart } from "../src/features/company/ticket-press";

function setup(pointerType = "mouse") {
  const calls: string[] = [];
  const press = createTicketPress({
    lift: (at) => calls.push(`lift ${at.x},${at.y}`),
    drag: (at) => calls.push(`drag ${at.x},${at.y}`),
    drop: (at) => calls.push(`drop ${at.x},${at.y}`),
    cancel: () => calls.push("cancel"),
  });
  const down = (x = 10, y = 10, over: Partial<PressStart> = {}) =>
    press.down({ pointerId: 1, button: 0, isPrimary: true, pointerType, x, y, ...over });
  const move = (x: number, y: number, pointerId = 1) => press.move({ pointerId, x, y });
  const up = (x: number, y: number, pointerId = 1) => press.up({ pointerId, x, y });
  return { press, calls, down, move, up };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ticket card press: mouse and pen", () => {
  it.each(["mouse", "pen"])(
    "%s: a press released inside the slop is a click, and its click opens the card",
    (pointerType) => {
      const { press, calls, down, move, up } = setup(pointerType);
      down(10, 10);
      move(10 + PRESS_SLOP_PX, 10 - PRESS_SLOP_PX);
      up(10 + PRESS_SLOP_PX, 10 - PRESS_SLOP_PX);
      expect(calls).toEqual([]);
      expect(press.phase()).toBe("idle");
      expect(press.consumeClick()).toBe(false);
    },
  );

  it.each(["mouse", "pen"])(
    "%s: moving past the slop lifts the card at once, with no timer, and it follows to the drop",
    (pointerType) => {
      const { press, calls, down, move, up } = setup(pointerType);
      down(10, 20);
      expect(vi.getTimerCount()).toBe(0);
      move(10 + PRESS_SLOP_PX + 1, 20);
      expect(press.phase()).toBe("lifted");
      expect(calls).toEqual(["lift 10,20", `drag ${10 + PRESS_SLOP_PX + 1},20`]);
      move(200, 40);
      up(210, 44);
      expect(calls.slice(2)).toEqual(["drag 200,40", "drop 210,44"]);
      expect(press.phase()).toBe("idle");
    },
  );

  it("swallows the click a drag produces, once, even when released where it started", () => {
    const { press, calls, down, move, up } = setup();
    down(10, 10);
    move(40, 10);
    move(10, 10);
    up(10, 10);
    expect(calls).toEqual(["lift 10,10", "drag 40,10", "drag 10,10", "drop 10,10"]);
    expect(press.consumeClick()).toBe(true);
    expect(press.consumeClick()).toBe(false);
  });

  it("puts a dragged card back on Escape: no drop, and its click is swallowed", () => {
    const { press, calls, down, move, up } = setup();
    down();
    move(80, 10);
    press.cancel();
    expect(press.phase()).toBe("idle");
    move(120, 10);
    up(120, 10);
    expect(calls).toEqual(["lift 10,10", "drag 80,10", "cancel"]);
    expect(press.consumeClick()).toBe(true);
  });

  it("ends a press cancelled before it moved without lifting or swallowing anything", () => {
    const { press, calls, down, move, up } = setup();
    down();
    press.cancel();
    move(100, 10);
    up(100, 10);
    expect(calls).toEqual([]);
    expect(press.phase()).toBe("idle");
    expect(press.consumeClick()).toBe(false);
  });
});

describe("ticket card press: touch", () => {
  it("opens on a tap: released before the hold completes, nothing lifts", () => {
    const { press, calls, down, up } = setup("touch");
    down();
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    up(10, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(calls).toEqual([]);
    expect(press.phase()).toBe("idle");
    expect(press.consumeClick()).toBe(false);
  });

  it("lifts only after the hold, through a wobble inside the slop, then drags and drops", () => {
    const { press, calls, down, move, up } = setup("touch");
    down(10, 20);
    move(10 + PRESS_SLOP_PX, 20 - PRESS_SLOP_PX);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(calls).toEqual([]);
    expect(press.phase()).toBe("pressing");
    vi.advanceTimersByTime(1);
    expect(press.phase()).toBe("lifted");
    move(200, 40);
    up(210, 44);
    expect(calls).toEqual(["lift 10,20", "drag 200,40", "drop 210,44"]);
    expect(press.consumeClick()).toBe(true);
  });

  it("swallows the click of a hold released in place", () => {
    const { press, calls, down, up } = setup("touch");
    down(50, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    up(50, 50);
    expect(calls).toEqual(["lift 50,50", "drop 50,50"]);
    expect(press.consumeClick()).toBe(true);
  });

  it("gives the press up when the finger moves past the slop first: it scrolls, nothing lifts", () => {
    const { press, calls, down, move, up } = setup("touch");
    down(10, 10);
    vi.advanceTimersByTime(100);
    move(10, 10 + PRESS_SLOP_PX + 1);
    expect(press.phase()).toBe("idle");
    vi.advanceTimersByTime(LONG_PRESS_MS);
    move(10, 200);
    up(10, 200);
    expect(calls).toEqual([]);
    expect(press.consumeClick()).toBe(false);
  });

  it("ends a press the browser took over for a scroll: the hold never completes", () => {
    const { press, calls, down } = setup("touch");
    down();
    vi.advanceTimersByTime(100);
    press.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(calls).toEqual([]);
    expect(press.phase()).toBe("idle");
    expect(press.consumeClick()).toBe(false);
  });
});

describe("ticket card press: any pointer", () => {
  it("ignores a secondary button, a non-primary pointer and another pointer's events", () => {
    const { press, calls, down, move, up } = setup();
    down(10, 10, { button: 2 });
    down(10, 10, { isPrimary: false });
    expect(press.phase()).toBe("idle");
    down(10, 10);
    move(400, 400, 2);
    up(400, 400, 2);
    expect(press.phase()).toBe("pressing");
    expect(calls).toEqual([]);
    move(400, 400);
    expect(calls).toEqual(["lift 10,10", "drag 400,400"]);
  });

  it("puts back a lifted card whose release was lost when the next press starts", () => {
    const { press, calls, down, move } = setup();
    down();
    move(100, 10);
    down(50, 50);
    expect(calls).toEqual(["lift 10,10", "drag 100,10", "cancel"]);
    expect(press.phase()).toBe("pressing");
  });

  it("forgets the click guard after its window, and on the next press", () => {
    const { press, down, move, up } = setup();
    down();
    move(100, 10);
    up(100, 10);
    vi.advanceTimersByTime(CLICK_GUARD_MS);
    // A screen reader's activation long after the drag still opens the card.
    expect(press.consumeClick()).toBe(false);

    down();
    move(100, 10);
    up(100, 10);
    down();
    up(10, 10);
    expect(press.consumeClick()).toBe(false);
  });

  it("stops everything on dispose", () => {
    const { press, calls, down } = setup("touch");
    down();
    press.dispose();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(calls).toEqual([]);
    expect(press.phase()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("edge scroll step", () => {
  it("scrolls toward the edge the pointer is held near, faster the deeper it goes", () => {
    expect(edgeScrollStep(500, 0, 1000)).toBe(0);
    expect(edgeScrollStep(40, 0, 1000)).toBeLessThan(0);
    expect(edgeScrollStep(0, 0, 1000)).toBeLessThan(edgeScrollStep(40, 0, 1000));
    expect(edgeScrollStep(960, 0, 1000)).toBeGreaterThan(0);
    expect(edgeScrollStep(1000, 0, 1000)).toBeGreaterThan(edgeScrollStep(960, 0, 1000));
  });

  it("caps the step once the pointer leaves the container", () => {
    expect(edgeScrollStep(-500, 0, 1000)).toBe(edgeScrollStep(0, 0, 1000));
    expect(edgeScrollStep(5000, 0, 1000)).toBe(edgeScrollStep(1000, 0, 1000));
  });

  it("does not scroll a container too small to have a middle", () => {
    expect(edgeScrollStep(10, 0, 90)).toBe(0);
  });
});
