// @vitest-environment jsdom
/**
 * Inspecting a plot frame without a mouse (src/components/charts/chart-frame), held by a caller
 * that keeps the hovered bucket the way a chart does. jsdom lays nothing out, so the frame sits
 * at the viewport's left edge.
 *
 * - Given an inspectable frame, it is a focusable group under the caller's name; a plain frame
 *   stays an image out of the tab order.
 * - Given the keyboard, the first arrow press opens the bucket at that end, the arrows then step
 *   one bucket and stop at the ends, Home and End jump, and Esc closes the bubble.
 * - Given a tap, the bucket under the finger opens; a mouse press opens nothing, since hovering
 *   already did.
 */
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChartFrame } from "../src/components/charts/chart-frame/chart-frame";
import { makeGeom } from "../src/components/charts/chart-frame/chart-geom";
import { fire, mount, pointerEvent, unmountAll } from "./helpers/dom";

const GEOM = makeGeom(3, 100, 640);
const DATES = ["2026-09-01", "2026-09-02", "2026-09-03"];

function Chart({ inspectable }: { inspectable: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  return createElement(ChartFrame, {
    geom: GEOM,
    fmtY: String,
    dates: DATES,
    hover,
    onHover: setHover,
    bubble: (i: number) => `day ${DATES[i]}`,
    label: "Cost, last 3 days",
    inspectable,
  });
}

async function chart(inspectable = true) {
  const { container } = await mount(createElement(Chart, { inspectable }));
  const svg = container.querySelector("svg")!;
  return {
    svg,
    press: (key: string) => fire(svg, new KeyboardEvent("keydown", { key, bubbles: true })),
    open: () => container.querySelector('[role="tooltip"]')?.textContent ?? null,
  };
}

afterEach(unmountAll);

describe("an inspectable ChartFrame", () => {
  it("is a focusable group under the caller's name, where a plain frame is an image", async () => {
    const { svg } = await chart();
    expect(svg.getAttribute("role")).toBe("group");
    expect(svg.getAttribute("aria-label")).toBe("Cost, last 3 days");
    expect(svg.tabIndex).toBe(0);

    await unmountAll();
    const plain = await chart(false);
    expect(plain.svg.getAttribute("role")).toBe("img");
    expect(plain.svg.hasAttribute("tabindex")).toBe(false);
  });

  it("walks the buckets with the arrow keys, jumps with Home and End, and closes on Esc", async () => {
    const { press, open } = await chart();
    await press("ArrowLeft");
    expect(open()).toBe("day 2026-09-03");
    await press("ArrowRight");
    expect(open()).toBe("day 2026-09-03");
    await press("Home");
    expect(open()).toBe("day 2026-09-01");
    await press("ArrowLeft");
    expect(open()).toBe("day 2026-09-01");
    await press("ArrowRight");
    expect(open()).toBe("day 2026-09-02");
    await press("End");
    expect(open()).toBe("day 2026-09-03");
    await press("Escape");
    expect(open()).toBeNull();
    await press("ArrowRight");
    expect(open()).toBe("day 2026-09-01");
  });

  it("opens the bucket under a tap, and nothing on a mouse press", async () => {
    const { svg, open } = await chart();
    await fire(svg, pointerEvent("pointerdown", "mouse", GEOM.x(1), 50));
    expect(open()).toBeNull();
    await fire(svg, pointerEvent("pointerdown", "touch", GEOM.x(1), 50));
    expect(open()).toBe("day 2026-09-02");
  });
});
