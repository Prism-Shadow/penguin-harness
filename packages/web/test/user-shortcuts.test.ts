/**
 * The draft screen's user-defined shortcuts: the rules the editor enforces, the shape that comes
 * back out of free-form storage, and the two invariants the feature had to keep.
 *
 * Three groups worth naming.
 *
 * - **The caps are duplicated across packages on purpose** — the Web App's copy drives the
 *   counters, the server's copy is the enforcement — so the parity check reads the server module
 *   as text rather than importing it: `@prismshadow/penguin-server` is a type-only dependency
 *   here, and making it a runtime one to check three numbers would be a worse trade than a regex.
 * - **The examples block's height must not move** when folders are switched. The built-in folders
 *   keep that by staying within a row of each other; the user's folder cannot, so it is pinned to
 *   the tallest built-in folder's height and scrolls. Both halves are asserted.
 * - **A click on a shortcut is a fill, not a send**, and it pins no Skills — checked through
 *   buildExampleFill and against the real handler in draft-view.tsx, the way
 *   test/example-fill.test.ts checks the built-in rows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildExampleFill } from "../src/features/chat/example-fill";
import { EXAMPLE_FOLDERS, EXAMPLE_FOLDER_ROWS } from "../src/features/chat/example-tasks";
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
  shortcutListHeightRem,
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
  it("keeps the built-in folders within one row of each other", () => {
    // The draft page reserves no scroll area for this block, so a folder much longer than its
    // siblings is what makes the height jump as folders are switched.
    const lengths = EXAMPLE_FOLDERS.map((folder) => folder.tasks.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1);
  });

  it("derives the pinned height from the registry rather than a literal", () => {
    expect(EXAMPLE_FOLDER_ROWS).toBe(Math.max(...EXAMPLE_FOLDERS.map((f) => f.tasks.length)));
  });

  it("measures a row box the way the rows are actually built", () => {
    // One row: a 1.25rem line box inside 0.375rem of padding top and bottom; rows are separated
    // by 0.125rem. rem, not px, so an enlarged root font size does not clip the last row.
    expect(shortcutListHeightRem(1)).toBeCloseTo(2);
    expect(shortcutListHeightRem(3)).toBeCloseTo(6.25);
    expect(shortcutListHeightRem(5)).toBeCloseTo(10.5);
    // A zero-row registry would otherwise collapse the folder to nothing.
    expect(shortcutListHeightRem(0)).toBeCloseTo(2);
  });

  it("pins the user folder to that height and lets it scroll inside it", () => {
    const source = read("../src/features/chat/shortcuts-folder.tsx");
    expect(source).toContain("shortcutListHeightRem(rows)");
    expect(source).toContain("overflow-y-auto");
    expect(source).toContain("style={{ height: bodyHeight }}");
  });
});

describe("clicking a shortcut", () => {
  it("hands the composer the saved prompt and leaves the Skill selection alone", () => {
    // A saved prompt is not authored against the shipped Skill catalog, so it pins nothing —
    // and an empty pin list is exactly what leaves a selection the user made by hand intact.
    const fill = buildExampleFill({
      prompt: "Summarize the week.",
      exampleSkills: [],
      installedSkills: ["web-design", "memory"],
      selectedSkills: ["memory"],
    });
    expect(fill.text).toBe("Summarize the week.");
    expect(fill.skills).toEqual(["memory"]);
  });

  it("routes the click through the composer handle and never sends", () => {
    const source = read("../src/features/chat/draft-view.tsx");
    const handler = /const fillShortcut = useCallback\(([\s\S]*?)\n  \}, \[\]\);/.exec(source);
    expect(handler, "the fillShortcut handler").not.toBeNull();
    expect(handler?.[1]).toContain("composerRef.current?.fillExample(prompt, [])");
    expect(handler?.[1]).not.toContain("onSend");
    expect(handler?.[1]).not.toContain("api.");
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
