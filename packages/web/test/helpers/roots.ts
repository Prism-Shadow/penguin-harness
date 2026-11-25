/**
 * The source roots the web app's guard tests scan, and the assertions every roots-aware guard
 * makes about them.
 *
 * The theme work moves reusable components out of `packages/web/src` into the shared
 * `packages/ui/src` one wave at a time (A-architecture §7). A guard that walked only the web tree
 * would keep passing after its subject moved — over fewer files, with nothing left to find — so
 * every guard scans both roots and asserts two things before its own rule:
 *
 * - `expectEveryRootScanned`: each root yielded files. A mistyped or moved root fails here, by
 *   name, instead of narrowing the guard to nothing.
 * - `expectSingleHome`: a module the guard is about lives in exactly one place across the roots,
 *   the place the guard names. A copy left behind by a move — the web original beside the package
 *   version — would otherwise keep the guard testing the stale one.
 *
 * Files are named by repo-relative id (`packages/web/src/components/ui/icons.tsx`), which stays
 * unambiguous across roots and reads the same on Windows.
 */
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  filesNamed,
  findSourceFile,
  pluginWebRoots,
  scanSourceRoots,
  unscannedRoots,
  type SourceFile,
  type SourceScan,
} from "../../../ui/src/testing/source-roots";

export type { SourceFile, SourceScan };

/** The monorepo root: the base of every {@link SourceFile.id}. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Every root a guard scans: the app, the shared UI package, every plugin's web half the app
 * compiles in (`plugin:<name>`, `plugins/<name>/src/web/`), and the session library's web half
 * (`library:session`, `library/session/src/web/`) the app compiles in the same way. The gallery
 * (`packages/ui-gallery/src`) joins when that package lands; its chrome is deliberately
 * unthemed, so each guard decides then whether it applies there.
 */
export const SOURCE_ROOTS: Readonly<Record<string, string>> = {
  web: fileURLToPath(new URL("../../src", import.meta.url)),
  ui: fileURLToPath(new URL("../../../ui/src", import.meta.url)),
  ...pluginWebRoots(fileURLToPath(new URL("../../../../", import.meta.url))),
  "library:session": fileURLToPath(
    new URL("../../../../library/session/src/web", import.meta.url),
  ),
};

/** Whether the file is the app's: the web tree's own, or a web half compiled into it. */
export function isAppFile(file: SourceFile): boolean {
  return file.root === "web" || file.root.startsWith("plugin:") || file.root.startsWith("library:");
}

/**
 * How a guard's lists name an app file: its path under `packages/web/src/` for the app's own,
 * its repo path (`plugins/<name>/src/web/…`, `library/<name>/src/web/…`) for a compiled web
 * half's.
 */
export function appKeyOf(id: string): string {
  const web = "packages/web/src/";
  return id.startsWith(web) ? id.slice(web.length) : id;
}

/** The repo-relative id of the app file a guard's list names (the inverse of {@link appKeyOf}). */
export function appIdOf(key: string): string {
  return key.startsWith("plugins/") || key.startsWith("library/")
    ? key
    : `packages/web/src/${key}`;
}

/** `.ts`, `.tsx` and `.css` under every root. */
export function scanSources(extensions?: readonly string[]): SourceScan {
  return scanSourceRoots(SOURCE_ROOTS, { repoRoot: REPO_ROOT, extensions });
}

/** Fails, naming the root, when any root yielded no files. */
export function expectEveryRootScanned(scan: SourceScan): void {
  expect(
    unscannedRoots(scan),
    "Every source root must yield files; a root that yields none means a wrong path in " +
      "test/helpers/roots.ts or a package that moved, and the guard would pass over nothing.",
  ).toEqual([]);
}

/** The scanned file with this repo-relative id; fails the test when no root holds it. */
export function sourceFile(scan: SourceScan, id: string): SourceFile {
  const file = findSourceFile(scan, id);
  expect(
    file,
    `${id} is not under any scanned root (${Object.keys(SOURCE_ROOTS).join(", ")})`,
  ).toBeDefined();
  return file!;
}

/**
 * Asserts the file named by `id` is the only file with its name across every root. Call it for
 * each module a guard is about, so a moved module fails the guard until the guard names its new
 * home, and a leftover copy fails it until the copy is deleted.
 */
export function expectSingleHome(scan: SourceScan, id: string): void {
  const name = id.slice(id.lastIndexOf("/") + 1);
  expect(
    filesNamed(scan, name).map((file) => file.id),
    `${name} should live only at ${id}`,
  ).toEqual([id]);
}
