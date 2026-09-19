/**
 * No surface reads modifier keys itself. A shortcut is a chord in the registry, matched by
 * lib/shortcuts/ against the user's keymap with the platform's modifier mapping; a hand-written
 * `event.ctrlKey` check is a binding the settings page cannot see, and one that is wrong on a
 * Mac. This scans the web source for `.ctrlKey` and `.metaKey` reads and allows them only under
 * src/lib/shortcuts/. (`shiftKey` and `altKey` are not scanned: fixed interaction keys
 * legitimately read them — Shift+Enter, Shift+F10, Shift-multiplied arrows.)
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_SRC = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED_DIR = "lib/shortcuts";

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
