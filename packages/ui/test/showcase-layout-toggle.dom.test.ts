// @vitest-environment jsdom
/**
 * A showcase grid's cards / list switch on a live page
 * (src/components/showcase/showcase-layout-toggle.tsx).
 *
 * - Given the cards layout, the switch is a group named for what it switches, holding two icon
 *   buttons with no words of their own: each is named by its layout and shows the same words on
 *   hover, and only the cards button is pressed.
 * - Pressing the list button asks for the list; pressing the current layout asks for nothing.
 * - On a page with no tooltip layer (`nativeTooltips`), each button's hover words are a native
 *   title instead.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowcaseLayoutToggle } from "../src/components/showcase/showcase-layout-toggle";
import type { ShowcaseLayoutToggleProps } from "../src/components/showcase/showcase-layout-toggle";
import { mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const LABELS = { group: "Plugin layout", cards: "Card view", list: "List view" };

async function toggle(props: Partial<ShowcaseLayoutToggleProps> = {}) {
  const { container } = await mount(
    createElement(ShowcaseLayoutToggle, {
      value: "cards",
      onChange: () => undefined,
      labels: LABELS,
      ...props,
    }),
  );
  const group = container.querySelector<HTMLElement>('[role="group"]')!;
  const button = (name: string) =>
    [...group.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.getAttribute("aria-label") === name,
    )!;
  return { group, button };
}

describe("the layout switch", () => {
  it("is a named group of two wordless icon buttons, each named and hinted, the current one pressed", async () => {
    const { group, button } = await toggle();
    expect(group.getAttribute("aria-label")).toBe("Plugin layout");
    expect(group.querySelectorAll("button")).toHaveLength(2);
    for (const name of [LABELS.cards, LABELS.list]) {
      const b = button(name);
      expect(b.textContent).toBe("");
      expect(b.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(b.getAttribute("data-tooltip")).toBe(name);
      expect(b.hasAttribute("title")).toBe(false);
    }
    expect(button(LABELS.cards).getAttribute("aria-pressed")).toBe("true");
    expect(button(LABELS.list).getAttribute("aria-pressed")).toBe("false");
  });

  it("asks for the other layout when pressed, and for nothing when the current one is", async () => {
    const onChange = vi.fn();
    const { button } = await toggle({ onChange });
    button(LABELS.cards).click();
    expect(onChange).not.toHaveBeenCalled();
    button(LABELS.list).click();
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("shows its hover words as native titles on a page with no tooltip layer", async () => {
    const { button } = await toggle({ value: "list", nativeTooltips: true });
    expect(button(LABELS.list).getAttribute("title")).toBe(LABELS.list);
    expect(button(LABELS.list).hasAttribute("data-tooltip")).toBe(false);
    expect(button(LABELS.list).getAttribute("aria-pressed")).toBe("true");
  });
});
