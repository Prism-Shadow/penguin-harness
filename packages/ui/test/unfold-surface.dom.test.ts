// @vitest-environment jsdom
/**
 * A surface that unfolds from its trigger on a live page
 * (src/components/overlays/unfold-surface/unfold-surface.tsx), held by a caller that opens it
 * from a folder button, closes it when asked, and unmounts it once it says it has folded back.
 * jsdom runs no transitions, so a fold ends at once, as it does under reduced motion.
 *
 * - Given the trigger, the surface opens with the focus, and the part of the trigger it grows out
 *   of is hidden while it stands in its place.
 * - Given Esc or the back button, it asks to close, folds back, hands the focus to the trigger,
 *   and the trigger's square shows again.
 * - Given a press outside, it asks to close once; a press on the trigger, on another trigger of
 *   its kind, or inside a menu opened from it does not.
 * - Given its window off screen, it takes neither the focus nor Esc.
 */
import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AppWindow } from "../src/components/shell/app-window/app-window";
import { UnfoldSurface } from "../src/components/overlays/unfold-surface/unfold-surface";
import { fire, mount, pointerEvent, pressEscape, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

function Caller({ log, windowShown = true }: { log: string[]; windowShown?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return createElement(
    AppWindow,
    { shown: windowShown },
    createElement(
      "button",
      {
        id: "study",
        type: "button",
        "data-kind": "folder",
        onClick: () => {
          setMounted(true);
          setOpen(!open);
        },
      },
      createElement(
        "span",
        { "data-unfold-from": "" },
        createElement("span", { "data-unfold-source": "a" }),
      ),
      "Study",
    ),
    createElement("button", { id: "work", type: "button", "data-kind": "folder" }, "Work"),
    createElement("p", { id: "elsewhere" }, "Elsewhere"),
    createElement(
      "div",
      { style: { position: "relative" } },
      mounted &&
        createElement(UnfoldSurface, {
          id: "study-surface",
          open,
          triggerId: "study",
          title: "Study",
          backLabel: "Back",
          keepOpenWithin: '[data-kind="folder"]',
          onClose: () => {
            log.push("close");
            setOpen(false);
          },
          onExited: () => {
            log.push("exited");
            setMounted(false);
          },
          children: createElement(
            "ul",
            null,
            createElement(
              "li",
              null,
              createElement("span", { "data-unfold-art": "a" }, createElement("span", null, "A")),
            ),
          ),
        }),
    ),
  );
}

const trigger = () => document.getElementById("study")!;
const origin = () => trigger().querySelector<HTMLElement>("[data-unfold-from]")!;
const surface = () => document.getElementById("study-surface");
/** Lets the fold's end, which settles on a microtask, reach the caller. */
const settle = () => act(async () => {});

async function openIt(log: string[] = [], props: { windowShown?: boolean } = {}) {
  const page = await mount(createElement(Caller, { log, ...props }));
  await fire(trigger(), new MouseEvent("click", { bubbles: true }));
  return page;
}

describe("an unfolding surface", () => {
  it("opens with the focus and stands in for the square it grows out of", async () => {
    await openIt();
    expect(surface()).not.toBeNull();
    expect(document.activeElement).toBe(surface());
    expect(origin().style.visibility).toBe("hidden");
  });

  it.each([
    ["Esc", () => pressEscape()],
    [
      "the back button",
      () =>
        fire(
          document.querySelector('button[aria-label="Back"]')!,
          new MouseEvent("click", { bubbles: true }),
        ),
    ],
  ])("given %s, folds back and hands the focus to its trigger", async (_, leave) => {
    const log: string[] = [];
    await openIt(log);
    await leave();
    await settle();
    expect(log).toEqual(["close", "exited"]);
    expect(surface()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(origin().style.visibility).toBe("");
  });

  it("closes once on a press outside, but not on its trigger, its kind or its own menu", async () => {
    const log: string[] = [];
    await openIt(log);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    for (const target of [trigger(), document.getElementById("work")!, menu])
      await fire(target, pointerEvent("pointerdown", "mouse"));
    expect(log).toEqual([]);
    await fire(document.getElementById("elsewhere")!, pointerEvent("pointerdown", "mouse"));
    await fire(document.getElementById("elsewhere")!, new FocusEvent("focusin", { bubbles: true }));
    await settle();
    expect(log).toEqual(["close", "exited"]);
  });

  it("takes neither the focus nor Esc while its window is off screen", async () => {
    const log: string[] = [];
    await openIt(log, { windowShown: false });
    expect(document.activeElement).not.toBe(surface());
    await pressEscape();
    expect(log).toEqual([]);
    expect(surface()).not.toBeNull();
  });
});
