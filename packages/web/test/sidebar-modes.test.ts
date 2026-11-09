/**
 * The sidebar's contributions as the frame reads them (web-app/sidebar/modes.ts).
 *
 * - Sections come back in `order`, and a mode's sections at one place are only that mode's at
 *   that place.
 * - The current mode is the first contributed one that is available and current; with none,
 *   the frame stands in the default mode, "dev". An unavailable mode is never current.
 * - An anchor's marks are the contributions to it that carry one, in order.
 * - The composed notes keep each anchor's first note and skip a null one.
 */
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import { describe, expect, it } from "vitest";
import {
  badgesOf,
  composeNotes,
  currentModeIndex,
  currentModeKey,
  marksFor,
  modesOf,
  sectionsIn,
  sectionsOf,
} from "../src/web-app/sidebar/modes";
import type { ModeState, SidebarMode } from "../src/lib/sidebar-contributions";

const contributed = (id: string, data: Record<string, unknown>, code: unknown): Contributed =>
  ({ id, from: "Test", data, code }) as unknown as Contributed;

const Full = () => null;

const state = (available: boolean, current: boolean): ModeState => ({
  available,
  current,
  select: () => null,
  navItems: [],
});

describe("sections", () => {
  const sections = sectionsOf([
    contributed("b", { mode: "dev", place: "body", order: 30 }, { Full }),
    contributed("h", { mode: "dev", place: "header", order: 10 }, { Full }),
    contributed("c1", { mode: "company", place: "body", order: 20 }, { Full }),
    contributed("a", { mode: "dev", place: "body", order: 5 }, { Full }),
  ]);

  it("come back in order", () => {
    expect(sections.map((s) => s.id)).toEqual(["a", "h", "c1", "b"]);
  });

  it("are picked by mode and place", () => {
    expect(sectionsIn(sections, "dev", "body").map((s) => s.id)).toEqual(["a", "b"]);
    expect(sectionsIn(sections, "dev", "header").map((s) => s.id)).toEqual(["h"]);
    expect(sectionsIn(sections, "company", "body").map((s) => s.id)).toEqual(["c1"]);
    expect(sectionsIn(sections, "company", "header")).toEqual([]);
  });
});

describe("the current mode", () => {
  const mode = {} as SidebarMode;
  const modes = modesOf([
    contributed("m2", { key: "two", title: "", titleZh: "", icon: "", order: 20 }, mode),
    contributed("m1", { key: "one", title: "", titleZh: "", icon: "", order: 10 }, mode),
  ]);

  it("is the default with no contributed mode current", () => {
    expect(currentModeIndex([state(true, false), state(true, false)])).toBe(-1);
    expect(currentModeKey(modes, [state(true, false), state(true, false)])).toBe("dev");
  });

  it("is the first available mode that says it is current", () => {
    expect(modes.map((m) => m.key)).toEqual(["one", "two"]);
    expect(currentModeKey(modes, [state(true, false), state(true, true)])).toBe("two");
    expect(currentModeKey(modes, [state(true, true), state(true, true)])).toBe("one");
  });

  it("is never an unavailable mode", () => {
    expect(currentModeKey(modes, [state(false, true), state(true, false)])).toBe("dev");
  });
});

describe("nav badges", () => {
  const Mark = () => null;
  const badges = badgesOf([
    contributed("note", { anchor: "account", order: 10 }, { useNote: () => "update" }),
    contributed("mark", { anchor: "account", order: 20 }, { Mark }),
    contributed("quiet", { anchor: "agents", order: 5 }, { useNote: () => null }),
    contributed("later", { anchor: "account", order: 30 }, { useNote: () => "other" }),
  ]);

  it("an anchor's marks are the contributions to it that carry one", () => {
    expect(marksFor(badges, "account")).toEqual([{ id: "mark", Mark }]);
    expect(marksFor(badges, "agents")).toEqual([]);
  });

  it("the notes keep each anchor's first note and skip a null one", () => {
    const notes = composeNotes(badges)();
    expect([...notes]).toEqual([["account", "update"]]);
  });
});
