/**
 * session-row-menu.tsx unit tests: which actions each of a Session row's two surfaces
 * offers, and how each one labels itself.
 *
 * The split is the point and the thing most likely to be undone by accident, so it is
 * pinned by value rather than by shape: **hover gives archive plus the ellipsis "more"
 * button and nothing else** — the ellipsis opens the context menu anchored at itself, so
 * every menu action (delete and the messaging binding included) is one visible click
 * away — while the right-click menu carries the full set. Rename in particular must stay
 * in the context menu: every Session must remain renamable, archivable and deletable, and
 * the pared-back hover affordance alone would not satisfy that.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so these assert against
 * the exported manifests and label helpers rather than a rendered DOM
 * (title-reveal.test.ts convention).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_ICON,
  HOVER_ROW_ACTIONS,
  PENCIL_ICON,
  PIN_ICON,
  TRASH_ICON,
  UNARCHIVE_ICON,
  contextMenuActions,
  sessionRowMenuItem,
} from "../src/components/ui/session-row-menu";
import type { SessionRowAction } from "../src/components/ui/session-row-menu";
import { MESSAGING_RELAY_ICON } from "../src/components/ui/icons";
import { STAT_ICONS } from "../src/lib/stat-icons";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Every test that switches locale puts the default (zh) back. */
afterEach(() => setActiveStrings(zh));

const RESTING = { archived: false, pinned: false };

describe("HOVER_ROW_ACTIONS", () => {
  it("is archive alone — the ellipsis beside it is the menu's pointer entry, not an action", () => {
    expect([...HOVER_ROW_ACTIONS]).toEqual(["archive"]);
  });

  it("does not carry rename, pin, delete or the messaging binding — those live in the menu", () => {
    for (const action of ["rename", "pin", "delete", "messaging", "copy"]) {
      expect(HOVER_ROW_ACTIONS as readonly string[]).not.toContain(action);
    }
  });
});

describe("contextMenuActions", () => {
  it("carries the whole set when the row can be pinned", () => {
    expect([...contextMenuActions(true)]).toEqual([
      "pin",
      "rename",
      "copy",
      "messaging",
      "archive",
      "delete",
    ]);
  });

  it("drops only pin on rows where pinning cannot reorder anything (folder rows)", () => {
    expect([...contextMenuActions(false)]).toEqual([
      "rename",
      "copy",
      "messaging",
      "archive",
      "delete",
    ]);
  });

  it("is a superset of the hover actions, so nothing is reachable by hover alone", () => {
    for (const canPin of [true, false]) {
      for (const action of HOVER_ROW_ACTIONS) {
        expect(contextMenuActions(canPin)).toContain(action);
      }
    }
  });

  it("keeps rename reachable in every state", () => {
    expect(contextMenuActions(true)).toContain("rename");
    expect(contextMenuActions(false)).toContain("rename");
  });

  it("offers the id copy on every row, including the folder rows that cannot pin", () => {
    // The id is what a person carries out of the app — into the CLI, a bug report, a
    // trace lookup — and an archived or scheduled Session is exactly when it is wanted.
    expect(contextMenuActions(true)).toContain("copy");
    expect(contextMenuActions(false)).toContain("copy");
  });
});

describe("the hover buttons' CSS contract", () => {
  // Node-only suite, so this is asserted against the source text (title-reveal.test.ts
  // convention). It is worth pinning: an invisible button still takes taps, and these are
  // invisible for the whole of every touch session, delete included.
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/components/ui/session-row-menu.tsx"),
    "utf8",
  );

  it("gates pointer events on the same conditions as visibility, leaving no phantom tap target", () => {
    expect(source).toContain("pointer-events-none");
    // Both reveal paths must re-arm the click, or the buttons would be visible and dead —
    // and each reveal must pair with its own pointer-events grant, since either half alone
    // yields a button that is visible-but-dead or invisible-but-tappable.
    for (const on of ["group-hover", "focus"]) {
      expect(source).toContain(`${on}:pointer-events-auto`);
      expect(source).toContain(`${on}:opacity-100`);
    }
    // `focus`, not `focus-visible`: the time span it swaps with hides on plain
    // focus-within, and the two conditions have to agree or the slot goes blank.
    expect(source).not.toContain("focus-visible:opacity-100");
  });

  it("renders the ellipsis as a labelled menu trigger anchored at its own box", () => {
    // The menu's discoverable pointer entry: a real button that reports it opens a menu
    // and anchors the panel at its own rect (not the pointer position).
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain("ELLIPSIS_ICON");
    expect(source).toContain("getBoundingClientRect");
  });
});

describe("sessionRowMenuItem", () => {
  it("gives every action a label, a glyph, and only delete the destructive treatment", () => {
    const all: SessionRowAction[] = ["pin", "rename", "copy", "messaging", "archive", "delete"];
    for (const action of all) {
      const item = sessionRowMenuItem(action, RESTING);
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.danger).toBe(action === "delete");
    }
  });

  it("gives the actions distinct glyphs, so a row is not read by its label alone", () => {
    const icons = (
      ["pin", "rename", "copy", "messaging", "archive", "delete"] as SessionRowAction[]
    ).map((a) => sessionRowMenuItem(a, RESTING).icon);
    expect(new Set(icons).size).toBe(icons.length);
    // Remote control wears the same paper plane the session row flies while it is relaying:
    // the action and the mark it produces are one feature.
    expect(icons).toEqual([
      PIN_ICON,
      PENCIL_ICON,
      // The same glyph the details card's copy button shows, so one value has one mark.
      STAT_ICONS.copy,
      MESSAGING_RELAY_ICON,
      ARCHIVE_ICON,
      TRASH_ICON,
    ]);
  });

  it("flips archive's label and glyph on an archived row", () => {
    expect(sessionRowMenuItem("archive", { archived: false, pinned: false })).toMatchObject({
      label: zh.chat.archiveSession,
      icon: ARCHIVE_ICON,
    });
    expect(sessionRowMenuItem("archive", { archived: true, pinned: false })).toMatchObject({
      label: zh.chat.unarchiveSession,
      icon: UNARCHIVE_ICON,
    });
  });

  it("flips pin's label on a pinned row, keeping the one pin glyph", () => {
    expect(sessionRowMenuItem("pin", { archived: false, pinned: false }).label).toBe(
      zh.chat.pinSession,
    );
    expect(sessionRowMenuItem("pin", { archived: false, pinned: true }).label).toBe(
      zh.chat.unpinSession,
    );
    expect(sessionRowMenuItem("pin", { archived: false, pinned: true }).icon).toBe(PIN_ICON);
  });

  it("reads the active dictionary, so both locales name every action", () => {
    setActiveStrings(en);
    expect(sessionRowMenuItem("archive", RESTING).label).toBe(en.chat.archiveSession);
    expect(sessionRowMenuItem("delete", RESTING).label).toBe(en.chat.deleteSession);
    expect(sessionRowMenuItem("rename", RESTING).label).toBe(en.chat.renameSession);
    expect(sessionRowMenuItem("copy", RESTING).label).toBe(en.chat.copySessionId);
    expect(sessionRowMenuItem("messaging", RESTING).label).toBe(en.messaging.bindAction);
    // The hover buttons are icon-only, so their label IS their accessible name: an English
    // row must not fall back to the zh catalog and leave a Chinese name on the button.
    for (const action of HOVER_ROW_ACTIONS) {
      const label = sessionRowMenuItem(action, RESTING).label;
      expect(label).toBeTruthy();
      expect(label).not.toBe(sessionRowMenuItem(action, RESTING).icon);
      expect(Object.values(zh.chat)).not.toContain(label);
    }
  });
});
