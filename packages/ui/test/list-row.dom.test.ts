// @vitest-environment jsdom
/**
 * A jump landing on a ListRow (src/components/data/list-row/list-row.tsx), named through
 * useMarkedRow, on a real page (test/helpers/dom.ts).
 *
 * - Given a control elsewhere that points at a row, pressing it brings that row into view, puts
 *   the focus on the row's own button and marks it — that row only — and after the mark's moment
 *   the row is a plain row again.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { ListRow, useMarkedRow } from "../src/components/data/list-row/list-row";
import { fire, mount, unmountAll } from "./helpers/dom";

const PLUGINS = ["charts", "notes"];

/** A list of plugin rows, and a control outside it that points at one of them. */
function PluginList() {
  const { marked, mark } = useMarkedRow<string>();
  return h(
    "div",
    null,
    h("button", { type: "button", onClick: () => mark("notes") }, "Show notes"),
    h(
      "ul",
      null,
      PLUGINS.map((name) =>
        h(ListRow, {
          key: name,
          as: "li",
          title: name,
          onClick: () => {},
          marked: marked === name,
        }),
      ),
    ),
  );
}

/** The rows jsdom was asked to bring into view (it lays nothing out, so it has no such method). */
let scrolled: Element[] = [];

beforeEach(() => {
  scrolled = [];
  vi.useFakeTimers();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value(this: Element) {
      scrolled.push(this);
    },
  });
});

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

it("brings the row a jump lands on into view, focuses its button and marks it until the moment passes", async () => {
  const { container } = await mount(h(PluginList));
  const row = (name: string) =>
    [...container.querySelectorAll("li")].find((li) => li.textContent === name)!;
  const marked = () => [...container.querySelectorAll("[data-marked]")];
  expect(marked()).toEqual([]);

  const show = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Show notes",
  )!;
  await fire(show, new MouseEvent("click", { bubbles: true }));
  expect(scrolled).toEqual([row("notes")]);
  expect(document.activeElement).toBe(row("notes").querySelector("button"));
  expect(marked()).toEqual([row("notes")]);

  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(marked()).toEqual([]);
});
