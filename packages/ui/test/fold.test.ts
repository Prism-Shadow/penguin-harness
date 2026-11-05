/**
 * Fold (src/components/layout/fold/): the disclosure body that mounts on open and folds both
 * ways, under the theme's layout motion.
 *
 * - Given a body that mounts open, it is settled: a page load moves nothing, and nothing clips it
 *   or makes it inert.
 * - Given a body that mounts closed, nothing is rendered.
 * - Given a closed body that opens, it enters (the theme's `@starting-style` grows its track).
 * - Given an open body that closes while the theme has a layout duration, it stays mounted and
 *   inert until the track's transition ends, then leaves.
 * - Given a close with no transition to wait for (a zero or a missing duration: reduced motion, no
 *   motion tokens, a body not rendered), it leaves at once — nothing would ever end it.
 * - Given a body reopened mid-close, it enters again from where the track has got to.
 * - Given an entrance that finishes, the body is settled; an end that arrives for a body at rest
 *   changes nothing.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Fold } from "../src/components/layout/fold/fold";
import { foldStart, foldStep, instantDuration } from "../src/components/layout/fold/fold-phase";
import type { FoldPhase } from "../src/components/layout/fold/fold-phase";
import { renderStatic } from "../src/testing";

/** Runs a sequence of events from where a fold mounted. */
const run = (mountedOpen: boolean, ...events: Parameters<typeof foldStep>[1][]): FoldPhase =>
  events.reduce(foldStep, foldStart(mountedOpen));

describe("the fold's phases", () => {
  it("a body that mounts open is settled, one that mounts closed is not there", () => {
    expect(foldStart(true)).toBe("settled");
    expect(foldStart(false)).toBe("closed");
  });

  it("a closed body that opens enters", () => {
    expect(run(false, { open: true })).toBe("open");
  });

  it("an open body that closes under a layout duration folds, then leaves when the track ends", () => {
    expect(run(true, { open: false, duration: "0.32s" })).toBe("closing");
    expect(run(true, { open: false, duration: "0.32s" }, { ended: true })).toBe("closed");
    expect(run(false, { open: true }, { open: false, duration: "200ms" })).toBe("closing");
  });

  it.each([["0s"], ["0s, 0s"], [""], [undefined]])(
    "a close with nothing to wait for (duration %j) leaves at once",
    (duration) => {
      expect(run(true, { open: false, duration })).toBe("closed");
    },
  );

  it("a body reopened mid-close enters again instead of leaving", () => {
    const reopened = run(true, { open: false, duration: "0.32s" }, { open: true });
    expect(reopened).toBe("open");
    // The cancelled close's end, if it arrives late, only settles the entrance.
    expect(foldStep(reopened, { ended: true })).toBe("settled");
  });

  it("an entrance that ends is settled, and an end at rest changes nothing", () => {
    expect(run(false, { open: true }, { ended: true })).toBe("settled");
    expect(run(true, { ended: true })).toBe("settled");
    expect(run(false, { ended: true })).toBe("closed");
  });

  it("repeating the same open or close moves nothing", () => {
    expect(run(true, { open: true })).toBe("settled");
    expect(run(false, { open: false, duration: "0.32s" })).toBe("closed");
    expect(run(true, { open: false, duration: "1s" }, { open: false, duration: "1s" })).toBe(
      "closing",
    );
  });

  it("reads a duration list as instant only when every entry is zero", () => {
    expect(instantDuration("0s, 0.2s")).toBe(false);
    expect(instantDuration("0s, 0ms")).toBe(true);
  });
});

describe("Fold", () => {
  const fold = (open: boolean, props: Partial<Parameters<typeof Fold>[0]> = {}) =>
    renderStatic(createElement(Fold, { open, ...props }, createElement("p", null, "rows")));

  it("mounted open, is a settled layout-motion track whose body neither clips nor goes inert", () => {
    const html = fold(true);
    expect(html).toBe(
      '<div data-layout-motion="true" data-fold="settled" class="grid"><div class="min-h-0 min-w-0"><p>rows</p></div></div>',
    );
  });

  it("mounted closed, renders nothing — and never builds a body handed over as a function", () => {
    let built = false;
    const html = renderStatic(
      createElement(Fold, {
        open: false,
        children: () => {
          built = true;
          return "rows";
        },
      }),
    );
    expect(html).toBe("");
    expect(built).toBe(false);
  });

  it("carries its slot on the track and the list's own layout on the body", () => {
    const html = fold(true, { "data-slot": "body", bodyClassName: "ui-tree divide-y" });
    expect(html).toMatch(/^<div data-layout-motion="true" data-fold="settled" data-slot="body"/);
    expect(html).toContain('<div class="min-h-0 min-w-0 ui-tree divide-y"><p>rows</p></div>');
  });
});
