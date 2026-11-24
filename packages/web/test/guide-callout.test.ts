/** @vitest-environment jsdom */
import { act, createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { GuideCallout } from "../src/features/models/guide-callout";
import { mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
});

it("points to the visible control without moving focus, yields to its dialog, and resumes on close", async () => {
  const hidden = document.createElement("button");
  const control = document.createElement("button");
  hidden.dataset.guideTest = control.dataset.guideTest = "";
  document.body.append(hidden, control);
  const rect = DOMRect.fromRect({ x: 12, y: 240, width: 100, height: 32 });
  vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => control });
  control.focus();
  const later = vi.fn();
  const guide = await mount(
    h(GuideCallout, {
      anchorSelector: "[data-guide-test]",
      title: "Choose a model",
      laterLabel: "Later",
      onLater: later,
      children: "Open the model picker.",
    }),
  );
  const panel = guide.container.querySelector<HTMLElement>("[data-guide-callout]")!;
  expect(guide.container.querySelector<HTMLElement>("[data-guide-highlight]")?.style.top).toBe(
    "238px",
  );
  expect(document.activeElement).toBe(control);
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  Object.defineProperty(dialog, "getClientRects", { value: () => [rect] });
  async function update(change: () => void) {
    await act(async () => {
      change();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
  }
  await update(() => document.body.append(dialog));
  expect(panel.style.display).toBe("none");
  expect(guide.container.querySelector("[data-guide-highlight]")).toBeNull();
  await update(() => dialog.remove());
  expect(panel.style.display).toBe("");
  expect(guide.container.querySelector("[data-guide-highlight]")).not.toBeNull();
  await act(async () =>
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(later).toHaveBeenCalledOnce();
});
