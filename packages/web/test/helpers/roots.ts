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
  scanSourceRoots,
  unscannedRoots,
} from "../../../ui/src/testing/source-roots";
import type { SourceFile, SourceScan } from "../../../ui/src/testing/source-roots";

export type { SourceFile, SourceScan };

/** The monorepo root: the base of every {@link SourceFile.id}. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Every root a guard scans. The gallery (`packages/ui-gallery/src`) has landed (#764) and stays
 * out of this list on purpose: it is a development tool, no app package imports it, and it reuses
 * the app's file names for its own pieces (`icons.tsx`, `strings.ts`), which `expectSingleHome`
 * would read as a second home. The guards it does answer to are the package's own — `hooks.test.ts`
 * and `token-contract.test.ts` scan it for stray `ui-*` and `--ui-*` names.
 */
export const SOURCE_ROOTS = {
  web: fileURLToPath(new URL("../../src", import.meta.url)),
  ui: fileURLToPath(new URL("../../../ui/src", import.meta.url)),
} as const;

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
