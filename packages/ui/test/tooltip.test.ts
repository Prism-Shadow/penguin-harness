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
 * Vertically, a panel hangs under a toolbar control, with three cases once its height is known:
 * - Given a control at the foot of the window (the composer's context ring) and a panel taller
 *   than the room left below it, then the panel stands over the control, pinned by its bottom
 *   edge, instead of running past the window's bottom.
 * - Given a panel that fits below, then it stays below, however low the control sits.
 * - Given a panel too tall for either side, then it takes the roomier one.
 *
 * The rule: a hint shows for an element with no visible text of its own, or one whose visible
 * text is cut off — never for a label the reader can already read in full. An SVG's text and
 * anything `aria-hidden` are not read as words; a hint marked as carrying what the screen does
 * not show (`data-tooltip-extra`) opens over visible text all the same.
 *
 * A shortened line nobody wrote a hint for still shows its whole text:
 * - Given a line shortened by an ellipsis or a line clamp, when the pointer rests on it (or on
 *   an ancestor-held span inside it), then it is the line asked about.
 * - Given a row control holding a title and a description, when the pointer rests anywhere on
 *   the row, then both lines are candidates, in order, so whichever is cut off can show.
 * - Given a panel that merely contains shortened rows, when the pointer rests on its padding,
 *   then nothing is asked about: a panel is not one line.
 * - Given a `<Tooltip>` wrapper or a title that scrolls its own tail into view
 *   (`data-tooltip-owned`), then no full-text hint is added inside it.
 * - The whole text shows in the code panel for a monospace line (a path), the text panel
 *   otherwise, and a blank line asks for nothing.
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
  TOOLTIP_OWNED_ATTR,
  Tooltip,
  belowTrigger,
  besideTrigger,
  hintAllowed,
  isCutOff,
  lineRequest,
  namedHint,
  readingText,
  shortenedLines,
  shortensText,
  tooltipRequest,
  type LineNode,
  type LineStyle,
  type ReadingNode,
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

  it("stands a panel with no room below over a control at the foot of the window", () => {
    // The composer's context ring, 21px above the bottom edge, and its one-line hint.
    expect(belowTrigger(box(40, 747, 32, 32), VIEWPORT, 26)).toEqual({
      bottom: 61,
      left: 40,
      room: 952,
    });
  });

  it("keeps a panel that fits below there, however low its control sits", () => {
    expect(belowTrigger(box(40, 700, 32, 32), VIEWPORT, 26)).toEqual({
      top: 740,
      left: 40,
      room: 952,
    });
  });

  it("puts a panel too tall for either side on the roomier one", () => {
    expect(belowTrigger(box(40, 200, 32, 32), VIEWPORT, 700)).toMatchObject({ top: 240 });
    expect(belowTrigger(box(40, 560, 32, 32), VIEWPORT, 700)).toMatchObject({ bottom: 248 });
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

describe("what counts as visible text, and the mark that overrides it", () => {
  const text = (value: string): ReadingNode => ({ nodeType: 3, nodeValue: value, childNodes: [] });
  const el = (
    localName: string,
    children: ReadingNode[],
    attrs: Record<string, string> = {},
  ): ReadingNode => ({
    nodeType: 1,
    nodeValue: null,
    localName,
    childNodes: children,
    getAttribute: (name) => attrs[name] ?? null,
  });

  it("skips an SVG's text and anything aria-hidden: an avatar's initial or a letter icon is no label", () => {
    const avatar = el("span", [el("svg", [el("text", [text("A")])])]);
    const caseToggle = el("button", [el("span", [text("Aa")], { "aria-hidden": "true" })]);
    const labelled = el("button", [text("Clear "), el("span", [text("exited")])]);
    expect(readingText(avatar)).toBe("");
    expect(readingText(caseToggle)).toBe("");
    expect(readingText(labelled)).toBe("Clear exited");
    expect(hintAllowed(readingText(avatar), [clip(16, 16)])).toBe(true);
  });

  it("opens a hint marked data-tooltip-extra over text that is fully visible, React's false left unmarked", () => {
    const request = (extra: string) => {
      const attrs: Record<string, string> = {
        "data-tooltip": "Their captured output is discarded too",
        "data-tooltip-extra": extra,
      };
      return tooltipRequest({ getAttribute: (name: string) => attrs[name] ?? null });
    };
    expect(request("true")?.extra).toBe(true);
    expect(request("false")?.extra).toBe(false);
    expect(hintAllowed("Clear exited", [clip(80, 80)], true)).toBe(true);
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
      extra: false,
    });
    expect(
      tooltipRequest(
        el({
          "data-tooltip": "npm run dev",
          "data-tooltip-content": "code",
          "data-tooltip-placement": "right",
        }),
      ),
    ).toEqual({ label: "npm run dev", content: "code", placement: "right", extra: false });
  });

  it("asks for nothing when the text is missing or blank", () => {
    expect(tooltipRequest(el({}))).toBeNull();
    expect(tooltipRequest(el({ "data-tooltip": "  " }))).toBeNull();
  });
});

describe("a shortened line with no hint of its own", () => {
  const plain: LineStyle = { textOverflow: "clip", lineClamp: "none", fontFamily: "Inter" };
  const ellipsis: LineStyle = { ...plain, textOverflow: "ellipsis" };

  /** A hand-built element: a tag, its attributes, how it sets its text, and its children. */
  interface FakeNode extends LineNode {
    name: string;
    style: LineStyle;
    children: FakeNode[];
  }
  const node = (
    name: string,
    style: LineStyle,
    children: FakeNode[] = [],
    attrs: string[] = [],
  ): FakeNode => {
    const self: FakeNode = {
      name,
      style,
      children,
      parentElement: null,
      hasAttribute: (attr) => attrs.includes(attr),
      matches: (selector) => selector.split(",").some((s) => s.trim().split(/[[.]/)[0] === name),
      querySelectorAll: () => descendants(self),
    };
    for (const child of children) child.parentElement = self;
    return self;
  };
  const descendants = (n: FakeNode): FakeNode[] =>
    n.children.flatMap((child) => [child, ...descendants(child)]);
  const styleOf = (n: FakeNode) => n.style;

  it("counts an ellipsis or a line clamp as shortening, plain clipping as not", () => {
    expect(shortensText(ellipsis)).toBe(true);
    expect(shortensText({ ...plain, lineClamp: "2" })).toBe(true);
    expect(shortensText(plain)).toBe(false);
    expect(shortensText({ ...plain, lineClamp: "" })).toBe(false);
  });

  it("asks about the line the pointer rests on, or the shortened line around it", () => {
    const text = node("span", plain);
    const line = node("p", ellipsis, [text]);
    node("div", plain, [line]);
    expect(shortenedLines(line, styleOf)).toEqual({ at: line, lines: [line] });
    expect(shortenedLines(text, styleOf)).toEqual({ at: line, lines: [line] });
  });

  it("offers every line of a row control, title and description in order", () => {
    const title = node("span", ellipsis);
    const description = node("p", ellipsis);
    const row = node("button", plain, [node("div", plain, [title, description])]);
    expect(shortenedLines(row, styleOf)).toEqual({ at: row, lines: [title, description] });
  });

  it("asks about nothing on a panel that merely holds shortened rows", () => {
    const panel = node("div", plain, [node("button", plain, [node("span", ellipsis)])]);
    expect(shortenedLines(panel, styleOf)).toBeNull();
  });

  it("adds nothing inside a subtree whose hint someone else decides", () => {
    const scrolling = node("span", ellipsis, [node("span", plain)], [TOOLTIP_OWNED_ATTR]);
    expect(shortenedLines(scrolling, styleOf)).toBeNull();
    expect(shortenedLines(scrolling.children[0]!, styleOf)).toBeNull();
    const wrapped = node("span", plain, [node("span", ellipsis)], [TOOLTIP_OWNED_ATTR]);
    const row = node("button", plain, [wrapped, node("span", ellipsis)]);
    expect(shortenedLines(row, styleOf)?.lines).toEqual([row.children[1]]);
  });

  it("shows the whole text in the code panel for a monospace line, the text panel otherwise", () => {
    const mono = { ...ellipsis, fontFamily: 'ui-monospace, "JetBrains Mono", monospace' };
    expect(lineRequest("  feedback/review-style.md ", mono)).toEqual({
      label: "feedback/review-style.md",
      content: "code",
      placement: "bottom",
      extra: false,
    });
    expect(lineRequest("A long memory description", ellipsis)?.content).toBe("text");
    expect(lineRequest("   ", ellipsis)).toBeNull();
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
  it("wraps its trigger in the measuring span, which owns the hints inside, and renders no panel until hovered", () => {
    const html = renderStatic(
      createElement(Tooltip, { label: "Settings", className: "mt-auto", children: "gear" }),
    );
    expect(html).toBe('<span data-tooltip-owned="" class="flex mt-auto">gear</span>');
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
