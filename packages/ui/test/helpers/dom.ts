/**
 * A live DOM for the few suites whose behaviour is an interaction across React's commit: a menu
 * that a scroll elsewhere must leave open, Escape taken by the top layer only, focus handed back
 * after a menu row runs. Everything else in this package stays in Node with static markup and
 * pure modules (src/testing/render.ts).
 *
 * A suite opts in with the `@vitest-environment jsdom` docblock on its first line, renders with
 * {@link mount}, and drives the page through the real event path React listens on. Every helper
 * wraps its work in `act`, so effects have run and state has settled by the time it returns. The
 * same shape as the Web App's `test/helpers/dom.ts`.
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

// React only flushes effects inside `act` when told it is running under a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lays nothing out and has no `ResizeObserver`; with nothing laid out there is nothing to
// observe, so a silent one stands in.
if (typeof window !== "undefined") {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

export interface Mounted {
  /** The element the tree renders into; portaled panels land in `document.body` beside it. */
  container: HTMLElement;
  /** Renders a new element into the same root, keeping the state of what stays mounted. */
  rerender(element: ReactElement): Promise<void>;
}

const roots = new Set<{ root: Root; container: HTMLElement }>();

/** Renders `element` into a fresh container attached to the document. */
export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.add({ root, container });
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
}

/** Unmounts every tree a test mounted and empties the document; call it from `afterEach`. */
export async function unmountAll(): Promise<void> {
  for (const { root, container } of [...roots]) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  roots.clear();
  document.body.innerHTML = "";
}

/** Dispatches `event` on `target` inside `act`. */
export async function fire(target: EventTarget, event: Event): Promise<void> {
  await act(async () => {
    target.dispatchEvent(event);
  });
}

/** An Escape press, which the layers listen for on the window. */
export async function pressEscape(): Promise<void> {
  await fire(window, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

/** A right-click at a point, cancelable as the browser's is. */
export function contextMenuEvent(x: number, y: number): MouseEvent {
  return new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
}

/** A pointer event of the given type and pointer kind (jsdom may lack `PointerEvent`). */
export function pointerEvent(type: string, pointerType: string, x = 40, y = 50): Event {
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const event = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  if ((event as { pointerType?: string }).pointerType !== pointerType)
    Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

/** The button or menu item on screen whose text is `text`. */
export function itemNamed(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("button, [role^='menuitem']")].find(
    (el) => el.textContent?.trim() === text,
  );
}

/** The portaled panel holding `el`: the fixed-position box a Dropdown mounts on the body. */
export function panelOf(el: HTMLElement): HTMLElement {
  let at: HTMLElement | null = el;
  while (at && at.style.position !== "fixed") at = at.parentElement;
  if (!at) throw new Error("no fixed panel around the item");
  return at;
}
