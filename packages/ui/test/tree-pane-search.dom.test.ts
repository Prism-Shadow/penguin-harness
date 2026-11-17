// @vitest-environment jsdom
/**
 * The tree pane's search box in a column too narrow for it (src/components/files/tree-pane), held
 * by a caller that keeps the query the way the Files panel does. jsdom lays nothing out, so the
 * suite reports the header's room as the browser would measure it.
 *
 * - Given a header with no room for the box, a magnifier named by the placeholder stands in for
 *   it; a click opens the box with the caret in it, and Escape in the empty box folds it back and
 *   hands the focus to the magnifier.
 * - Given a query typed into the opened box, the box stays open when the focus leaves it; its ×
 *   clears the query and folds it back, and an empty box folds back when the focus leaves it.
 */
import { act, createElement, Fragment, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreePane } from "../src/components/files/tree-pane/tree-pane";
import { fire, mount, type, unmountAll } from "./helpers/dom";

/** The width every element reports: a tree column too narrow for its search box. */
const NARROW_ROOM = 90;

function Caller() {
  const [query, setQuery] = useState("");
  return createElement(
    Fragment,
    null,
    createElement(
      TreePane,
      {
        search: {
          value: query,
          onChange: setQuery,
          placeholder: "Search files",
          clearLabel: "Clear the filter",
        },
        actions: createElement("button", { type: "button" }, "Refresh"),
      },
      createElement("div", { role: "tree" }),
    ),
    createElement("button", { type: "button" }, "Elsewhere"),
  );
}

const box = () => document.querySelector<HTMLInputElement>('input[type="search"]');
const named = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const elsewhere = () =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Elsewhere")!;
const click = (target: HTMLElement) =>
  fire(target, new MouseEvent("click", { bubbles: true, cancelable: true }));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: NARROW_ROOM,
        height: 24,
        right: NARROW_ROOM,
        bottom: 24,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe("TreePane search in a narrow column", () => {
  it("folds into a magnifier that opens the box focused, and Escape folds it back", async () => {
    await mount(createElement(Caller));
    expect(box()).toBeNull();

    await click(named("Search files"));
    expect(document.activeElement).toBe(box());

    await fire(box()!, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box()).toBeNull();
    expect(document.activeElement).toBe(named("Search files"));
  });

  it("keeps a box holding a query open, and folds it once cleared", async () => {
    await mount(createElement(Caller));
    await click(named("Search files"));
    await type(box()!, "rag");

    await act(async () => elsewhere().focus());
    expect(box()?.value).toBe("rag");

    await click(named("Clear the filter"));
    expect(box()).toBeNull();
    expect(document.activeElement).toBe(named("Search files"));

    await click(named("Search files"));
    expect(box()?.value).toBe("");
    await act(async () => elsewhere().focus());
    expect(box()).toBeNull();
  });
});
