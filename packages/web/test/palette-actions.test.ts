/**
 * How a mounted page adds actions to the one command palette (src/lib/palette-actions.ts):
 * registered actions are listed newest registration first, an unregistered list leaves, the
 * same list registered twice unregisters each time on its own, and the snapshot only changes
 * when the registrations do (the palette reads it through useSyncExternalStore).
 */
import type { PaletteAction } from "@prismshadow/penguin-ui";
import { describe, expect, it } from "vitest";
import { addedPaletteActions, addPaletteActions } from "../src/lib/palette-actions";

const action = (id: string): PaletteAction => ({ id, label: id, run: () => undefined });

describe("addPaletteActions", () => {
  it("lists the newest registration first, and drops a list once it is unregistered", () => {
    expect(addedPaletteActions()).toEqual([]);
    const exit = [action("exit-full-page")];
    const more = [action("one"), action("two")];
    const offExit = addPaletteActions(exit);
    const offMore = addPaletteActions(more);
    expect(addedPaletteActions().map((a) => a.id)).toEqual(["one", "two", "exit-full-page"]);
    offMore();
    expect(addedPaletteActions().map((a) => a.id)).toEqual(["exit-full-page"]);
    offExit();
    expect(addedPaletteActions()).toEqual([]);
  });

  it("unregisters the same list registered twice one registration at a time", () => {
    const exit = [action("exit-full-page")];
    const first = addPaletteActions(exit);
    const second = addPaletteActions(exit);
    expect(addedPaletteActions()).toHaveLength(2);
    first();
    first(); // idempotent
    expect(addedPaletteActions().map((a) => a.id)).toEqual(["exit-full-page"]);
    second();
    expect(addedPaletteActions()).toEqual([]);
  });

  it("keeps the snapshot while nothing changes", () => {
    const off = addPaletteActions([action("a")]);
    const snapshot = addedPaletteActions();
    expect(addedPaletteActions()).toBe(snapshot);
    off();
    expect(addedPaletteActions()).not.toBe(snapshot);
  });
});
