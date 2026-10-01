/**
 * A Session row's two action surfaces (components/ui/session-row-menu.tsx): the hover buttons
 * and the right-click menu, and how each action labels itself.
 *
 * - A pinnable row's menu carries pin, rename, messaging, archive, copy and delete; a folder
 *   row's menu drops only pin, so every Session stays renamable, archivable and deletable.
 * - Every hover action is also in the menu, so nothing is reachable by hover alone.
 * - Every action has a label and a glyph of its own, and only delete is destructive.
 * - Archive flips its label and glyph on an archived row; pin flips its label on a pinned row
 *   and keeps its glyph.
 * - In English no action falls back to a Chinese label (the hover buttons are icon-only, so
 *   the label is their accessible name).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  HOVER_ROW_ACTIONS,
  contextMenuActions,
  sessionRowMenuItem,
} from "../src/components/ui/session-row-menu";
import type { SessionRowAction } from "../src/components/ui/session-row-menu";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Every test that switches locale puts the default (zh) back. */
afterEach(() => setActiveStrings(zh));

const RESTING = { archived: false, pinned: false };
const ALL: SessionRowAction[] = ["pin", "rename", "messaging", "archive", "copy", "delete"];

describe("contextMenuActions", () => {
  it("a pinnable row's menu carries the whole set; a folder row's drops only pin", () => {
    expect([...contextMenuActions(true)]).toEqual(ALL);
    expect([...contextMenuActions(false)]).toEqual(ALL.filter((action) => action !== "pin"));
  });

  it("is a superset of the hover actions, so nothing is reachable by hover alone", () => {
    for (const canPin of [true, false]) {
      for (const action of HOVER_ROW_ACTIONS) {
        expect(contextMenuActions(canPin)).toContain(action);
      }
    }
  });
});

describe("sessionRowMenuItem", () => {
  it("gives every action a label, a glyph, and only delete the destructive treatment", () => {
    for (const action of ALL) {
      const item = sessionRowMenuItem(action, RESTING);
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.danger).toBe(action === "delete");
    }
  });

  it("gives the actions distinct labels and glyphs, so a row is not read by its label alone", () => {
    const items = ALL.map((action) => sessionRowMenuItem(action, RESTING));
    expect(new Set(items.map((item) => item.icon)).size).toBe(ALL.length);
    expect(new Set(items.map((item) => item.label)).size).toBe(ALL.length);
  });

  it("flips archive's label and glyph on an archived row", () => {
    const archive = sessionRowMenuItem("archive", RESTING);
    const restore = sessionRowMenuItem("archive", { archived: true, pinned: false });
    expect(restore.label).not.toBe(archive.label);
    expect(restore.icon).not.toBe(archive.icon);
  });

  it("flips pin's label on a pinned row, keeping the one pin glyph", () => {
    const pin = sessionRowMenuItem("pin", RESTING);
    const unpin = sessionRowMenuItem("pin", { archived: false, pinned: true });
    expect(unpin.label).not.toBe(pin.label);
    expect(unpin.icon).toBe(pin.icon);
  });

  it("names every action in English once the locale is English", () => {
    setActiveStrings(en);
    const zhLabels = new Set([...Object.values(zh.chat), ...Object.values(zh.messaging)]);
    for (const action of ALL) {
      expect(zhLabels.has(sessionRowMenuItem(action, RESTING).label)).toBe(false);
    }
  });
});
