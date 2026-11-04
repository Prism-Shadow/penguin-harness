/**
 * The find bar's control row (components/content/find/find-field.tsx) and the paint behind every
 * find (find-dom.ts), as the app's find bar and the Markdown reader use them.
 *
 * - In the query box, Enter and F3 step forward and Shift steps back; ↓ and ↑ step only where the
 *   host asked for them (the reader), and a key that only commits an IME composition steps
 *   nowhere.
 * - The match-case toggle is offered only to a host that can act on it.
 * - Two finds paint at once without disturbing each other: each owner's hits stay painted while
 *   the other repaints, closing one clears only its own, and the strong mark is the current hit
 *   of each.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FindField, findStepForKey } from "../src/components/content/find/find-field";
import { clearHighlights, paintHits } from "../src/components/content/find/find-dom";
import type { FindHit } from "../src/components/content/find/find-dom";

describe("the query box's keys", () => {
  it("steps forward on Enter and F3, and back with Shift", () => {
    expect(findStepForKey("Enter", false, false, false)).toBe(1);
    expect(findStepForKey("F3", false, false, false)).toBe(1);
    expect(findStepForKey("Enter", true, false, false)).toBe(-1);
  });

  it("steps on the arrows only where the host asked for them", () => {
    expect(findStepForKey("ArrowDown", false, false, true)).toBe(1);
    expect(findStepForKey("ArrowUp", false, false, true)).toBe(-1);
    expect(findStepForKey("ArrowDown", false, false, false)).toBeNull();
  });

  it("steps nowhere on a key that commits an IME composition", () => {
    expect(findStepForKey("Enter", false, true, true)).toBeNull();
  });
});

describe("the match-case toggle", () => {
  const field = (onCaseSensitiveChange?: (next: boolean) => void) =>
    renderToStaticMarkup(
      createElement(FindField, {
        query: "deploy",
        onQueryChange: () => {},
        counter: "1/3",
        canStep: true,
        onStep: () => {},
        onClose: () => {},
        labels: {
          placeholder: "Find",
          previous: "Previous",
          next: "Next",
          close: "Close",
          caseSensitive: "Match case",
        },
        ...(onCaseSensitiveChange !== undefined ? { onCaseSensitiveChange } : {}),
      }),
    );

  it("is offered only to a host that can act on it", () => {
    expect(field(() => {})).toContain('aria-label="Match case"');
    expect(field()).not.toContain('aria-label="Match case"');
  });
});

describe("painting two finds at once", () => {
  /** The browser's highlight registry: a name to the ranges painted under it. */
  const registry = new Map<string, Set<unknown>>();
  const range = (name: string) => ({ name }) as unknown as Range;
  const hits = (...names: string[]) => names.map((name) => ({ range: range(name) }) as FindHit);
  const painted = (name: string) =>
    [...(registry.get(name) ?? [])].map((r) => (r as { name: string }).name).sort();

  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal("Highlight", Set);
  afterEach(() => {
    clearHighlights("reader");
    clearHighlights();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("keeps each owner's hits painted while the other repaints", () => {
    paintHits(hits("page-a", "page-b"), 0);
    paintHits(hits("doc-a", "doc-b", "doc-c"), 1, "reader");
    expect(painted("penguin-find")).toEqual(["doc-a", "doc-c", "page-b"]);
    expect(painted("penguin-find-current")).toEqual(["doc-b", "page-a"]);
  });

  it("clears only the closing owner's hits", () => {
    paintHits(hits("page-a"), 0);
    paintHits(hits("doc-a", "doc-b"), 0, "reader");
    clearHighlights("reader");
    expect(painted("penguin-find")).toEqual([]);
    expect(painted("penguin-find-current")).toEqual(["page-a"]);
    clearHighlights();
    expect(registry.has("penguin-find-current")).toBe(false);
  });
});
