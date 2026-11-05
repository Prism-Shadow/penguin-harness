/**
 * The hover disclosure's rules (src/components/overlays/hover-disclosure/use-hover-disclosure.ts),
 * which the "?" beside a title opens through: a mouse resting on the trigger opens the panel after
 * the tooltip's delay, leaving closes it after a grace the pointer can cross into the panel in, a
 * click pins it, and touch never takes the hover path.
 *
 * The hook's timer and React state need a DOM this suite does not have; every decision is the
 * pure reducer, fed here as ordered events. That InfoPopover is wired to it is pinned in
 * info-popover.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CLOSED_DISCLOSURE,
  HOVER_DISCLOSURE_DELAY_MS,
  reduceHoverDisclosure,
} from "../src/components/overlays/hover-disclosure/use-hover-disclosure";
import type {
  HoverDisclosureEvent,
  HoverDisclosureState,
} from "../src/components/overlays/hover-disclosure/use-hover-disclosure";
import { HOVER_OPEN_DELAY_MS } from "../src/components/overlays/tooltip/tooltip";

const run = (events: HoverDisclosureEvent[], from: HoverDisclosureState = CLOSED_DISCLOSURE) =>
  events.reduce(reduceHoverDisclosure, from);

const enterTrigger = (pointerType = "mouse"): HoverDisclosureEvent => ({
  kind: "enter",
  part: "trigger",
  pointerType,
});
const enterPanel: HoverDisclosureEvent = { kind: "enter", part: "panel", pointerType: "mouse" };
const leave = (pointerType = "mouse"): HoverDisclosureEvent => ({ kind: "leave", pointerType });
const elapsed: HoverDisclosureEvent = { kind: "elapsed" };
const toggle: HoverDisclosureEvent = { kind: "toggle" };

const HOVER_OPEN = run([enterTrigger(), elapsed]);

describe("reduceHoverDisclosure", () => {
  it("opens a resting mouse's panel after the tooltip's delay, and a pointer passing over opens nothing", () => {
    expect(HOVER_DISCLOSURE_DELAY_MS.open).toBe(HOVER_OPEN_DELAY_MS);
    expect(run([enterTrigger()])).toEqual({ open: false, pinned: false, pending: "open" });
    expect(HOVER_OPEN).toEqual({ open: true, pinned: false, pending: null });
    expect(run([enterTrigger(), leave()])).toEqual(CLOSED_DISCLOSURE);
  });

  it("closes after the grace once the pointer leaves", () => {
    expect(run([leave()], HOVER_OPEN)).toEqual({ open: true, pinned: false, pending: "close" });
    expect(run([leave(), elapsed], HOVER_OPEN)).toEqual(CLOSED_DISCLOSURE);
  });

  it("stays open while the pointer is in the panel, and closes after it leaves that too", () => {
    const inPanel = run([leave(), enterPanel], HOVER_OPEN);
    expect(inPanel).toEqual(HOVER_OPEN);
    expect(run([leave(), elapsed], inPanel)).toEqual(CLOSED_DISCLOSURE);
  });

  it("pins on a click, which leaving does not undo and a second click does", () => {
    const pinned = run([toggle]);
    expect(pinned).toEqual({ open: true, pinned: true, pending: null });
    expect(run([leave(), elapsed], pinned)).toEqual(pinned);
    expect(run([toggle], pinned)).toEqual(CLOSED_DISCLOSURE);
    // A click on a panel hover already opened pins it rather than closing it, and so does a
    // press inside the panel, so a selection that overshoots its edge keeps it.
    expect(run([toggle], HOVER_OPEN)).toEqual(pinned);
    expect(run([enterPanel, { kind: "press" }, leave(), elapsed], HOVER_OPEN)).toEqual(pinned);
    // An outside click, Esc, a scroll or a resize closes it all the same.
    expect(run([{ kind: "dismiss" }], pinned)).toEqual(CLOSED_DISCLOSURE);
  });

  it("ignores touch and pen for hover, so a tap is a click and pins", () => {
    for (const pointerType of ["touch", "pen"]) {
      expect(run([enterTrigger(pointerType)])).toBe(CLOSED_DISCLOSURE);
      const tapped = run([enterTrigger(pointerType), toggle, leave(pointerType)]);
      expect(tapped).toEqual({ open: true, pinned: true, pending: null });
    }
  });
});
