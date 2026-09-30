/**
 * The chrome's drawn controls. The gallery's vitest is node-only, so the select's keyboard and
 * placement rules are tested as the pure functions they are, and the components are held to
 * their idiom by source contract: the select is the app's — a trigger that owns a listbox, rows
 * that are options, the chosen one checked — with no native `<select>` left; hints are the
 * chrome's tooltip, with no native `title` left on anything but the frame itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextOptionIndex, placePanel, typeaheadIndex } from "../src/lib/listbox";
import { placeTip, shouldHint } from "../src/lib/tip";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
/** A source with its comments blanked, so a comment naming what was replaced is not a hit. */
const code = (file: string) =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
  });
}

describe("the listbox keys", () => {
  it("step with the arrows and stop at the ends", () => {
    expect(nextOptionIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextOptionIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextOptionIndex("ArrowUp", 2, 3)).toBe(1);
    expect(nextOptionIndex("ArrowUp", 0, 3)).toBe(0);
  });

  it("enter the list at its first or last row when nothing is active", () => {
    expect(nextOptionIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextOptionIndex("ArrowUp", -1, 3)).toBe(2);
  });

  it("jump with Home and End, and leave every other key alone", () => {
    expect(nextOptionIndex("Home", 2, 3)).toBe(0);
    expect(nextOptionIndex("End", 0, 3)).toBe(2);
    expect(nextOptionIndex("Enter", 1, 3)).toBeNull();
    expect(nextOptionIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("jump to the next option starting with a typed character, wrapping round", () => {
    const labels = ["Theme default", "System", "Mona Sans", "MiSans", "Noto Sans SC"];
    expect(typeaheadIndex("m", labels, 0)).toBe(2);
    expect(typeaheadIndex("M", labels, 2)).toBe(3);
    expect(typeaheadIndex("m", labels, 3)).toBe(2);
    expect(typeaheadIndex("z", labels, 0)).toBeNull();
    expect(typeaheadIndex(" ", labels, 0)).toBeNull();
    expect(typeaheadIndex("Enter", labels, 0)).toBeNull();
  });
});

describe("the panel placement", () => {
  const viewport = { width: 1280, height: 800 };
  const trigger = { top: 100, bottom: 128, left: 900, width: 168 };

  it("opens under the trigger, as wide as it at least", () => {
    expect(placePanel(trigger, viewport, 160)).toEqual({ top: 132, left: 900, minWidth: 168 });
  });

  it("opens above when below lacks the room and above has more", () => {
    const low = { top: 700, bottom: 728, left: 900, width: 168 };
    expect(placePanel(low, viewport, 160)).toEqual({ bottom: 104, left: 900, minWidth: 168 });
    // Below is short but above is shorter still: it stays below.
    const high = { top: 40, bottom: 68, left: 900, width: 168 };
    expect(placePanel(high, { width: 1280, height: 200 }, 160).top).toBe(72);
  });

  it("keeps the left edge inside the viewport", () => {
    expect(placePanel({ ...trigger, left: 1200 }, viewport, 160).left).toBe(1280 - 168 - 16);
    expect(placePanel({ ...trigger, left: 4 }, viewport, 160).left).toBe(16);
  });
});

describe("the tooltip rule", () => {
  const fits = { scrollWidth: 80, clientWidth: 80, scrollHeight: 20, clientHeight: 20 };
  const cutOff = { scrollWidth: 140, clientWidth: 80, scrollHeight: 20, clientHeight: 20 };
  const wrapped = { scrollWidth: 80, clientWidth: 80, scrollHeight: 40, clientHeight: 20 };

  it("hints an icon-only element, whatever its boxes", () => {
    expect(shouldHint("", [fits])).toBe(true);
    expect(shouldHint("  \n ", [fits, fits])).toBe(true);
    expect(shouldHint("", [])).toBe(true);
  });

  it("hints text only when some box of it is cut off, sideways or downward", () => {
    expect(shouldHint("Copy breadcrumb", [fits, fits])).toBe(false);
    expect(shouldHint("Primer › Chat · dark", [fits, cutOff])).toBe(true);
    expect(shouldHint("Two lines", [wrapped])).toBe(true);
  });

  it("is what the layer asks before it opens", () => {
    const layer = read("chrome/tooltip.tsx");
    expect(layer).toMatch(
      /if \(!shouldHint\(el\.textContent \?\? "", \[el, \.\.\.el\.querySelectorAll\("\*"\)\]\)\) return;/,
    );
  });
});

describe("the tooltip placement", () => {
  const viewport = { width: 1000, height: 800 };

  it("hangs under a trigger on the left half, growing rightward", () => {
    expect(placeTip({ bottom: 40, left: 100, right: 130, width: 30 }, viewport)).toEqual({
      top: 46,
      left: 100,
      room: 1000 - 100 - 8,
    });
  });

  it("hangs under a trigger on the right half by its right edge, growing leftward", () => {
    expect(placeTip({ bottom: 40, left: 960, right: 990, width: 30 }, viewport)).toEqual({
      top: 46,
      right: 10,
      room: 1000 - 10 - 8,
    });
  });

  it("never sits closer to an edge than the margin", () => {
    expect(placeTip({ bottom: 40, left: 2, right: 20, width: 18 }, viewport).left).toBe(8);
    expect(placeTip({ bottom: 40, left: 990, right: 1000, width: 10 }, viewport).right).toBe(8);
  });
});

describe("the chrome's idiom", () => {
  const files = walk(SRC);

  it("draws its selects the app's way: a listbox trigger, option rows, the chosen one checked", () => {
    const select = read("chrome/select.tsx");
    expect(select).toMatch(/aria-haspopup="listbox"/);
    expect(select).toMatch(/role="listbox"/);
    expect(select).toMatch(/role="option"/);
    expect(select).toMatch(/aria-selected=\{option\.value === value\}/);
    expect(select).toMatch(/option\.value === value && <ChromeIcon name="check"/);
    expect(select).toMatch(/createPortal\(/);
    // The font pairings go through it, each under its visible label.
    const topbar = read("chrome/topbar.tsx");
    expect(topbar).toMatch(/<Control label=\{S\.rail\.fontLatin\}>\s*<Select/);
    expect(topbar).toMatch(/<Control label=\{S\.rail\.fontCjk\}>\s*<Select/);
  });

  it("renders no native select", () => {
    const offenders = files.filter((file) => /<select[\s>]/.test(code(file)));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("hints with the chrome's tooltip, never a native title, except on the frame", () => {
    const offenders = files.flatMap((file) => {
      // A `title=` on an intrinsic element; `title={title}` on a component is a prop.
      return [...code(file).matchAll(/<([a-z][\w-]*)\b[^>]*?\stitle=/gs)]
        .filter((m) => m[1] !== "iframe")
        .map((m) => `${path.relative(SRC, file)}: <${m[1]}>`);
    });
    expect(offenders).toEqual([]);
    expect(read("chrome/site.tsx")).toMatch(/<ChromeTooltips \/>/);
    expect(read("chrome/tooltip.tsx")).toMatch(/TOOLTIP_ATTR = "data-tooltip"/);
  });

  it("marks a copy as done on the icon alone, never by swapping the text", () => {
    for (const file of ["chrome/crumb.tsx", "pages/surface.tsx", "pages/library.tsx"]) {
      const source = read(file);
      expect(source).toMatch(/copied[^\n]*\? "check" :/);
      expect(source).not.toMatch(/copied\b[^\n]*\? S\./);
    }
    expect(read("strings.ts")).not.toMatch(/\bcopied:/);
  });

  it("keeps the bar to one row, with the menu button for phone width only", () => {
    const css = read("chrome.css");
    expect(css).toMatch(/\.g-topbar \{[^}]*height: var\(--g-bar\)/s);
    expect(css).not.toMatch(/\.g-topbar \{[^}]*flex-wrap/s);
    // The hiding rule carries the bar's selector, so the generic icon-button rule cannot outrank it.
    expect(css).toMatch(/\.g-topbar \.g-menu \{\s*display: none;\s*\}/);
    expect(css).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*\.g-topbar \.g-menu \{\s*display: inline-grid/,
    );
  });
});
