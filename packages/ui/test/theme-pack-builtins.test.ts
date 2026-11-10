/**
 * A built-in pack writes nothing the grammar refuses an import (PRFC-0026); the clean baseline,
 * which an import may not hit at all, holds the built-ins to their ledger in deslop.test.ts.
 *
 * - Given each built-in pack as the build carries it (the folder the Vite plugin emits), in the
 *   form its export takes, when it is checked by the validator an import goes through, under this
 *   build's theme API and token names, it is accepted.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinExportFiles, validateThemePack } from "@prismshadow/penguin-theme-pack";
import { THEME_API, TOKEN_NAMES } from "../src/tokens";
import { builtinPackIds, builtinThemesDir, packFolderFiles } from "../src/vite-plugin";

// The built-in packs predate the clean baseline's rules: deslop.test.ts holds each to the hits it
// has today, which only shrink, where an import is held to none.
const contract = { api: THEME_API, tokens: new Set<string>(TOKEN_NAMES), cleanliness: null };

describe("the built-in packs, exported", () => {
  it.each(builtinPackIds())("%s passes the validator an import goes through", async (id) => {
    const files = builtinExportFiles(id, packFolderFiles(join(builtinThemesDir(), id)));
    await expect(validateThemePack(files, contract)).resolves.toMatchObject({ manifest: { id } });
  });
});
