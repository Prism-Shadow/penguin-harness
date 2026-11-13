// @vitest-environment jsdom
/**
 * The floating ball on a live page (src/components/shell/floating-ball/floating-ball.tsx), held
 * by a caller that stores every placement it is handed, the way a page persists it. jsdom lays
 * nothing out, so the suite gives the ball's area its size and plays the resize the browser
 * would report; spring frames run on a faked animation clock.
 *
 * - Given a press that travels under the drag threshold, the release is a click: the ball
 *   activates once and nothing is stored.
 * - Given a drag past the threshold, the ball follows the pointer; on release it stores the
 *   side it was let go on, springs to that edge, and the click the browser fires after the
 *   drag does not activate it.
 * - Given a press, the area takes the pointer until the release or a cancel hands it back, and
 *   a cancelled drag returns to where it rested and stores nothing.
 * - Given a release pushed into the edge, the ball is stored tucked, and a handle on that edge
 *   at the ball's height replaces it; the pointer's gesture moves no focus onto the handle.
 * - Given the × from the keyboard, the ball tucks and focus moves to the handle; given the handle
 *   from the keyboard, the ball comes back to the same edge and height with the focus. Clicked
 *   with a pointer, neither moves the focus.
 * - Given the keyboard, Enter or Space on the ball activates it, straight after a drag too.
 * - Given an area that shrinks, the ball moves to stay inside it and nothing is stored; given
 *   the area growing back, the ball returns to the height it was placed at.
 */
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingBall } from "../src/components/shell/floating-ball/floating-ball";
import type { FloatingBallPlacement } from "../src/components/shell/floating-ball/floating-ball-geometry";
import { fire, mount, pointerEvent, unmountAll } from "./helpers/dom";

const SIZE = 40;
const INSET = 10;
const CORNER: FloatingBallPlacement = { side: "right", ratio: 1, tucked: false };

/** The area's laid-out size, which the faked layout reports, and the observers watching it. */
let areaSize = { width: 800, height: 600 };
const observers = new Set<() => void>();

function Caller(props: {
  initial: FloatingBallPlacement;
  stored: FloatingBallPlacement[];
  onActivate: () => void;
}) {
  const [placement, setPlacement] = useState(props.initial);
  return createElement(FloatingBall, {
    placement,
    onChange: (next: FloatingBallPlacement) => {
      props.stored.push(next);
      setPlacement(next);
    },
    onActivate: props.onActivate,
    glyph: "G",
    label: "Exit",
    tuckLabel: "Tuck away",
    showLabel: "Show",
    size: SIZE,
    inset: INSET,
    tuckZone: 8,
    dragThreshold: 4,
  });
}

async function setUp(initial: FloatingBallPlacement = CORNER) {
  const stored: FloatingBallPlacement[] = [];
  const onActivate = vi.fn();
  await mount(createElement(Caller, { initial, stored, onActivate }));
  return { stored, onActivate };
}

const area = () => document.querySelector<HTMLElement>('[data-testid="floating-ball-area"]')!;
const ball = () => document.querySelector<HTMLButtonElement>('[data-testid="floating-ball"]');
const named = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
/** Where the ball's wrapper is drawn, as its top-left corner inside the area. */
const drawnAt = () => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
    ball()!.parentElement!.style.transform,
  );
  return match ? { left: Number(match[1]), top: Number(match[2]) } : null;
};
const restRight = () => ({
  left: areaSize.width - SIZE - INSET,
  top: areaSize.height - SIZE - INSET,
});

async function press(x: number, y: number) {
  await fire(ball()!, pointerEvent("pointerdown", "mouse", x, y));
}
async function moveTo(x: number, y: number) {
  await fire(window, pointerEvent("pointermove", "mouse", x, y));
}
async function release(x: number, y: number, type = "pointerup") {
  await fire(window, pointerEvent(type, "mouse", x, y));
}
/** The click a browser fires after a pointer's release (`detail` 1) or for Enter / Space (0). */
async function click(target: HTMLElement, detail: number) {
  await fire(target, new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
}
async function resize(width: number, height: number) {
  areaSize = { width, height };
  await act(async () => {
    for (const notify of observers) notify();
  });
}
async function runFrames() {
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
}

beforeEach(() => {
  areaSize = { width: 800, height: 600 };
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly notify: () => void;
      constructor(callback: () => void) {
        this.notify = () => callback();
      }
      observe() {
        observers.add(this.notify);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.notify);
      }
    },
  );
  const measured = (axis: "width" | "height") =>
    function (this: Element) {
      return this.getAttribute("data-testid") === "floating-ball-area" ? areaSize[axis] : 0;
    };
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(measured("width"));
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(measured("height"));
});

afterEach(async () => {
  await unmountAll();
  observers.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a floating ball", () => {
  it("activates on a press that travels under the drag threshold, storing nothing", async () => {
    const { stored, onActivate } = await setUp();
    expect(drawnAt()).toEqual(restRight());
    await press(770, 570);
    await moveTo(773, 570);
    expect(drawnAt()).toEqual(restRight());
    await release(773, 570);
    await click(ball()!, 1);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(stored).toEqual([]);
  });

  it("follows a drag, stores the side it was let go on, and is not activated by the drag's click", async () => {
    const { stored, onActivate } = await setUp();
    await press(770, 570);
    await moveTo(370, 270);
    expect(drawnAt()).toEqual({ left: restRight().left - 400, top: restRight().top - 300 });
    await release(370, 270);
    await click(ball()!, 1);
    expect(onActivate).not.toHaveBeenCalled();
    expect(stored).toEqual([
      { side: "left", ratio: (restRight().top - 300 + SIZE / 2) / 600, tucked: false },
    ]);
    await runFrames();
    expect(drawnAt()).toEqual({ left: INSET, top: restRight().top - 300 });
  });

  it("covers the page while a press is live, and a cancelled drag goes back and stores nothing", async () => {
    const { stored } = await setUp();
    expect(area().style.pointerEvents).toBe("");
    await press(770, 570);
    expect(area().style.pointerEvents).toBe("auto");
    await moveTo(500, 300);
    await release(500, 300, "pointercancel");
    expect(area().style.pointerEvents).toBe("");
    await runFrames();
    expect(drawnAt()).toEqual(restRight());
    expect(stored).toEqual([]);
    await press(770, 570);
    await release(770, 570);
    expect(area().style.pointerEvents).toBe("");
  });

  it("tucks when let go pushed into its edge, leaving a handle there without taking the focus", async () => {
    const { stored } = await setUp();
    await act(async () => ball()!.focus());
    await press(770, 300);
    await moveTo(830, 300);
    await release(830, 300);
    expect(stored).toEqual([expect.objectContaining({ side: "right", tucked: true })]);
    expect(ball()).toBeNull();
    const handle = named("Show")!;
    expect(handle.style.right).toBe("0px");
    expect(handle.style.top).toBe(`${restRight().top}px`);
    expect(document.activeElement).not.toBe(handle);
  });

  it("tucks from its × and comes back from the handle to the same place, the keyboard's focus with it", async () => {
    const { stored } = await setUp({ side: "left", ratio: 0.5, tucked: false });
    const placed = drawnAt();
    const cross = named("Tuck away")!;
    await act(async () => cross.focus());
    await click(cross, 0);
    expect(stored.at(-1)).toEqual({ side: "left", ratio: 0.5, tucked: true });
    const handle = named("Show")!;
    expect(handle.style.left).toBe("0px");
    expect(document.activeElement).toBe(handle);
    await click(handle, 0);
    expect(stored.at(-1)).toEqual({ side: "left", ratio: 0.5, tucked: false });
    expect(drawnAt()).toEqual(placed);
    expect(document.activeElement).toBe(ball());
  });

  it("moves no focus when its × and the handle are clicked with a pointer", async () => {
    const { stored } = await setUp();
    const cross = named("Tuck away")!;
    await act(async () => cross.focus());
    await click(cross, 1);
    expect(stored.at(-1)).toMatchObject({ tucked: true });
    const handle = named("Show")!;
    expect(document.activeElement).not.toBe(handle);
    await act(async () => handle.focus());
    await click(handle, 1);
    expect(stored.at(-1)).toMatchObject({ tucked: false });
    expect(document.activeElement).not.toBe(ball());
  });

  it("activates from the keyboard, straight after a drag too", async () => {
    const { onActivate } = await setUp();
    await click(ball()!, 0);
    expect(onActivate).toHaveBeenCalledTimes(1);
    await press(770, 570);
    await moveTo(770, 400);
    await release(770, 400);
    // No pointer click followed the drag; the next press is the keyboard's.
    await click(ball()!, 0);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("stays inside an area that shrinks and returns when it grows back, storing nothing", async () => {
    const { stored } = await setUp({ side: "right", ratio: 0.9, tucked: false });
    const placed = drawnAt()!;
    await resize(800, 200);
    expect(drawnAt()).toEqual({ left: 800 - SIZE - INSET, top: 200 - SIZE - INSET });
    await resize(800, 600);
    expect(drawnAt()).toEqual(placed);
    expect(stored).toEqual([]);
  });
});
