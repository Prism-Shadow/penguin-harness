/**
 * The icon family (src/lib/icon-scale.ts and the renderers in components/ui).
 *
 * These are source scans rather than render assertions, because the thing that decays is not any
 * one component's output — it is a new inline `<svg>` re-drawing a glyph the app already owns, at
 * a stroke weight nobody chose. The three paths asserted below each used to exist in five or six
 * hand-typed copies.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_GAP, ICON_SIZE } from "../src/lib/icon-scale";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sources(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

// Forward slashes whatever the platform separator is, so the expected paths below read the same
// on Windows as they do everywhere else.
const FILES = sources().map(
  (path) => [path.slice(SRC.length + 1).replaceAll(sep, "/"), readFileSync(path, "utf8")] as const,
);

/** Every occurrence of `needle`, as "relative/path:count". */
const occurrences = (needle: string) =>
  FILES.filter(([, src]) => src.includes(needle)).map(([rel]) => rel);

describe("icon scale", () => {
  it("names every rung with a whole pixel value", () => {
    for (const [role, size] of Object.entries(ICON_SIZE)) {
      expect(Number.isInteger(size), `${role} must be a whole pixel`).toBe(true);
      expect(size).toBeGreaterThan(8);
      expect(size).toBeLessThan(33);
    }
  });

  it("keeps the gap rungs in ascending order, as the text sizes they track are", () => {
    expect(Object.values(ICON_GAP)).toEqual(["gap-1", "gap-1.5", "gap-2", "gap-3"]);
  });
});

describe("one glyph, one home", () => {
  it("draws the form-control caret in exactly one place", () => {
    expect(occurrences("M3 4.5l3 3 3-3")).toEqual(["components/ui/icons.tsx"]);
  });

  it("draws the close cross in exactly one place", () => {
    expect(occurrences("M2 2l10 10M12 2L2 12")).toEqual(["components/ui/icons.tsx"]);
  });

  it("draws the collapse chevron in exactly one place", () => {
    expect(occurrences("M9 5l7 7-7 7")).toEqual(["components/ui/chevron.tsx"]);
  });
});

describe("stroke weights", () => {
  it("uses no weight outside the ones the family actually chose", () => {
    // 1.7 is the 24x24 line family; 1.5 belongs to the two marks drawn on their own smaller
    // grids (the caret and the close cross) and to chart rules; 2 is the checkmark, the ring
    // gauges and the send arrow on a filled button; 2.2 is the collapse chevron alone; 1 is the
    // login background art. Anything else — a 1.6 or a 1.8 — is a glyph nobody sized on purpose.
    const allowed = new Set(["1", "1.5", "1.7", "2", "2.2"]);
    const strays: string[] = [];
    for (const [rel, src] of FILES) {
      for (const m of src.matchAll(/strokeWidth="([0-9.]+)"/g)) {
        if (!allowed.has(m[1] ?? "")) strays.push(`${rel}: ${m[1]}`);
      }
    }
    expect(strays).toEqual([]);
  });
});
