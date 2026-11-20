// @vitest-environment jsdom
/**
 * AppRow (src/components/shell/app-row/app-row.tsx) on a real page (test/helpers/dom.ts): an
 * app's row in the sidebar's app list.
 *
 * - Given a ready app, a click on the row opens it; the row carries the caller's name and hint,
 *   and is the current one while its window is on screen.
 * - Given an app that is building, the row opens nothing, unless the app already runs and has a
 *   window to bring back; a failed app still opens.
 * - Given the row's "more" button or a right-click, its menu lists the caller's actions; a menu
 *   row runs its action alone, closes the menu and hands focus back to the row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { ICONS } from "../src/components/icons/icons";
import { AppRow, type AppRowProps } from "../src/components/shell/app-row/app-row";
import { contextMenuEvent, fire, itemNamed, mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

async function appRow(over: Partial<AppRowProps> = {}) {
  const onOpen = vi.fn();
  const onRemove = vi.fn();
  const onSettings = vi.fn();
  await mount(
    h(
      "ul",
      null,
      h(AppRow, {
        appKey: "helper/board",
        icon: h("span", null, "B"),
        name: "Board",
        menuActions: [
          { id: "remove", label: "Remove from sidebar", glyph: ICONS.eyeOff, onSelect: onRemove },
          {
            id: "settings",
            label: "View in agent settings",
            glyph: ICONS.gear,
            onSelect: onSettings,
          },
        ],
        moreLabel: "More actions",
        onOpen,
        ...over,
      }),
    ),
  );
  const row = document.querySelector<HTMLButtonElement>('[data-app-row="helper/board"]')!;
  return { row, onOpen, onRemove, onSettings };
}
const press = (el: Element) =>
  fire(el, new MouseEvent("click", { bubbles: true, cancelable: true }));

describe("AppRow", () => {
  it("opens the app, names it as the caller says, and is current while its window is shown", async () => {
    const { row, onOpen } = await appRow({
      label: "Board, Running",
      hint: "Board, Running",
      running: true,
      active: true,
    });
    expect(row.textContent).toContain("Board");
    expect(row.getAttribute("aria-label")).toBe("Board, Running");
    expect(row.getAttribute("data-tooltip")).toBe("Board, Running");
    expect(row.getAttribute("aria-current")).toBe("page");
    await press(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens nothing while the app builds, unless it already runs; a failed app still opens", async () => {
    const building = await appRow({ build: "building" });
    expect(building.row.getAttribute("aria-disabled")).toBe("true");
    await press(building.row);
    expect(building.onOpen).not.toHaveBeenCalled();
    await unmountAll();

    const back = await appRow({ build: "building", running: true });
    await press(back.row);
    expect(back.onOpen).toHaveBeenCalledTimes(1);
    await unmountAll();

    const failed = await appRow({ build: "failed" });
    expect(failed.row.hasAttribute("aria-disabled")).toBe(false);
    await press(failed.row);
    expect(failed.onOpen).toHaveBeenCalledTimes(1);
  });

  it("lists the caller's actions from its more button and a right-click, and runs only the one picked", async () => {
    const { row, onOpen, onRemove, onSettings } = await appRow();
    await press(document.querySelector('button[aria-label="More actions"]')!);
    expect(itemNamed("Remove from sidebar")).toBeDefined();
    expect(itemNamed("View in agent settings")).toBeDefined();
    await act(async () => {
      itemNamed("Remove from sidebar")!.click();
    });
    expect([onRemove, onSettings, onOpen].map((f) => f.mock.calls.length)).toEqual([1, 0, 0]);
    expect(itemNamed("Remove from sidebar")).toBeUndefined();

    await fire(row, contextMenuEvent(40, 50));
    await act(async () => {
      itemNamed("View in agent settings")!.click();
    });
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(row);
  });
});
