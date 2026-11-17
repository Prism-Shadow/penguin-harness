/**
 * The edit menu an app window opens on right-click (the guests' menu carries the same group and
 * is covered with the browser's rules).
 *
 * - Given a click on neither a field nor a selection, or on a selection of whitespace only, then
 *   nothing is offered, so the window opens no menu.
 * - Given a field that allows every edit command, when each entry is clicked, then it runs its
 *   own command, and only that one, on the contents the menu opened over.
 */
import { describe, expect, it } from "vitest";
import { editMenuItems, runEditAction } from "../src/edit-menu.js";
import type { EditMenuInput, EditTarget } from "../src/edit-menu.js";

const allowAll = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

describe("the app windows' edit menu", () => {
  it("offers nothing off a field and off a selection", () => {
    const plain: EditMenuInput = {
      locale: "en",
      isEditable: false,
      selectionText: "",
      editFlags: allowAll,
    };
    expect(editMenuItems(plain)).toEqual([]);
    expect(editMenuItems({ ...plain, selectionText: " \n\t" })).toEqual([]);
  });

  it("runs each entry's own command on the contents it opened over", () => {
    const ran: string[] = [];
    const contents: EditTarget = {
      cut: () => ran.push("cut"),
      copy: () => ran.push("copy"),
      paste: () => ran.push("paste"),
      selectAll: () => ran.push("selectAll"),
    };
    const items = editMenuItems({
      locale: "en",
      isEditable: true,
      selectionText: "",
      editFlags: allowAll,
    });
    for (const item of items) runEditAction(contents, item.action);
    expect(ran).toEqual(["cut", "copy", "paste", "selectAll"]);
  });
});
