/**
 * No surface reads modifier keys itself. A shortcut is a chord in the registry, matched by
 * lib/shortcuts/ against the user's keymap with the platform's modifier mapping; a hand-written
 * `event.ctrlKey` check is a binding the settings page cannot see, and one that is wrong on a
 * Mac. This scans the web source for `.ctrlKey` and `.metaKey` reads and allows them only under
 * src/lib/shortcuts/, plus the few files named below. (`shiftKey` and `altKey` are not scanned:
 * fixed interaction keys legitimately read them — Shift+Enter, Shift+F10, Shift-multiplied
 * arrows.)
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_SRC = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED_DIR = "lib/shortcuts";

/**
 * Files that read the modifiers for something other than a chord of their own, and are
 * therefore excused: the Workspace picker's fixed file-browser keys (Finder's ⌘↑ / ⌘[ / ⌘],
 * Explorer's Alt+←) and its type-to-select, the model picker's Alt+digit group jump and its
 * type-to-focus (both "is this a bare key" tests), and the workflow frame's key forwarding,
 * which copies an event to re-raise it on the app's window. None is an app command a user
 * would rebind. A new entry here needs a reason of the same kind.
 */
const EXCUSED_FILES = new Set([
  "features/chat/workspace-finder-model.ts",
  "features/chat/model-picker-logic.ts",
  "features/chat/model-picker-modal.tsx",
  "lib/workflow-theme.ts",
]);

/** Every `.ctrlKey` / `.metaKey` read outside a comment, as `file:line`. */
function modifierReads(): { allowed: string[]; elsewhere: string[] } {
  const allowed: string[] = [];
  const elsewhere: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = path.relative(WEB_SRC, full).replaceAll(path.sep, "/");
      if (EXCUSED_FILES.has(rel)) continue;
      const code = fs
        .readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(
          /(^|[^:])\/\/[^\n]*/g,
          (m, lead: string) => lead + " ".repeat(m.length - lead.length),
        );
      code.split("\n").forEach((line, i) => {
        if (!/\.(ctrlKey|metaKey)\b/.test(line)) return;
        (rel.startsWith(ALLOWED_DIR) ? allowed : elsewhere).push(`src/${rel}:${i + 1}`);
      });
    }
  };
  walk(WEB_SRC);
  return { allowed, elsewhere };
}

describe("modifier-key reads", () => {
  const reads = modifierReads();

  it("happen only under src/lib/shortcuts/", () => {
    expect(
      reads.elsewhere,
      "Match the event against the keymap (lib/shortcuts/match.ts) instead of reading ctrlKey / metaKey; a hand-written check is a shortcut the settings page cannot rebind.",
    ).toEqual([]);
  });

  it("are still found where they belong, so the scan is not vacuous", () => {
    expect(reads.allowed.length).toBeGreaterThan(0);
  });
});
