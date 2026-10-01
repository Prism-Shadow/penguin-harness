/**
 * The draft screen's user-defined shortcuts (features/chat/user-shortcuts.ts).
 *
 * - A stored list reads back unchanged; anything else reads as no shortcuts, entries that
 *   cannot be a row are dropped, fields are trimmed and over-long ones truncated, duplicate ids
 *   dropped, and the list stops at the count cap.
 * - The editor refuses a missing title or prompt (whitespace is not content) and either field
 *   over its cap.
 * - Saving appends a new shortcut with an id of its own (distinct every time), edits in place,
 *   trims, re-appends a draft whose shortcut was deleted elsewhere, and never grows past the
 *   cap; removing closes the gap and ignores unknown ids.
 * - The suggested title is the first non-empty line, one line, capped; nothing for an empty
 *   composer.
 * - The user folder's tallest state stays within one row of the tallest built-in folder, so the
 *   examples block does not move as folders are switched.
 * - The caps match the server's copy, which enforces them (read from the server module's
 *   source: the server package is a type-only dependency of the Web App).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXAMPLE_FOLDERS } from "../src/features/chat/example-tasks";
import {
  SHORTCUT_MAX_COUNT,
  SHORTCUT_PROMPT_MAX,
  SHORTCUT_TITLE_MAX,
  canAddShortcut,
  defaultShortcutTitle,
  newShortcutId,
  normalizeShortcuts,
  removeShortcut,
  shortcutDraftError,
  upsertShortcut,
} from "../src/features/chat/user-shortcuts";
import type { UserShortcut } from "../src/features/chat/user-shortcuts";

const shortcut = (id: string, title = `title ${id}`, prompt = `prompt ${id}`): UserShortcut => ({
  id,
  title,
  prompt,
});

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("normalizeShortcuts — reading the list back out of free-form JSON", () => {
  it("reads a stored list through unchanged", () => {
    const stored = [shortcut("a"), shortcut("b")];
    expect(normalizeShortcuts(stored)).toEqual(stored);
  });

  it("treats anything that is not an array as no shortcuts", () => {
    // ui_prefs is one shared JSON column: a key that was never written, or written by an older
    // client, must render as an empty folder rather than throw on the draft screen.
    for (const value of [undefined, null, {}, "", 3, true]) {
      expect(normalizeShortcuts(value)).toEqual([]);
    }
  });

  it("drops entries that cannot be rendered as a row", () => {
    const list = normalizeShortcuts([
      null,
      "a string",
      ["an array"],
      { id: "a", title: "kept", prompt: "body" },
      { id: "", title: "no id", prompt: "body" },
      { id: "b", title: "   ", prompt: "body" },
      { id: "c", title: "no prompt", prompt: "" },
      { id: "d", title: "wrong type", prompt: 42 },
    ]);
    expect(list.map((s) => s.id)).toEqual(["a"]);
  });

  it("trims whitespace and drops a duplicate id", () => {
    // The id is what an edit and a delete address, so a second row wearing it would make both
    // act on the wrong one.
    const list = normalizeShortcuts([
      { id: " a ", title: "  first  ", prompt: "  body  " },
      { id: "a", title: "second", prompt: "body" },
    ]);
    expect(list).toEqual([{ id: "a", title: "first", prompt: "body" }]);
  });

  it("truncates an over-long field instead of dropping the shortcut", () => {
    // A shortened prompt is recoverable; a vanished one is the user's own text, gone.
    const list = normalizeShortcuts([
      {
        id: "a",
        title: "T".repeat(SHORTCUT_TITLE_MAX + 20),
        prompt: "P".repeat(SHORTCUT_PROMPT_MAX + 20),
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toHaveLength(SHORTCUT_TITLE_MAX);
    expect(list[0]!.prompt).toHaveLength(SHORTCUT_PROMPT_MAX);
  });

  it("stops at the count cap", () => {
    const stored = Array.from({ length: SHORTCUT_MAX_COUNT + 5 }, (_, i) => shortcut(`id-${i}`));
    expect(normalizeShortcuts(stored)).toHaveLength(SHORTCUT_MAX_COUNT);
  });
});

describe("shortcutDraftError — what the editor refuses to save", () => {
  it("accepts a title and a prompt", () => {
    expect(
      shortcutDraftError({ title: "Weekly report", prompt: "Summarize the week." }),
    ).toBeNull();
  });

  it("requires both fields, whitespace not counting as content", () => {
    expect(shortcutDraftError({ title: "", prompt: "body" })).toBe("titleRequired");
    expect(shortcutDraftError({ title: "   \n ", prompt: "body" })).toBe("titleRequired");
    expect(shortcutDraftError({ title: "name", prompt: "" })).toBe("promptRequired");
    expect(shortcutDraftError({ title: "name", prompt: " \t " })).toBe("promptRequired");
  });

  it("enforces both length caps on the trimmed value", () => {
    expect(shortcutDraftError({ title: "T".repeat(SHORTCUT_TITLE_MAX), prompt: "p" })).toBeNull();
    expect(shortcutDraftError({ title: "T".repeat(SHORTCUT_TITLE_MAX + 1), prompt: "p" })).toBe(
      "titleTooLong",
    );
    expect(shortcutDraftError({ title: "t", prompt: "P".repeat(SHORTCUT_PROMPT_MAX) })).toBeNull();
    expect(
      shortcutDraftError({ title: "t", prompt: `  ${"P".repeat(SHORTCUT_PROMPT_MAX + 1)}  ` }),
    ).toBe("promptTooLong");
  });
});

describe("the list operations — order is insertion order", () => {
  it("appends a new shortcut at the end and gives it an id", () => {
    const list = [shortcut("a"), shortcut("b")];
    const next = upsertShortcut(list, { id: null, title: "third", prompt: "body" });
    expect(next.map((s) => s.title)).toEqual(["title a", "title b", "third"]);
    expect(next[2]!.id).not.toBe("");
    expect(list).toHaveLength(2); // the input list is not mutated
  });

  it("keeps an edited shortcut where it was", () => {
    // Saving a title fix must not move the row out from under the cursor about to click it.
    const list = [shortcut("a"), shortcut("b"), shortcut("c")];
    const next = upsertShortcut(list, { id: "b", title: "renamed", prompt: "new body" });
    expect(next.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(next[1]).toEqual({ id: "b", title: "renamed", prompt: "new body" });
  });

  it("trims what it saves", () => {
    const next = upsertShortcut([], { id: null, title: "  name  ", prompt: "  body  " });
    expect(next[0]).toMatchObject({ title: "name", prompt: "body" });
  });

  it("appends a draft whose shortcut was deleted elsewhere rather than losing it", () => {
    const next = upsertShortcut([shortcut("a")], { id: "gone", title: "typed", prompt: "body" });
    expect(next.map((s) => s.id)).toEqual(["a", "gone"]);
  });

  it("refuses to grow past the cap, but still edits in place at the cap", () => {
    const full = Array.from({ length: SHORTCUT_MAX_COUNT }, (_, i) => shortcut(`id-${i}`));
    expect(canAddShortcut(full)).toBe(false);
    expect(canAddShortcut(full.slice(1))).toBe(true);
    expect(upsertShortcut(full, { id: null, title: "one more", prompt: "body" })).toHaveLength(
      SHORTCUT_MAX_COUNT,
    );
    const edited = upsertShortcut(full, { id: "id-0", title: "renamed", prompt: "body" });
    expect(edited).toHaveLength(SHORTCUT_MAX_COUNT);
    expect(edited[0]!.title).toBe("renamed");
  });

  it("removes by id, closing the gap, and ignores an id it does not hold", () => {
    const list = [shortcut("a"), shortcut("b"), shortcut("c")];
    expect(removeShortcut(list, "b").map((s) => s.id)).toEqual(["a", "c"]);
    expect(removeShortcut(list, "zzz")).toEqual(list);
  });

  it("mints distinct ids", () => {
    expect(newShortcutId()).not.toBe(newShortcutId());
  });
});

describe("defaultShortcutTitle — the name suggested when saving what was typed", () => {
  it("takes the first line that has anything on it", () => {
    expect(defaultShortcutTitle("\n\n  Build a landing page  \nsecond line")).toBe(
      "Build a landing page",
    );
  });

  it("collapses whitespace runs so a wrapped heading stays one line", () => {
    expect(defaultShortcutTitle("Build\ta   landing page")).toBe("Build a landing page");
  });

  it("cuts to the title cap", () => {
    expect(defaultShortcutTitle("T".repeat(200))).toHaveLength(SHORTCUT_TITLE_MAX);
  });

  it("suggests nothing for an empty composer", () => {
    expect(defaultShortcutTitle("")).toBe("");
    expect(defaultShortcutTitle("   \n  ")).toBe("");
  });
});

describe("the examples block keeps its height", () => {
  it("keeps the user folder within one row of the built-in ones", () => {
    // Its tallest state is either the cap with no add row, or one below the cap plus the add
    // row — both SHORTCUT_MAX_COUNT rows. The cap is what holds this, not a pinned height with
    // a scrollbar inside it.
    const tallestBuiltIn = Math.max(...EXAMPLE_FOLDERS.map((f) => f.tasks.length));
    const tallestUser = Math.max(SHORTCUT_MAX_COUNT, SHORTCUT_MAX_COUNT - 1 + 1);
    expect(tallestUser - tallestBuiltIn).toBeLessThanOrEqual(1);
  });
});

describe("the caps the server enforces", () => {
  it("matches the Web App's copy of them", () => {
    // Two copies on purpose: the server owns enforcement (ui_prefs is a free-form JSON column),
    // this package owns the counters, and penguin-server is a type-only dependency here.
    const source = read("../../server/src/services/draft-shortcuts.ts");
    const capOf = (name: string): number => {
      const m = new RegExp(`export const ${name} = (\\d+);`).exec(source);
      expect(m, `${name} in the server module`).not.toBeNull();
      return Number(m?.[1]);
    };
    expect(capOf("DRAFT_SHORTCUT_MAX_COUNT")).toBe(SHORTCUT_MAX_COUNT);
    expect(capOf("DRAFT_SHORTCUT_TITLE_MAX")).toBe(SHORTCUT_TITLE_MAX);
    expect(capOf("DRAFT_SHORTCUT_PROMPT_MAX")).toBe(SHORTCUT_PROMPT_MAX);
  });
});
