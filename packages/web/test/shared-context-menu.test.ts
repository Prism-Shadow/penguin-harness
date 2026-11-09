/** @vitest-environment jsdom */
/**
 * The shared `ContextMenu` (packages/ui), driven the way a person does in the browser.
 *
 * - A right-click opens it at the pointer, suppressing the browser's own menu on the target only.
 * - Shift+F10 and the ContextMenu key open it from the focused target, against the target's box.
 * - Esc closes it and hands focus back to the target; a row that acts closes it first.
 * - Nested targets: the innermost under the gesture owns it, and the outer one opens on its own
 *   space.
 * - A disabled menu leaves the browser's menu alone.
 */
import { act, createElement as h, useState, type ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { ContextMenu, MenuItem } from "@prismshadow/penguin-ui";
import { mount, pressEscape, settle, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

function Target({
  label,
  disabled = false,
  onPick = () => undefined,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPick?: () => void;
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
        h("button", { type: "button" }, label),
        children,
      ),
  });
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const target = (label: string) => document.querySelector<HTMLElement>(`[data-target="${label}"]`)!;
const buttonIn = (label: string) => target(label).querySelector("button")!;

async function rightClick(el: Element, x: number, y: number): Promise<boolean> {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: x,
    clientY: y,
  });
  await act(async () => {
    el.dispatchEvent(event);
  });
  await settle();
  return event.defaultPrevented;
}

async function key(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
  el.focus();
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  await settle();
}

it("opens at the pointer on a right-click, and keeps the browser's menu off the target", async () => {
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
  // A plain F10 is ordinary typing.
  await pressEscape();
  await key(buttonIn("Tile"), { key: "F10" });
  expect(menu()).toBeNull();
});

it("closes on Esc and when a row acts, handing focus back to the target", async () => {
  let picked = 0;
  await mount(h(Target, { label: "Tile", onPick: () => picked++ }));
  await rightClick(buttonIn("Tile"), 50, 50);
  await pressEscape();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(buttonIn("Tile"));

  await rightClick(buttonIn("Tile"), 50, 50);
  await act(async () => {
    (document.activeElement as HTMLElement).click();
  });
  await settle();
  expect(picked).toBe(1);
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(buttonIn("Tile"));
});

it("lets the innermost target own a gesture, and the outer one its own space", async () => {
  function Nested() {
    const [, rerender] = useState(0);
    return h(
      Target,
      { label: "Grid", onPick: () => rerender((n) => n + 1) },
      h(Target, { label: "Tile" }),
    );
  }
  await mount(h(Nested));
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
