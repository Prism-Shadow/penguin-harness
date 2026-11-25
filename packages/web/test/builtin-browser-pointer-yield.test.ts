/** @vitest-environment jsdom */
/**
 * When the built-in browser's pages let the pointer through
 * (plugins/browser-automation/src/web/pointer-yield.ts).
 *
 * - A drag of an open page keeps the pages transparent after the browser cancels the press that
 *   began it, until the drag ends, even when the dragged row has left the document by then.
 * - Any other drag hands the pointer back to the pages as soon as the press is cancelled.
 */
import { expect, it } from "vitest";
// The browser reaches the app's own helpers through the plugin face; this hands them over.
import "../src/web-app/plugin-host";
import { PAGE_DRAG_TYPE } from "../src/lib/page-layout";
import { yieldPointerToApp } from "../../../plugins/browser-automation/src/web/pointer-yield";

const fire = (target: EventTarget, type: string, more: object = {}) =>
  target.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), more));

it("stays out of the pointer's way through a drag of an open page, and only that drag", () => {
  const layer = document.body.appendChild(document.createElement("div"));
  const row = document.body.appendChild(document.createElement("button"));
  const stop = yieldPointerToApp(layer);
  const beginDrag = (types: string[]) => {
    fire(row, "pointerdown", { button: 0 });
    fire(row, "dragstart", { dataTransfer: { types } });
    fire(row, "pointercancel");
  };

  beginDrag(["text/plain"]);
  expect(layer.style.pointerEvents).toBe("");
  fire(row, "dragend");

  beginDrag([PAGE_DRAG_TYPE]);
  expect(layer.style.pointerEvents).toBe("none");
  row.remove();
  fire(row, "dragend");
  expect(layer.style.pointerEvents).toBe("");

  stop();
  layer.remove();
});
