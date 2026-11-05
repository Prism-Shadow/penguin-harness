// @vitest-environment jsdom
/**
 * The session row's menu on a real page (test/helpers/dom.ts): what its wiring must keep doing.
 *
 * - Given a row's menu open, when an unrelated container (the message list) scrolls, it stays
 *   open; when the list holding the row scrolls, it closes.
 * - Given the menu opened from the row, when a menu row runs, the action runs, the menu closes and
 *   focus is back on the row, so a keyboard reader is not left on the page's body.
 * - Given a press-and-hold on a touch screen, the menu opens, and the click the screen replays
 *   after the hold does not also open the conversation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { ICONS } from "../src/components/icons/icons";
import { LONG_PRESS_MS } from "../src/components/overlays/portal-panel/context-menu";
import { SessionRow } from "../src/components/shell/session-row/session-row";
import { contextMenuEvent, fire, itemNamed, mount, pointerEvent, unmountAll } from "./helpers/dom";

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
});

async function sessionRow(onOpen = vi.fn(), onRename = vi.fn()) {
  const action = (id: string, label: string, onSelect: () => void = () => {}) => ({
    id,
    label,
    glyph: ICONS.archive,
    onSelect,
  });
  const view = await mount(
    createElement(SessionRow, {
      sessionId: "s-1",
      renderTitle: (className: string) => createElement("span", { className }, "Fix the build"),
      time: "3 min",
      hoverActions: [action("archive", "Archive")],
      menuActions: [action("rename", "Rename", onRename), action("delete", "Delete")],
      moreLabel: "More",
      onOpen,
    }),
  );
  const rowButton = document.querySelector<HTMLElement>('[data-testid="session-row"]')!;
  return { view, rowButton, onOpen, onRename };
}

describe("a session row's menu", () => {
  it("stays open while another container scrolls, and closes when the list holding the row scrolls", async () => {
    const { view, rowButton } = await sessionRow();
    const messages = document.createElement("div");
    document.body.appendChild(messages);
    await fire(rowButton, contextMenuEvent(40, 50));
    await fire(messages, new Event("scroll"));
    expect(itemNamed("Rename")).toBeDefined();
    await fire(view.container, new Event("scroll"));
    expect(itemNamed("Rename")).toBeUndefined();
  });

  it("hands focus back to the row when a menu row runs, then closes", async () => {
    const { rowButton, onRename } = await sessionRow();
    await fire(rowButton, contextMenuEvent(40, 50));
    await act(async () => {
      itemNamed("Rename")!.click();
    });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(itemNamed("Rename")).toBeUndefined();
    expect(document.activeElement).toBe(rowButton);
  });

  it("opens on a press-and-hold, and the click a touch screen replays after it opens nothing", async () => {
    vi.useFakeTimers();
    const { rowButton, onOpen } = await sessionRow();
    await fire(rowButton, pointerEvent("pointerdown", "touch"));
    await act(async () => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    });
    expect(itemNamed("Rename")).toBeDefined();
    await fire(rowButton, pointerEvent("pointerup", "touch"));
    await fire(rowButton, new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
