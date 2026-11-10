// @vitest-environment jsdom
/**
 * The row context menu on a real page (test/helpers/dom.ts): what the pure rules of
 * context-menu.test.ts and portal-panel.test.ts feed into once the hook and the Dropdown run.
 *
 * - Given an anchored menu open over a row in a sidebar, when an unrelated container (a streaming
 *   message list) scrolls, the menu stays open; when the sidebar holding its row scrolls, it closes.
 * - Given a session row, a right-click on it opens its menu and suppresses the browser's own there;
 *   a right-click inside the open, portaled menu leaves the browser's menu alone and does not move
 *   the open one.
 * - Given a touch press released before a hold, no menu opens.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { Dropdown } from "../src/components/overlays/dropdown/dropdown";
import { LONG_PRESS_MS } from "../src/components/overlays/portal-panel/context-menu";
import { SessionRow } from "../src/components/shell/session-row/session-row";
import { ICONS } from "../src/components/icons/icons";
import {
  contextMenuEvent,
  fire,
  itemNamed,
  mount,
  panelOf,
  pointerEvent,
  unmountAll,
} from "./helpers/dom";

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
});

const scroll = (target: EventTarget) => fire(target, new Event("scroll"));

async function sessionRow() {
  const action = (id: string, label: string) => ({
    id,
    label,
    glyph: ICONS.archive,
    onSelect: () => {},
  });
  await mount(
    createElement(SessionRow, {
      sessionId: "s-1",
      renderTitle: (className: string) => createElement("span", { className }, "Fix the build"),
      time: "3 min",
      hoverActions: [action("archive", "Archive")],
      menuActions: [action("rename", "Rename"), action("delete", "Delete")],
      moreLabel: "More",
      onOpen: () => {},
    }),
  );
  return document.querySelector<HTMLElement>('[data-testid="session-row"]')!;
}

describe("an anchored menu", () => {
  it("stays open while an unrelated container scrolls, and closes when its row's container does", async () => {
    const sidebar = document.createElement("div");
    const row = document.createElement("div");
    sidebar.appendChild(row);
    const messages = document.createElement("div");
    document.body.append(sidebar, messages);
    const setOpen = vi.fn();
    await mount(
      createElement(Dropdown, {
        open: true,
        setOpen,
        button: null,
        portal: { direction: "down", align: "left" },
        anchorRect: { top: 10, bottom: 20, left: 10, right: 20 },
        anchorOwner: () => row,
        children: createElement("button", { type: "button" }, "Rename"),
      }),
    );
    await scroll(messages);
    expect(setOpen).not.toHaveBeenCalled();
    await scroll(sidebar);
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});

describe("a row's right-click", () => {
  it("opens the row's menu and suppresses the browser's own on the row only", async () => {
    const rowButton = await sessionRow();
    const onRow = contextMenuEvent(40, 50);
    await fire(rowButton, onRow);
    expect(onRow.defaultPrevented).toBe(true);
    const rename = itemNamed("Rename");
    expect(rename).toBeDefined();
    const top = panelOf(rename!).style.top;
    // A right-click inside the portaled panel is not the row's: the browser keeps its own menu,
    // and the open menu stays where it was.
    const inPanel = contextMenuEvent(300, 400);
    await fire(rename!, inPanel);
    expect(inPanel.defaultPrevented).toBe(false);
    expect(panelOf(itemNamed("Rename")!).style.top).toBe(top);
  });

  it("is not stood in for by a touch press released before a hold", async () => {
    vi.useFakeTimers();
    const rowButton = await sessionRow();
    await fire(rowButton, pointerEvent("pointerdown", "touch"));
    await act(async () => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 350);
    });
    await fire(rowButton, pointerEvent("pointerup", "touch"));
    await act(async () => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(itemNamed("Rename")).toBeUndefined();
  });
});
