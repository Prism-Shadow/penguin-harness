// @vitest-environment jsdom
/**
 * The overlays on a real page (test/helpers/dom.ts): Escape through the shared layer stack, and a
 * portaled menu's first focus.
 *
 * - Given a Drawer or a Sheet holding a menu the reader opens once it is up, the first Escape
 *   closes only the menu and the next closes the Drawer or the Sheet.
 * - Given an open Lightbox under another layer, Escape leaves it open; once that layer is gone,
 *   Escape closes it.
 * - Given a portaled Dropdown that opens, focus moves to its first item only once the panel is
 *   placed, never while it is still hidden.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import type { ReactElement } from "react";
import { Drawer } from "../src/components/overlays/drawer/drawer";
import { Sheet } from "../src/components/overlays/drawer/sheet";
import { Dropdown } from "../src/components/overlays/dropdown/dropdown";
import { popEscLayer, pushEscLayer } from "../src/components/overlays/esc-layers/esc-layers";
import { Lightbox } from "../src/components/overlays/lightbox/lightbox";
import { itemNamed, mount, panelOf, pressEscape, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

/** A menu its reader opens with its "Actions" button. */
function Menu(): ReactElement {
  const [open, setOpen] = useState(false);
  return createElement(Dropdown, {
    open,
    setOpen,
    button: createElement("button", { type: "button", onClick: () => setOpen(true) }, "Actions"),
    children: createElement("button", { type: "button" }, "Rename"),
  });
}

describe("Escape through the shared layer stack", () => {
  it.each([
    [
      "Drawer",
      (onClose: () => void) =>
        createElement(Drawer, {
          open: true,
          onClose,
          title: "Files",
          children: createElement(Menu),
        }),
    ],
    [
      "Sheet",
      (onClose: () => void) =>
        createElement(Sheet, {
          open: true,
          snap: "half",
          onClose,
          title: "Files",
          children: createElement(Menu),
        }),
    ],
  ] as const)(
    "lets a menu inside a %s take the first Escape alone; the next closes it",
    async (_name, panel) => {
      const onClose = vi.fn();
      await mount(panel(onClose));
      await act(async () => {
        itemNamed("Actions")!.click();
      });
      expect(itemNamed("Rename")).toBeDefined();
      await pressEscape();
      expect(itemNamed("Rename")).toBeUndefined();
      expect(onClose).not.toHaveBeenCalled();
      await pressEscape();
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a Lightbox open while a layer above it takes Escape, and closes it after", async () => {
    const onClose = vi.fn();
    await mount(createElement(Lightbox, { open: true, src: "/a.png", alt: "A chart", onClose }));
    const above = pushEscLayer();
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    popEscLayer(above);
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a portaled Dropdown's first focus", () => {
  it("moves to the first item only once the panel is placed, never while it is hidden", async () => {
    const seen: string[] = [];
    const menu = (open: boolean) =>
      createElement(Dropdown, {
        open,
        setOpen: () => {},
        button: createElement("button", { type: "button" }, "Open"),
        portal: { direction: "down", align: "left" },
        children: createElement(
          "button",
          {
            type: "button",
            onFocus: (e: { currentTarget: HTMLElement }) =>
              seen.push(panelOf(e.currentTarget).style.visibility),
          },
          "Rename",
        ),
      });
    const view = await mount(menu(false));
    await view.rerender(menu(true));
    expect(document.activeElement?.textContent).toBe("Rename");
    expect(seen).toEqual([""]);
  });
});
