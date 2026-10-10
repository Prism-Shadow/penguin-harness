/**
 * A live DOM for the few suites whose behaviour is an interaction across React's commit: a leave
 * that asks before it goes, a dialog's close through the guard, a form's Save turning live as the
 * user types. Everything else in this package stays in Node with static markup and pure modules.
 *
 * A suite opts in with the `@vitest-environment jsdom` docblock on its first line, renders with
 * {@link mount}, and drives the page the way a user does — {@link click}, {@link type},
 * {@link pressEscape} — through the real event path React listens on. Every helper wraps its
 * work in `act`, so effects have run and state has settled by the time it returns.
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

// React only flushes effects inside `act` when told it is running under a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The data router builds a `Request` for every navigation, carrying an AbortSignal. Under jsdom
// that signal is jsdom's own, and Node's `Request` refuses a signal from another realm. Nothing
// in these suites loads data through the router, so the signal is dropped.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {};
    super(input, rest);
  }
};

export interface Mounted {
  /** The element the tree renders into; portaled dialogs land in `document.body` beside it. */
  container: HTMLElement;
  /** Renders a new element into the same root, keeping the state of what stays mounted. */
  rerender(element: ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

const roots = new Set<{ root: Root; container: HTMLElement }>();

/** Renders `element` into a fresh container attached to the document. */
export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry = { root, container };
  roots.add(entry);
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
    unmount: async () => {
      if (!roots.delete(entry)) return;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Unmounts every tree a test mounted; call it from `afterEach`. */
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

/** Lets pending promises (a request's answer, an awaited prompt) settle and React commit. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Runs `work` (a navigation, a store write) the way an event would: inside `act`, then settled. */
export async function run(work: () => unknown): Promise<void> {
  await act(async () => {
    await work();
  });
  await settle();
}

/** Settles until `ready` holds (a request chain answering), failing after a bounded number of rounds. */
export async function waitFor(ready: () => boolean, rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (ready()) return;
    await settle();
  }
  if (!ready()) throw new Error("the page never reached the awaited state");
}

/** A click, as the pointer delivers it. */
export async function click(element: Element): Promise<void> {
  const init = { bubbles: true, cancelable: true, button: 0 };
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", init));
    element.dispatchEvent(new MouseEvent("mouseup", init));
    element.dispatchEvent(new MouseEvent("click", init));
  });
  await settle();
}

/** A press on the scrim behind a dialog: what closes it from outside. */
export async function pressScrim(): Promise<void> {
  const scrims = document.querySelectorAll(".ui-scrim");
  const top = scrims[scrims.length - 1];
  if (top === undefined) throw new Error("no dialog scrim on screen");
  await act(async () => {
    top.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await settle();
}

/** An Escape press, which the dialogs listen for on the window. */
export async function pressEscape(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
}

/**
 * Replaces a text field's value the way typing does: through the native setter React tracks,
 * then the `input` event its `onChange` listens to.
 */
export async function type(field: Element, value: string): Promise<void> {
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter === undefined) throw new Error("not a text field");
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The button whose visible text or accessible name is `name`, anywhere in the document. */
export function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
  if (found === undefined) throw new Error(`no button named ${JSON.stringify(name)}`);
  return found;
}

/** Whether a button with that name is on screen. */
export function hasButton(name: string): boolean {
  return [...document.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
}

/** The text field named `label` (its `aria-label`, or the label it is associated with). */
export function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const fields = [
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ];
  const found = fields.find(
    (f) =>
      f.getAttribute("aria-label") === label ||
      [...(f.labels ?? [])].some((l) => l.textContent?.includes(label)),
  );
  if (found === undefined) throw new Error(`no field labelled ${JSON.stringify(label)}`);
  return found;
}

/** The switch named `label`. */
export function switchNamed(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find(
    (s) => s.getAttribute("aria-label") === label,
  );
  if (found === undefined) throw new Error(`no switch named ${JSON.stringify(label)}`);
  return found;
}

/** The open dialogs, topmost last. */
export function dialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
}
