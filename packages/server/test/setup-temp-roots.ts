/**
 * Setup file: after each test file, remove every temp root the file created through
 * `makeTempRoot()` (see temp-roots.ts). Setup-file hooks are registered before the file's
 * own, and after-hooks run in reverse registration order, so this sweep runs after the
 * file's own `afterAll`/`afterEach` have closed whatever they held open inside a root.
 */
import { afterAll } from "vitest";
import { removeTempRoots } from "./temp-roots.js";

afterAll(removeTempRoots);
