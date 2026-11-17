// @vitest-environment jsdom
/**
 * SubPageBar (src/components/navigation/sub-page-bar/sub-page-bar.tsx) on a real page
 * (test/helpers/dom.ts): a tab's sub-pages as one switch, with the current sub-page's controls.
 *
 * - Given four sub-pages, the switch is a group named by its label, and the active sub-page is
 *   the one pressed — only that one.
 * - Given a press on another sub-page, the caller is told its key; nothing changes on screen
 *   until the caller makes it active.
 * - Given another sub-page made active, the controls the caller passes are still drawn, after
 *   the switch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { SubPageBar } from "../src/components/navigation/sub-page-bar/sub-page-bar";
import { fire, mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

type Page = "plugins" | "skills" | "hooks" | "workbenches";
const ITEMS: { key: Page; label: string }[] = [
  { key: "plugins", label: "Plugins" },
  { key: "skills", label: "Skills" },
  { key: "hooks", label: "Hooks" },
  { key: "workbenches", label: "Workbenches" },
];

const bar = (active: Page, onChange: (key: Page) => void = () => undefined) =>
  h(SubPageBar<Page>, {
    label: "Plugin sub-pages",
    items: ITEMS,
    active,
    onChange,
    actions: h("button", { type: "button" }, "Import"),
  });

const pressed = () =>
  [...document.querySelectorAll('[role="group"] button[aria-pressed="true"]')].map(
    (b) => b.textContent,
  );
const option = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find(
    (b) => b.textContent === label,
  )!;

describe("SubPageBar", () => {
  it("is a switch named by its label, the active sub-page pressed", async () => {
    await mount(bar("hooks"));
    const group = document.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Plugin sub-pages");
    expect(group.querySelectorAll("button")).toHaveLength(4);
    expect(pressed()).toEqual(["Hooks"]);
  });

  it("tells the caller which sub-page was pressed, and waits for it to switch", async () => {
    const onChange = vi.fn();
    await mount(bar("plugins", onChange));
    await fire(option("Workbenches"), new MouseEvent("click", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("workbenches");
    expect(pressed()).toEqual(["Plugins"]);
  });

  it("draws the caller's controls after the switch, whichever sub-page is active", async () => {
    const view = await mount(bar("plugins"));
    for (const active of ["skills", "workbenches"] as const) {
      await view.rerender(bar(active));
      const controls = [...view.container.querySelectorAll("button")].map((b) => b.textContent);
      expect(controls.at(-1)).toBe("Import");
      expect(pressed()).toEqual([ITEMS.find((item) => item.key === active)!.label]);
    }
  });
});
