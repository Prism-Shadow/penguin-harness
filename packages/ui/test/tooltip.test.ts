/**
 * The tooltip (src/components/overlays/tooltip/tooltip.tsx): where it hangs its panel and how wide
 * the panel may grow, the rule that decides whether a hint shows at all, and how the one
 * `TooltipLayer` reads a `data-tooltip` request.
 *
 * The panel is pinned by one horizontal edge and grows away from it, so the only width it can
 * safely take is the room between that edge and the viewport margin on the far side. A long
 * text — a background process's command, shown whole — wraps at that room instead of running off
 * a phone's screen; a short label never reaches it.
 *
 * The rule: a hint shows for an element with no visible text of its own, or one whose visible
 * text is cut off — never for a label the reader can already read in full.
 *
 * The panel itself mounts only while hovered and through a portal, which a static render cannot
 * reach; what it may be drawn with (the overlay surface, token inks, the glass hook) is pinned
 * against the source. Where the app may still use a native `title` is the web app's
 * `no-native-title.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Tooltip,
  belowTrigger,
  besideTrigger,
  hintAllowed,
  isCutOff,
  namedHint,
  tooltipRequest,
} from "../src/components/overlays/tooltip/tooltip";
import { renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const VIEWPORT = { width: 1000, height: 800 };

/** A trigger box from its left/top corner and size. */
const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("belowTrigger", () => {
  it("anchors by the right edge in the right half, with the room reaching back to the left margin", () => {
    // A command line near the right of the window: the panel grows leftward from its right edge.
    expect(belowTrigger(box(700, 100, 200, 20), VIEWPORT)).toEqual({
      top: 128,
      right: 100,
      room: 892,
    });
  });

  it("anchors by the left edge in the left half, with the room reaching to the right margin", () => {
    // A phone-width card: the room, not the panel's own cap, is what keeps the text on screen.
    expect(belowTrigger(box(40, 100, 200, 20), { width: 390, height: 800 })).toEqual({
      top: 128,
      left: 40,
      room: 342,
    });
  });

  it("keeps the anchored edge inside the viewport margin", () => {
    expect(belowTrigger(box(900, 0, 100, 20), VIEWPORT).right).toBe(8);
    expect(belowTrigger(box(-20, 0, 100, 20), VIEWPORT).left).toBe(8);
  });
});

describe("besideTrigger", () => {
  it("hangs to the right of a rail entry, centred on it, with the room to the right margin", () => {
    expect(besideTrigger(box(8, 200, 32, 32), VIEWPORT)).toEqual({ top: 216, left: 48, room: 944 });
  });

  it("clamps the centre into the viewport and never reports negative room", () => {
    const offscreen = besideTrigger(box(990, 900, 32, 32), VIEWPORT);
    expect(offscreen.top).toBe(792);
    expect(offscreen.room).toBe(0);
  });
});

const clip = (scrollWidth: number, clientWidth: number, scrollHeight = 16, clientHeight = 16) => ({
  scrollWidth,
  clientWidth,
  scrollHeight,
  clientHeight,
});

describe("isCutOff", () => {
  it("reads overflow on either axis as cut off", () => {
    expect(isCutOff(clip(240, 120))).toBe(true);
    expect(isCutOff(clip(100, 100, 40, 20))).toBe(true);
  });

  it("forgives the pixel of overflow layout reports for text that fits", () => {
    expect(isCutOff(clip(101, 100, 17, 16))).toBe(false);
    expect(isCutOff(clip(100, 100))).toBe(false);
  });
});

describe("hintAllowed", () => {
  it("shows the hint of an element with no text of its own (an icon, a chart mark)", () => {
    expect(hintAllowed("", [clip(24, 24)])).toBe(true);
    expect(hintAllowed("   ", [])).toBe(true);
  });

  it("shows the hint when the visible text is cut off anywhere inside", () => {
    expect(hintAllowed("A very long Session title", [clip(200, 200), clip(320, 180)])).toBe(true);
  });

  it("shows no hint for text that is fully visible, whatever the hint would add", () => {
    expect(hintAllowed("3 min ago", [clip(60, 60), clip(58, 60)])).toBe(false);
    expect(hintAllowed("Copy prompt", [])).toBe(false);
  });
});

describe("a data-tooltip request", () => {
  const el = (attrs: Record<string, string>) => ({
    getAttribute: (name: string) => attrs[name] ?? null,
  });

  it("reads the text, the kind and the side, defaulting to a label below", () => {
    expect(tooltipRequest(el({ "data-tooltip": "Rename" }))).toEqual({
      label: "Rename",
      content: "label",
      placement: "bottom",
    });
    expect(
      tooltipRequest(
        el({
          "data-tooltip": "npm run dev",
          "data-tooltip-content": "code",
          "data-tooltip-placement": "right",
        }),
      ),
    ).toEqual({ label: "npm run dev", content: "code", placement: "right" });
  });

  it("asks for nothing when the text is missing or blank", () => {
    expect(tooltipRequest(el({}))).toBeNull();
    expect(tooltipRequest(el({ "data-tooltip": "  " }))).toBeNull();
  });
});

describe("namedHint", () => {
  it("names a wordless mark with the words its hint shows", () => {
    expect(namedHint("Bar 3")).toEqual({
      role: "img",
      "aria-label": "Bar 3",
      "data-tooltip": "Bar 3",
    });
  });
});

describe("Tooltip", () => {
  it("wraps its trigger in the measuring span and renders no panel until hovered", () => {
    const html = renderStatic(
      createElement(Tooltip, { label: "Settings", className: "mt-auto", children: "gear" }),
    );
    expect(html).toBe('<span class="flex mt-auto">gear</span>');
    // Deliberately no tooltip role or description: the trigger's own name is the one name.
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain("aria-describedby");
  });

  it("draws the panel on the overlay surface in token inks, as a glass layer that takes no clicks", () => {
    const source = readFileSync(join(SRC_DIR, "components/overlays/tooltip/tooltip.tsx"), "utf8");
    const panel = /className=\{`(ui-glass [^`]*)`\}/.exec(source);
    expect(panel, "the panel's class string").not.toBeNull();
    const tokens = panel![1]!.split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "ui-glass",
        "pointer-events-none",
        "border-line",
        "bg-overlay",
        "text-fg",
        "z-[60]",
      ]),
    );
    expect(source).toContain("aria-hidden");
  });
});
