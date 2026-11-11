// @vitest-environment jsdom
/**
 * The shared `ContextMenu` on a real page (test/helpers/dom.ts), driven the way a person does.
 *
 * - A right-click opens it at the pointer and suppresses the browser's own menu on the target
 *   only; a right-click elsewhere keeps the browser's menu.
 * - Shift+F10 and the ContextMenu key open it from the focused target, against the target's box;
 *   a bare F10 does not.
 * - A press and hold on a touch screen opens it, and the click the screen replays after the hold
 *   does not also activate the target.
 * - Esc closes it and hands focus back to the target; a row that acts closes it first.
 * - Nested targets: the innermost under the gesture owns it, and the outer one opens on its own
 *   space.
 * - A disabled menu leaves the browser's menu alone.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement as h, type ReactNode } from "react";
import { ContextMenu } from "../src/components/overlays/context-menu/context-menu";
import { MenuItem } from "../src/components/overlays/menu/menu";
import { LONG_PRESS_MS } from "../src/components/overlays/portal-panel/context-menu";
import { fire, itemNamed, mount, pointerEvent, pressEscape, unmountAll } from "./helpers/dom";

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
});

function Target({
  label,
  disabled = false,
  onPick = () => undefined,
  onActivate = () => undefined,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPick?: () => void;
  onActivate?: () => void;
  children?: ReactNode;
}) {
  return h(ContextMenu, {
    label,
    disabled,
    items: (close: () => void) =>
      h(MenuItem, {
        label: `${label} action`,
        onSelect: () => {
          close();
          onPick();
        },
      }),
    children: (target) =>
      h(
        "div",
        { ref: target.ref, ...target.props, "data-target": label },
        h(
          "button",
          {
            type: "button",
            onClick: () => {
              if (target.consumeLongPressClick()) return;
              onActivate();
            },
          },
          label,
        ),
        children,
      ),
  });
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const target = (label: string) => document.querySelector<HTMLElement>(`[data-target="${label}"]`)!;
const buttonIn = (label: string) => target(label).querySelector("button")!;

/** A right-click at a point; whether the browser's own menu was suppressed. */
async function rightClick(el: Element, x: number, y: number): Promise<boolean> {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: x,
    clientY: y,
  });
  await fire(el, event);
  return event.defaultPrevented;
}

async function key(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
  el.focus();
  await fire(el, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

it("opens at the pointer on a right-click, and keeps the browser's menu off the target only", async () => {
  await mount(h(Target, { label: "Tile" }));
  expect(await rightClick(buttonIn("Tile"), 120, 80)).toBe(true);
  expect(menu()?.getAttribute("aria-label")).toBe("Tile");
  const panel = menu()!.parentElement!;
  // Hung off the point the click landed on, a little below it.
  expect(panel.style.left).toBe("120px");
  expect(Number.parseFloat(panel.style.top)).toBeGreaterThan(80);
  // Opening moves focus to the first row.
  expect(document.activeElement?.textContent).toBe("Tile action");
  await pressEscape();

  expect(await rightClick(document.body, 10, 10)).toBe(false);
  expect(menu()).toBeNull();
});

it("opens from the keyboard on Shift+F10 and the ContextMenu key, against the target's box", async () => {
  await mount(h(Target, { label: "Tile" }));
  target("Tile").getBoundingClientRect = () =>
    ({ top: 200, bottom: 240, left: 30, right: 130, width: 100, height: 40 }) as DOMRect;
  await key(buttonIn("Tile"), { key: "F10", shiftKey: true });
  expect(menu()).not.toBeNull();
  expect(menu()!.parentElement!.style.left).toBe("30px");
  await pressEscape();
  expect(menu()).toBeNull();

  await key(buttonIn("Tile"), { key: "ContextMenu" });
  expect(menu()).not.toBeNull();
  await pressEscape();
  // A bare F10 is ordinary typing.
  await key(buttonIn("Tile"), { key: "F10" });
  expect(menu()).toBeNull();
});

it("opens on a press and hold, and the click the screen replays does not activate the target", async () => {
  const activate = vi.fn();
  await mount(h(Target, { label: "Tile", onActivate: activate }));
  vi.useFakeTimers();
  await fire(buttonIn("Tile"), pointerEvent("pointerdown", "touch"));
  await act(async () => {
    vi.advanceTimersByTime(LONG_PRESS_MS + 50);
  });
  expect(menu()).not.toBeNull();
  await fire(buttonIn("Tile"), pointerEvent("pointerup", "touch"));
  await fire(buttonIn("Tile"), new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(activate).not.toHaveBeenCalled();
});

it("closes on Esc and when a row acts, handing focus back to the target", async () => {
  const pick = vi.fn();
  await mount(h(Target, { label: "Tile", onPick: pick }));
  await rightClick(buttonIn("Tile"), 50, 50);
  await pressEscape();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(buttonIn("Tile"));

  await rightClick(buttonIn("Tile"), 50, 50);
  await fire(itemNamed("Tile action")!, new MouseEvent("click", { bubbles: true }));
  expect(pick).toHaveBeenCalledTimes(1);
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(buttonIn("Tile"));
});

it("lets the innermost target own a gesture, and the outer one its own space", async () => {
  await mount(h(Target, { label: "Grid" }, h(Target, { label: "Tile" })));
  await rightClick(buttonIn("Tile"), 40, 40);
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(menu()?.getAttribute("aria-label")).toBe("Tile");
  await pressEscape();

  await rightClick(target("Grid"), 300, 300);
  expect(menu()?.getAttribute("aria-label")).toBe("Grid");
});

it("leaves the browser's own menu alone when disabled", async () => {
  await mount(h(Target, { label: "Tile", disabled: true }));
  expect(await rightClick(buttonIn("Tile"), 40, 40)).toBe(false);
  expect(menu()).toBeNull();
});
