// @vitest-environment jsdom
/**
 * The ranking beside a showcase grid on a live page (src/components/showcase/showcase-ranking.tsx).
 *
 * - Given two boards, the first is shown: its subjects in its order, at most ten, each with its
 *   figure in full words for assistive technology.
 * - Choosing the other board's tab, by a press or by the arrow keys, shows that board's order and
 *   moves focus to its tab; only the chosen tab is a tab stop.
 * - Pressing a row's title opens that subject, once.
 * - Given no boards, nothing is drawn.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowcaseRanking } from "../src/components/showcase/showcase-ranking";
import type { RankingBoard, RankingEntry } from "../src/components/showcase/showcase-ranking";
import { fire, mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const entry = (title: string, count: number, onOpen?: () => void): RankingEntry => ({
  key: title,
  thumb: createElement("span", null, `${title} cover`),
  title,
  count: String(count),
  countLabel: `${count} installs`,
  ...(onOpen !== undefined ? { onOpen } : {}),
});

/** Twelve plugins, most installed first; the risers in another order. */
const NAMES = Array.from({ length: 12 }, (_, i) => `Plugin ${String.fromCharCode(65 + i)}`);
function boards(onOpen?: (title: string) => void): RankingBoard[] {
  return [
    {
      key: "popular",
      label: "Popular",
      entries: NAMES.map((name, i) => entry(name, 1000 - i * 10, () => onOpen?.(name))),
    },
    {
      key: "rising",
      label: "Rising",
      entries: [entry("Plugin L", 90), entry("Plugin C", 40)],
    },
  ];
}

const titles = (root: Element) =>
  [...root.querySelectorAll("li .showcase-ranking-open")].map((el) => el.textContent);
const tab = (root: Element, label: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) => el.textContent === label)!;

describe("the ranking", () => {
  it("shows the first board's subjects in its order, at most ten, figures in full words", async () => {
    const { container } = await mount(
      createElement(ShowcaseRanking, { title: "Rankings", boards: boards() }),
    );
    expect(titles(container)).toEqual(NAMES.slice(0, 10));
    expect(container.querySelector("li")?.textContent).toContain("1000 installs");
    expect(tab(container, "Popular").getAttribute("aria-selected")).toBe("true");
  });

  it("switches boards by a press or by the arrow keys, the chosen tab the one tab stop", async () => {
    const { container } = await mount(
      createElement(ShowcaseRanking, { title: "Rankings", boards: boards() }),
    );
    await fire(tab(container, "Rising"), new MouseEvent("click", { bubbles: true }));
    expect(titles(container)).toEqual(["Plugin L", "Plugin C"]);

    await fire(
      tab(container, "Rising"),
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(titles(container)).toEqual(NAMES.slice(0, 10));
    expect(document.activeElement).toBe(tab(container, "Popular"));
    expect(tab(container, "Popular").tabIndex).toBe(0);
    expect(tab(container, "Rising").tabIndex).toBe(-1);
  });

  it("opens the subject whose title is pressed, once", async () => {
    const opened = vi.fn();
    const { container } = await mount(
      createElement(ShowcaseRanking, { title: "Rankings", boards: boards(opened) }),
    );
    const third = container.querySelectorAll<HTMLElement>("li .showcase-ranking-open")[2]!;
    await fire(third, new MouseEvent("click", { bubbles: true }));
    expect(opened.mock.calls).toEqual([["Plugin C"]]);
  });

  it("draws nothing without a board", async () => {
    const { container } = await mount(
      createElement(ShowcaseRanking, { title: "Rankings", boards: [] }),
    );
    expect(container.innerHTML).toBe("");
  });
});
