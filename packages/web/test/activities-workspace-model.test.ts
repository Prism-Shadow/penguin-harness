import { describe, expect, it } from "vitest";
import {
  EDITOR_MIN_WIDTH,
  RAIL_DEFAULT_WIDTH,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  clampRailWidth,
  fitsComparison,
  WORKSPACE_TWO_PANE_WIDTH,
  railFitsBeside,
  railWidthAfterKey,
  railWidthFor,
  readRailCollapsed,
  readRailWidth,
  resolveSection,
  workspaceSections,
  writeRailCollapsed,
  writeRailWidth,
} from "../src/features/activities/workspace-model";

const full = { hasSpec: true, hasPlan: true, hasModule: true };
const fresh = { hasSpec: false, hasPlan: false, hasModule: false };

function memory(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    read: (key: string) => store.get(key) ?? null,
  };
}

describe("workspace sections", () => {
  it("offers every part of an activity, in one order", () => {
    expect(workspaceSections(full).map((section) => section.key)).toEqual([
      "description",
      "specification",
      "scenes",
      "speech",
      "library",
      "module",
      "history",
    ]);
  });

  it("keeps a section visible but disabled until its subject exists", () => {
    const enabled = Object.fromEntries(
      workspaceSections(fresh).map((section) => [section.key, section.enabled]),
    );
    expect(enabled).toMatchObject({
      description: true,
      specification: true,
      scenes: true,
      speech: false,
      module: false,
      library: true,
      history: true,
    });
  });

  it("keeps scenes reachable, since it holds the plan-media action", () => {
    const planned = { hasSpec: true, hasPlan: false, hasModule: false };
    expect(workspaceSections(planned).find((s) => s.key === "scenes")?.enabled).toBe(true);
    expect(workspaceSections(fresh).find((s) => s.key === "scenes")?.enabled).toBe(true);
    // Speech has no entry point of its own, so it waits for the plan.
    expect(workspaceSections(planned).find((s) => s.key === "speech")?.enabled).toBe(false);
    expect(
      workspaceSections({ ...planned, hasPlan: true }).find((s) => s.key === "speech")?.enabled,
    ).toBe(true);
  });
});

describe("section selection", () => {
  it("honours a choice while it is available", () => {
    expect(resolveSection("speech", full)).toBe("speech");
    expect(resolveSection("history", full)).toBe("history");
  });

  it("falls back to the first available section when a choice goes away", () => {
    expect(resolveSection("module", fresh)).toBe("description");
    expect(resolveSection(null, full)).toBe("description");
  });
});

describe("rail width", () => {
  it("keeps a width inside its bounds", () => {
    expect(clampRailWidth(300)).toBe(300);
    expect(clampRailWidth(10)).toBe(RAIL_MIN_WIDTH);
    expect(clampRailWidth(9000)).toBe(RAIL_MAX_WIDTH);
    expect(clampRailWidth(300.4)).toBe(300);
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_DEFAULT_WIDTH);
  });

  it("gives way rather than squeezing the editor below its comparison", () => {
    // A wide window keeps the author's width.
    expect(railWidthFor(400, 1400)).toBe(400);
    // A narrow one takes it back to protect the editor.
    expect(railWidthFor(400, 800)).toBe(800 - EDITOR_MIN_WIDTH);
    // Past the point where both fit, the rail stops at its minimum.
    expect(railWidthFor(400, 600)).toBe(RAIL_MIN_WIDTH);
    expect(railWidthFor(400, 0)).toBe(400);
  });

  it("knows when the editor can still show two previews", () => {
    expect(fitsComparison(900)).toBe(true);
    expect(fitsComparison(640)).toBe(true);
    expect(fitsComparison(500)).toBe(false);
    expect(fitsComparison(Number.NaN)).toBe(false);
  });

  it("knows when the rail cannot sit beside the editor at all", () => {
    expect(railFitsBeside(1280)).toBe(true);
    expect(railFitsBeside(WORKSPACE_TWO_PANE_WIDTH)).toBe(true);
    expect(railFitsBeside(WORKSPACE_TWO_PANE_WIDTH - 1)).toBe(false);
    // A phone: the rail beside the editor would leave it a sliver.
    expect(railFitsBeside(390)).toBe(false);
    expect(RAIL_MIN_WIDTH + EDITOR_MIN_WIDTH).toBe(WORKSPACE_TWO_PANE_WIDTH);
    // Unmeasured counts as wide, so the first paint is not a phone layout.
    expect(railFitsBeside(0)).toBe(true);
    expect(railFitsBeside(Number.NaN)).toBe(true);
  });

  it("moves by keyboard, and jumps to either bound", () => {
    expect(railWidthAfterKey(300, "ArrowRight")).toBe(316);
    expect(railWidthAfterKey(300, "ArrowLeft")).toBe(284);
    expect(railWidthAfterKey(300, "ArrowRight", true)).toBe(364);
    expect(railWidthAfterKey(300, "Home")).toBe(RAIL_MIN_WIDTH);
    expect(railWidthAfterKey(300, "End")).toBe(RAIL_MAX_WIDTH);
    expect(railWidthAfterKey(300, "Enter")).toBeNull();
    expect(railWidthAfterKey(RAIL_MIN_WIDTH, "ArrowLeft")).toBe(RAIL_MIN_WIDTH);
  });
});

describe("remembered rail state", () => {
  it("reads a stored width and clamps it", () => {
    expect(readRailWidth(memory({ "penguin.activityRailWidth": "340" }))).toBe(340);
    expect(readRailWidth(memory({ "penguin.activityRailWidth": "9999" }))).toBe(RAIL_MAX_WIDTH);
    expect(readRailWidth(memory())).toBe(RAIL_DEFAULT_WIDTH);
    expect(readRailWidth(memory({ "penguin.activityRailWidth": "wide" }))).toBe(RAIL_DEFAULT_WIDTH);
  });

  it("collapses only on an explicit record", () => {
    expect(readRailCollapsed(memory({ "penguin.activityRailCollapsed": "collapsed" }))).toBe(true);
    expect(readRailCollapsed(memory({ "penguin.activityRailCollapsed": "open" }))).toBe(false);
    expect(readRailCollapsed(memory())).toBe(false);
  });

  it("writes back what it would read", () => {
    const store = memory();
    writeRailWidth(340, store);
    expect(readRailWidth(store)).toBe(340);
    writeRailCollapsed(true, store);
    expect(readRailCollapsed(store)).toBe(true);
    writeRailCollapsed(false, store);
    expect(readRailCollapsed(store)).toBe(false);
  });

  it("survives storage that throws, as a private window's does", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readRailWidth(hostile)).toBe(RAIL_DEFAULT_WIDTH);
    expect(readRailCollapsed(hostile)).toBe(false);
    expect(() => writeRailWidth(300, hostile)).not.toThrow();
    expect(() => writeRailCollapsed(true, hostile)).not.toThrow();
  });
});
