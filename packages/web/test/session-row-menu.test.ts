/**
 * A Session row's two action surfaces (components/ui/session-row-menu.tsx): the hover buttons
 * and the right-click menu, and how each action labels itself.
 *
 * - A row's menu carries pin, rename, messaging, archive, copy and delete, so every Session in
 *   the sidebar stays renamable, archivable and deletable.
 * - Every hover action is also in the menu, so nothing is reachable by hover alone.
 * - Every action has a label and a glyph of its own, and only delete is destructive.
 * - Pin flips its label on a pinned row and keeps its glyph.
 * - In English no action falls back to a Chinese label (the hover buttons are icon-only, so
 *   the label is their accessible name).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_MENU_ACTIONS,
  HOVER_ROW_ACTIONS,
  sessionRowMenuItem,
  type SessionRowAction,
} from "../src/components/ui/session-row-menu";

import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Every test that switches locale puts the default (zh) back. */
afterEach(() => setActiveStrings(zh));

const RESTING = { pinned: false };
const ALL: SessionRowAction[] = ["pin", "rename", "messaging", "archive", "copy", "delete"];

describe("the context menu", () => {
  it("carries the whole set", () => {
    expect([...CONTEXT_MENU_ACTIONS]).toEqual(ALL);
  });

  it("is a superset of the hover actions, so nothing is reachable by hover alone", () => {
    for (const action of HOVER_ROW_ACTIONS) expect(CONTEXT_MENU_ACTIONS).toContain(action);
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

  it("flips pin's label on a pinned row, keeping the one pin glyph", () => {
    const pin = sessionRowMenuItem("pin", RESTING);
    const unpin = sessionRowMenuItem("pin", { pinned: true });
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
