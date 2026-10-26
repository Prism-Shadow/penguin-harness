/**
 * A Session row's two action surfaces (components/ui/session-row-menu.tsx): the hover buttons
 * and the right-click menu, and how each action labels itself.
 *
 * - A row's menu carries pin, rename, messaging, archive, copy and delete, so every Session in
 *   the sidebar stays renamable, archivable and deletable.
 * - A company desk row's menu carries copy, model and messaging: which Session this is, what
 *   runs it, and what it is bound to. Model is the desk menu's alone — a development
 *   Session's model is switched from inside the conversation.
 * - Every hover action is also in the menu, so nothing is reachable by hover alone.
 * - Every action has a label and a glyph of its own, and only delete is destructive.
 * - Pin flips its label on a pinned row and keeps its glyph.
 * - In English no action falls back to a Chinese label (the hover buttons are icon-only, so
 *   the label is their accessible name).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_MENU_ACTIONS,
  DESK_ROW_ACTIONS,
  HOVER_ROW_ACTIONS,
  sessionRowMenuItem,
} from "../src/components/ui/session-row-menu";
import type { SessionRowAction } from "../src/components/ui/session-row-menu";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Every test that switches locale puts the default (zh) back. */
afterEach(() => setActiveStrings(zh));

const RESTING = { pinned: false };
const ALL: SessionRowAction[] = ["pin", "rename", "messaging", "archive", "copy", "delete"];
/** The desk menu's own action, on top of the development menu's set. */
const EVERY: SessionRowAction[] = [...ALL, "model"];

describe("the context menu", () => {
  it("carries the whole set", () => {
    expect([...CONTEXT_MENU_ACTIONS]).toEqual(ALL);
  });

  it("is a superset of the hover actions, so nothing is reachable by hover alone", () => {
    for (const action of HOVER_ROW_ACTIONS) expect(CONTEXT_MENU_ACTIONS).toContain(action);
  });
});

describe("the desk menu", () => {
  it("carries copy, model and messaging, and model stays out of the development menu", () => {
    expect([...DESK_ROW_ACTIONS]).toEqual(["copy", "model", "messaging"]);
    expect(CONTEXT_MENU_ACTIONS).not.toContain("model");
  });
});

describe("sessionRowMenuItem", () => {
  it("gives every action a label, a glyph, and only delete the destructive treatment", () => {
    for (const action of EVERY) {
      const item = sessionRowMenuItem(action, RESTING);
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.danger).toBe(action === "delete");
    }
  });

  it("gives the actions distinct labels and glyphs, so a row is not read by its label alone", () => {
    const items = EVERY.map((action) => sessionRowMenuItem(action, RESTING));
    expect(new Set(items.map((item) => item.icon)).size).toBe(EVERY.length);
    expect(new Set(items.map((item) => item.label)).size).toBe(EVERY.length);
  });

  it("flips pin's label on a pinned row, keeping the one pin glyph", () => {
    const pin = sessionRowMenuItem("pin", RESTING);
    const unpin = sessionRowMenuItem("pin", { pinned: true });
    expect(unpin.label).not.toBe(pin.label);
    expect(unpin.icon).toBe(pin.icon);
  });

  it("names every action in English once the locale is English", () => {
    setActiveStrings(en);
    const zhLabels = new Set([
      ...Object.values(zh.chat),
      ...Object.values(zh.messaging),
      ...Object.values(zh.company.sessionList),
    ]);
    for (const action of EVERY) {
      expect(zhLabels.has(sessionRowMenuItem(action, RESTING).label)).toBe(false);
    }
  });
});
