// @vitest-environment jsdom
/**
 * Two interactions a static render cannot show, on a real page (test/helpers/dom.ts).
 *
 * - Given an InfoPopover, a mouse resting on its "?" opens the explanation after the hover delay,
 *   a click pins it open, and focus alone opens nothing.
 * - Given a draggable session row, a drag of the row itself hands the browser the drag chip as its
 *   image; a drag that starts on something inside the row (a child that drags on its own) leaves
 *   the browser's image alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { HOVER_DISCLOSURE_DELAY_MS } from "../src/components/overlays/hover-disclosure/use-hover-disclosure";
import { InfoPopover } from "../src/components/overlays/info-popover/info-popover";
import { SessionRow } from "../src/components/shell/session-row/session-row";
import { fire, mount, pointerEvent, unmountAll } from "./helpers/dom";

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
});

describe("an InfoPopover", () => {
  const trigger = async () => {
    await mount(createElement(InfoPopover, { label: "Vault", children: "Where secrets live." }));
    return document.querySelector<HTMLElement>('[aria-label="More info: Vault"]')!;
  };

  it("opens on a resting mouse after the hover delay", async () => {
    vi.useFakeTimers();
    const button = await trigger();
    await fire(button, pointerEvent("pointerover", "mouse"));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      vi.advanceTimersByTime(HOVER_DISCLOSURE_DELAY_MS.open + 10);
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("pins open on a click, and opens nothing on focus alone", async () => {
    const button = await trigger();
    await act(async () => {
      button.focus();
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      button.click();
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a row's drag image", () => {
  const dragStart = (setDragImage: () => void) => {
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { setDragImage, setData: () => {} } });
    return event;
  };

  it("is the chip for a session row's own drag only", async () => {
    await mount(
      createElement(SessionRow, {
        sessionId: "s-1",
        renderTitle: (className: string) => createElement("span", { className }, "Fix the build"),
        time: "3 min",
        hoverActions: [],
        menuActions: [],
        moreLabel: "More",
        onOpen: () => {},
        draggable: true,
      }),
    );
    const row = document.querySelector<HTMLElement>("li")!;
    const own = vi.fn();
    await fire(row, dragStart(own));
    expect(own).toHaveBeenCalledTimes(1);
    const fromChild = vi.fn();
    await fire(row.querySelector("span")!, dragStart(fromChild));
    expect(fromChild).not.toHaveBeenCalled();
  });
});
