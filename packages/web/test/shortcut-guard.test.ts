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

/** The scanned roots: the app's src and the library web halves the app compiles in, as
    [repo-relative prefix, directory] — the prefix names a file in the findings. */
const ROOTS: ReadonlyArray<readonly [string, string]> = [
  ["src", WEB_SRC],
  [
    "library/workbench/src/web",
    fileURLToPath(new URL("../../../library/workbench/src/web", import.meta.url)),
  ],
  [
    "library/organization/src/web",
    fileURLToPath(new URL("../../../library/organization/src/web", import.meta.url)),
  ],
];

/**
 * Files that read the modifiers for something other than a chord of their own, and are
 * therefore excused: the Workspace picker's fixed file-browser keys (Finder's ⌘↑ / ⌘[ / ⌘],
 * Explorer's Alt+←) and its type-to-select, the model picker's Alt+digit group jump and its
 * type-to-focus (both "is this a bare key" tests), and the workbench frame's key forwarding,
 * which copies an event to re-raise it on the app's window. None is an app command a user
 * would rebind. A new entry here needs a reason of the same kind.
 */
const EXCUSED_FILES = new Set([
  "features/workspace/workspace-finder-model.ts",
  "features/model-picker/model-picker-logic.ts",
  "features/model-picker/model-picker-modal.tsx",
  "lib/workbench-theme.ts",
]);

/** Every `.ctrlKey` / `.metaKey` read outside a comment, as `file:line`. */
function modifierReads(): { allowed: string[]; elsewhere: string[] } {
  const allowed: string[] = [];
  const elsewhere: string[] = [];
  const walk = (prefix: string, root: string, dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(prefix, root, full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      // `key` is the file's path under its root — the space EXCUSED_FILES and ALLOWED_DIR
      // speak; the finding reports it under the root's repo-relative prefix.
      const key = path.relative(root, full).replaceAll(path.sep, "/");
      if (EXCUSED_FILES.has(key)) continue;
      const code = fs
        .readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(
          /(^|[^:])\/\/[^\n]*/g,
          (m, lead: string) => lead + " ".repeat(m.length - lead.length),
        );
      code.split("\n").forEach((line, i) => {
        if (!/\.(ctrlKey|metaKey)\b/.test(line)) return;
        (key.startsWith(ALLOWED_DIR) ? allowed : elsewhere).push(`${prefix}/${key}:${i + 1}`);
      });
    }
  };
  for (const [prefix, dir] of ROOTS) walk(prefix, dir, dir);
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
