/**
 * The gallery is judged by what changes when the theme under test changes, so nothing it renders
 * itself may follow Tailwind's palette or the `dark:` variant: the chrome reads its own `--g-*`
 * variables and the Foundations pages read `--ui-*` tokens. A `gray-*` class or a `dark:` variant
 * here would move with the theme bridge and muddy every comparison.
 *
 * The one exception is the site navbar (src/site): it is the landing page's markup, classes and
 * all, kept so the three sites' navbars stay one diff apart, and its scope (site.css) pins every
 * value those classes read back to the landing page's.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

describe("gallery sources stay off the palette the themes re-point", () => {
  const site = path.join(SRC, "site") + path.sep;
  const files = walk(SRC).filter((file) => !file.startsWith(site));

  it("scans a non-empty tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("uses no gray-* class and no dark: variant", () => {
    // A variant is `dark:` glued to a utility; `{ dark: true }` and `dark: "深色"` are not.
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/\b(?:[a-z-]+-)?gray-\d{2,3}\b|\bdark:[a-z[!-]/g)].map(
        (m) => `${path.relative(SRC, file)}: ${m[0]}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
