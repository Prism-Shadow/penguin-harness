/**
 * session-row-menu.tsx unit tests: which actions each of a Session row's two surfaces
 * offers, and how each one labels itself.
 *
 * The split is the point of the change and the thing most likely to be undone by
 * accident, so it is pinned by value rather than by shape: **hover gives archive and
 * delete and nothing else** — the affordance every release up to v0.2.2 shipped — while
 * the right-click menu carries the full set. Rename in particular must stay in the
 * context menu: `design/specs/06-PROTOTYPE.md` requires every Session to support
 * 重命名、归档与删除, and the pared-back hover pair alone would not satisfy that.
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
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Every test that switches locale puts the default (zh) back. */
afterEach(() => setActiveStrings(zh));

const RESTING = { archived: false, pinned: false };

describe("HOVER_ROW_ACTIONS", () => {
  it("is the released archive + delete pair, in that order, and nothing more", () => {
    expect([...HOVER_ROW_ACTIONS]).toEqual(["archive", "delete"]);
  });

  it("does not carry rename or pin — those moved to the context menu", () => {
    expect(HOVER_ROW_ACTIONS as readonly string[]).not.toContain("rename");
    expect(HOVER_ROW_ACTIONS as readonly string[]).not.toContain("pin");
  });
});

describe("contextMenuActions", () => {
  it("carries the whole set when the row can be pinned", () => {
    expect([...contextMenuActions(true)]).toEqual(["pin", "rename", "archive", "delete"]);
  });

  it("drops only pin on rows where pinning cannot reorder anything (folder rows)", () => {
    expect([...contextMenuActions(false)]).toEqual(["rename", "archive", "delete"]);
  });

  it("is a superset of the hover pair, so nothing is reachable by hover alone", () => {
    for (const canPin of [true, false]) {
      for (const action of HOVER_ROW_ACTIONS) {
        expect(contextMenuActions(canPin)).toContain(action);
      }
    }
  });

  it("keeps rename reachable in every state (design/specs/06-PROTOTYPE.md: 重命名、归档与删除)", () => {
    expect(contextMenuActions(true)).toContain("rename");
    expect(contextMenuActions(false)).toContain("rename");
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
    // Both reveal paths must re-arm the click, or the buttons would be visible and dead.
    expect(source).toContain("group-hover:pointer-events-auto");
    expect(source).toContain("focus-visible:pointer-events-auto");
    expect(source).toContain("group-hover:opacity-100");
    expect(source).toContain("focus-visible:opacity-100");
  });
});

describe("sessionRowMenuItem", () => {
  it("gives every action a label, a glyph, and only delete the destructive treatment", () => {
    const all: SessionRowAction[] = ["pin", "rename", "archive", "delete"];
    for (const action of all) {
      const item = sessionRowMenuItem(action, RESTING);
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.danger).toBe(action === "delete");
    }
  });

  it("gives the actions distinct glyphs, so a row is not read by its label alone", () => {
    const icons = (["pin", "rename", "archive", "delete"] as SessionRowAction[]).map(
      (a) => sessionRowMenuItem(a, RESTING).icon,
    );
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).toEqual([PIN_ICON, PENCIL_ICON, ARCHIVE_ICON, TRASH_ICON]);
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
    // The hover buttons are icon-only: their label IS their accessible name, so an
    // untranslated one would leave a nameless button on the row.
    for (const action of HOVER_ROW_ACTIONS) {
      expect(sessionRowMenuItem(action, RESTING).label).toBeTruthy();
      setActiveStrings(zh);
      expect(sessionRowMenuItem(action, RESTING).label).toBeTruthy();
      setActiveStrings(en);
    }
  });
});
