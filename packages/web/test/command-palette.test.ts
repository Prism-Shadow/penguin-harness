import { describe, expect, it } from "vitest";
import { filterPaletteActions } from "../src/lib/command-palette";

// The chord that opens the palette is the registry's `palette.toggle`; its matching per
// platform is covered by test/shortcuts-match.test.ts.

describe("command palette filter", () => {
  const actions = [
    { id: "history", label: "Harness history", keywords: ["version", "hmr"] },
    { id: "reload", label: "Reload page" },
  ];
  it("lists everything for an empty query, in registration order", () => {
    expect(filterPaletteActions(actions, "  ").map((a) => a.id)).toEqual(["history", "reload"]);
  });
  it("matches every token, case-insensitively, against the label and the keywords", () => {
    expect(filterPaletteActions(actions, "HIST").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(actions, "harness hist").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(actions, "hmr").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(actions, "page harness")).toEqual([]);
  });
});
