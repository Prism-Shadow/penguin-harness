/**
 * Temp roots for the server suite, and who removes them: whoever creates one. Every root
 * `makeTempRoot()` hands out is recorded, and `setup-temp-roots.ts` (a vitest setup file, so it
 * runs for every test file) removes all of them once the file's tests are done. The registry
 * itself lives in helpers.ts — one registry for the whole suite, whether a test made a root
 * itself or handed it to `createTestApp` (merged from the registries the two parents each grew).
 */
import { makeTempRoot, pendingHelpersTempRoots, removeTempRoots } from "./helpers.js";

export { makeTempRoot, removeTempRoots };

/** The roots created and not yet swept (what the next sweep will remove). */
export function pendingTempRoots(): string[] {
  return pendingHelpersTempRoots();
}
